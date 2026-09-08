#!/usr/bin/env bash
# Gooday 部署安装 —— systemd 单元、crontab、drop-in、nginx 配置的安装入口。
#
#   sudo bash ops/install.sh
#
# 幂等，可重复执行。
#
# ⚠️ 【它不是"机器重建的唯一入口"】——曾经这么写过，是说过头了（2026-09-08 复核）。
#    它【不】做这三件事，干净机器上必须另外手工做：
#      1. 拉起容器：cd ops/docker && docker compose up -d
#      2. 放证书：ops/nginx/certs/*.pem 在 .gitignore 里，克隆下来是空的，
#         nginx 找不到证书起不来
#      3. 建 .env：只有 .env.example 进版本库（G18）
#    完整重建步骤见 ops/runbooks/。**把差距写明，比让人以为跑完这个就完事强。**
#
# ══ G04 铁律 ═══════════════════════════════════════════════════════════
# 本脚本【只做通配扫描，绝不列举成员】。
#
# 新增一个 service 或 workflow 时，【不需要改本脚本】。
# 如果你发现必须改本脚本才能装上某个东西，说明结构错了——回去看 policies G06。
#
# 换来这条的事故（2026-09-07）：claudecred.conf 已在服务器上生效，
# 但安装脚本只写死装 memorymax.conf。重装机器时静默丢配置，
# bot 退回读失效凭据，表现为「活着但答不出话」，心跳/systemd 全绿，无人发现。
# 根因不是「忘了改」，是【脚本要求你记得改】。
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail
shopt -s nullglob

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 装到一半发现「装了但不生效」时，不能一路 echo 完还 exit 0 ——
# 那是把「检测到错误」降级成「黄绿」，假绿并没有被消除。
# 置位后继续把能装的装完，最后整体判死（见脚本末尾）。
INSTALL_FAILED=0

# ── 0. 先确认装的是不是最新代码 ────────────────────────────────────────
# 2026-09-07 真栽过：在开发副本提交推送后忘了同步部署副本，
# install.sh 照常报告成功，装的却是三小时前的代码——
# 「脚本没报错」和「装对了东西」是两回事（policies G08）。
if git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
    git -C "$REPO" fetch -q origin 2>/dev/null || true
    LOCAL="$(git -C "$REPO" rev-parse HEAD 2>/dev/null)"
    REMOTE="$(git -C "$REPO" rev-parse '@{u}' 2>/dev/null || echo "$LOCAL")"
    if [[ "$LOCAL" != "$REMOTE" ]]; then
        echo "❌ 部署副本不是最新的："
        echo "     本地 ${LOCAL:0:7} / 远端 ${REMOTE:0:7}"
        echo "   先跑 git -C $REPO pull，否则你装的是旧代码。"
        exit 1
    fi
    echo "==> 代码版本 ${LOCAL:0:7}（与远端一致）"
fi
SD=/etc/systemd/system
log() { printf '==> %s\n' "$*"; }

# ── 1. 仓库外的四个位置（G01 五类分离）─────────────────────────────────
# 状态、日志、产物、备份一律在仓库外。先建，否则服务启动即失败。
log "创建仓库外目录"
# state=服务状态；tasks/events/evidence/evaluations/checkpoints=第二层循环的证据链（G07）
install -d -m 755 /var/lib/gooday-harness/{state,tasks,events,evidence,evaluations,checkpoints} \
                  /var/log/gooday-harness /srv/gooday-harness/media /srv/gooday-harness/backups
# 属主对齐仓库属主：证据链要能被「跑 workflow 的那个身份」写入。
# 只留 root 可写的话，手动跑一次就全是 PermissionError，
# 而 trace 的设计是「不抛异常」——于是会安静地丢掉整条证据链（实测过）。
REPO_OWNER="$(stat -c '%U' "$REPO")"
if [[ "$REPO_OWNER" != root ]]; then
    chown -R "$REPO_OWNER" /var/lib/gooday-harness /var/log/gooday-harness /srv/gooday-harness
    echo "    属主 → $REPO_OWNER（root 仍可写）"
fi

# ── 2. services/*/deploy —— 通配扫描 ───────────────────────────────────
log "安装服务单元"
SERVICES=()
for dir in "$REPO"/services/*/; do
    name="$(basename "$dir")"
    [[ "$name" == _* ]] && continue          # _template 不是成员
    # 缺 config.json 就从 example 播种。
    # ⚠️ 这段【曾只写在 workflows 循环里】，services 这边漏了（2026-09-07）——
    #    结果 7 个服务全部以退出码 2 起不来，而 install.sh 报告成功。
    #    G19 当时也只查 workflows，所以门禁没抓到。两处都补了。
    if [[ -f "$dir/config.example.json" && ! -f "$dir/config.json" ]]; then
        cp "$dir/config.example.json" "$dir/config.json"
        echo "    ℹ️  $name：已播种 config.json，记得按本机改"
    fi
    unit="$dir/deploy/unit.service"
    [[ -f "$unit" ]] || { echo "    ⚠️ $name 缺 deploy/unit.service，跳过"; continue; }

    sed "s/{{NAME}}/$name/g" "$unit" > "$SD/gooday-harness-$name.service"
    SERVICES+=("gooday-harness-$name")
    install -d -m 755 "/var/lib/gooday-harness/state/$name"

    # 该服务自带的 drop-in（可选，同样通配）
    for conf in "$dir"/deploy/*.conf; do
        install -m 644 -D "$conf" "$SD/gooday-harness-$name.service.d/$(basename "$conf")"
    done

    # 共享 drop-in：ops/dropins/ 下的对【所有服务】生效。
    # 这是 G06「配置随归属方走」的例外，理由写在各文件头部——
    # 当一份配置对每个服务内容完全相同时，随服务走就是 N 份真副本，
    # 改一次要改 N 处，那正是 G03 单一真源要防的。
    for conf in "$REPO"/ops/dropins/*.conf; do
        install -m 644 -D "$conf" "$SD/gooday-harness-$name.service.d/$(basename "$conf")"
    done
    echo "    gooday-harness-$name"
done

# ── 3. workflows/*/deploy/schedule.cron —— 只替换本项目的托管块 ────────
#
# ⚠️ 绝不整份替换 crontab。
#
# 路径可以加前缀隔离，但 **crontab / nginx / systemd 是共享命名空间**，
# 隔离不了。2026-09-07 复核实测：整份替换会当场抹掉 root 现有的 11 个任务，
# 其中包括 TLS 证书续期、数据库快照、巡检和四条内容产线——
# 无备份、无确认、无提示，装完才发现整站在慢慢烂掉。
#
# 做法：用标记划出本项目的托管块，块外的行【原样保留】。
# 这仍然满足 G03 单一真源——本项目管的那部分只有一个来源，
# 别人的任务不归我们管，也不该被我们删。
# 按 runas 分组：有些任务必须以 agent 跑（要用它的模型凭据），
# 有些必须 root（要重启服务、读 docker 卷）。
# 盘点旧系统时才发现【存在两个 crontab】——root 11 个、agent 3 个，
# 而原来的 install.sh 只管 root 那个，agent 侧的任务它完全看不见。
# 产线在 schedule.cron 里用 `# runas: <用户>` 声明，默认 root。
log "更新 crontab（按 runas 分组，只动本项目托管块）"
BEGIN_MARK="# >>> gooday-harness managed block >>>"
END_MARK="# <<< gooday-harness managed block <<<"

# 先收集每个 workflow 的 runas
declare -A CRON_BY_USER
for dir in "$REPO"/workflows/*/; do
    name="$(basename "$dir")"
    [[ "$name" == _* ]] && continue
    sched="$dir/deploy/schedule.cron"
    [[ -f "$sched" ]] || continue
    # 缺 config.json 就从 example 播种。
    # 不做这一步，install 会报告成功而部署出来的 workflow 一跑就退出——
    # 「装完了」不等于「能跑」（policies G08）。
    # ⚠️ 这段曾在重写 runas 逻辑时被连带删掉（2026-09-07），
    #    导致三个 workflow 装上了却没 config，一跑就退，而 install 全绿。
    if [[ -f "$dir/config.example.json" && ! -f "$dir/config.json" ]]; then
        cp "$dir/config.example.json" "$dir/config.json"
        echo "    ℹ️  $name：已播种 config.json，记得按本机改"
    fi
    who="$(grep -oP '(?<=^# runas:)\s*\S+' "$sched" | tr -d ' ' | head -1)"
    who="${who:-root}"
    body="$(grep -v '^\s*#' "$sched" | grep -v '^\s*$' | sed "s/{{NAME}}/$name/g")"
    CRON_BY_USER[$who]+="# ── $name ──"$'\n'"$body"$'\n'
    install -d -m 755 "/var/lib/gooday-harness/state/$name" \
                      "/srv/gooday-harness/media/$name"
done

for who in "${!CRON_BY_USER[@]}"; do
    BAK="/var/lib/gooday-harness/checkpoints/crontab-$who-$(date +%Y%m%d-%H%M%S).bak"
    crontab -u "$who" -l > "$BAK" 2>/dev/null || true
    echo "    [$who] 已备份 → $BAK"

    TMP="$(mktemp)"
    crontab -u "$who" -l 2>/dev/null \
        | sed "\|^${BEGIN_MARK}\$|,\|^${END_MARK}\$|d" > "$TMP" || true
    {
        echo "$BEGIN_MARK"
        echo "# 由 ops/install.sh 汇总，勿手工编辑。改要改 workflows/*/deploy/schedule.cron"
        echo "SHELL=/bin/bash"
        echo "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
        printf '%s' "${CRON_BY_USER[$who]}"
        echo "$END_MARK"
    } >> "$TMP"
    crontab -u "$who" "$TMP" && rm -f "$TMP"
    echo "    [$who] 托管块已更新，块外任务原样保留"
done

# ── 3.5 ops/docker/.env 软链 —— 让默认的 compose 命令就是对的 ──────────
#
# 2026-09-07 真事故：compose 里写着 `Jwt__Secret=${JWT_SECRET}`，
# 密钥在仓库根的 .env，而 compose 的【变量插值】只读项目目录（ops/docker/）
# 下的 .env 和 shell 环境 —— **不读 `env_file:` 那一项**。
# 两个机制名字像、作用完全不同：env_file 是把变量送进容器，
# ${VAR} 是 compose 自己在解析期展开。
#
# 结果：不带 --env-file 跑一次 `docker compose up -d api`，
# ${JWT_SECRET} 空展开成 `Jwt__Secret=`，**容器状态 running、日志没红**，
# 但每个请求都 500（IDX10703: key length is zero）。整站挂掉。
#
# 靠「记得加 --env-file」是不行的——没人记得住，而且它没写在任何地方。
# 建个软链让默认命令就对：**正确的用法必须是最省事的用法**。
log "链接 compose 环境文件（让 docker compose 默认就能取到密钥）"
if [[ -f "$REPO/.env" ]]; then
    ln -sfn "$REPO/.env" "$REPO/ops/docker/.env"
    echo "    ops/docker/.env → $REPO/.env"
    # 验证插值真的成立，不只是软链建成了（延续「验证生效不验证写入」）
    if command -v docker >/dev/null 2>&1; then
        miss="$(cd "$REPO/ops/docker" && docker compose config 2>/dev/null \
                | grep -oP '(?<=Jwt__Secret: )\S*' || true)"
        if [[ -z "$miss" ]]; then
            echo "    ⚠️ docker compose config 里 Jwt__Secret 仍是空 —— 密钥不会传进容器，"
            echo "       起来之后每个请求都会 500。先检查 $REPO/.env 里有没有 JWT_SECRET"
        else
            echo "    ✅ 插值验证通过（Jwt__Secret 非空）"
        fi
    fi
else
    echo "    ⚠️ $REPO/.env 不存在，跳过。api 起来后会因缺密钥而每个请求 500"
fi

# ── 4. ops/nginx/conf.d/* —— 它【就是】容器的挂载源，不需要拷贝 ────────
#
# ⚠️ 别想当然往 /etc/nginx/conf.d 写。
#
# 2026-09-07 实测：这台机器【宿主机根本没有 nginx】（systemctl 显示 inactive），
# nginx 跑在容器里，配置来自 bind mount。往 /etc/nginx/conf.d 写会
# 「写入成功、脚本显示 OK、实际零效果」——比冲突更难发现，因为没有任何报错。
#
# ⚠️ 2026-09-08 发现第二层同款：修完上面那条之后，本段改成拷进
#    /opt/gooday-harness/nginx/conf.d/ —— 而 ops/docker/docker-compose.yml 挂的是
#    `../nginx/conf.d`，相对 ops/docker/ 解析出来是 **ops/nginx/conf.d**。
#    于是拷贝落进一个没人读的目录，紧接着 `docker exec nginx -t && reload` 成功
#    （容器读的是 ops/nginx，本来就是对的），脚本打印 ✅。
#    **拷贝零效果，验证却全绿**——正是 G08 存在的理由，被 G08 自己的实现犯了。
#    更糟的是 glob 写成 ops/nginx/*.conf：它抓的是主配置 nginx.conf、
#    漏掉 conf.d/gooday.conf。真挂上去 nginx 会因 `events{}` 出现在 http 段而起不来。
#
# 现在的规矩：**真源就是挂载源，不拷贝**。本段只做三件事——
# 冲突预检、确认容器挂的确实是这个目录、语法验证并 reload。
NGINX_DIR="$REPO/ops/nginx/conf.d"
log "校验 nginx 配置（真源即挂载源：$NGINX_DIR）"

nginx_files=("$REPO"/ops/nginx/conf.d/*.conf)
if [[ ! -e "${nginx_files[0]}" ]]; then
    echo "    （无配置，跳过）"
else
    # 4a. 冲突预检：端口与 server_name 是不是已经被别人占了
    for c in "${nginx_files[@]}"; do
        while read -r port; do
            # 端口冲突检查【保留】：迁移已完成，但装到新机器、或本机装了别的
            # 服务时照样会撞。这条不是迁移期专用的。
            if ss -lntp 2>/dev/null | grep -q ":${port}\b"; then
                holder="$(ss -lntp 2>/dev/null | grep ":${port}\b" | head -1 | sed 's/.*users:((//;s/).*//')"
                # 本项目自己的容器占着是正常的（重装/升级场景）
                if [[ "$holder" == *nginx* ]] && docker ps --format '{{.Names}}' 2>/dev/null \
                     | grep -q "^gooday-harness-nginx$"; then
                    echo "    ℹ️  端口 $port 由本项目的 nginx 持有（重装场景，正常）"
                else
                    echo "    ⚠️ 端口 $port 已被占用（$holder）"
                    echo "       两套 nginx 不能同时持有同一端口。"
                fi
            fi
        done < <(grep -oP '(?<=listen )\d+' "$c" | sort -u)

        # server_name 冲突：原来只查旧系统的 /opt/gooday/nginx/conf.d/。
        # 那个目录已随切换改名消失（2026-09-07），写死单一路径的检查
        # 从此永远查不到东西 —— 而它【不会报错，只是静默地什么都不查】，
        # 正是本项目最怕的那种「结构在但没在起作用」。
        # 改成扫本机所有 nginx 容器实际挂载的配置目录：迁移期查得到旧系统，
        # 迁移完照样查得到别人装的 nginx。
        while read -r sn; do
            while read -r d; do
                [[ -d "$d" ]] || continue
                # 本项目自己不算冲突。用 readlink -f 归一：容器记录的挂载源
                # 可能带符号链接或旧路径名，字符串直比会把自己当成冲突方报出来。
                [[ "$(readlink -f "$d")" == "$(readlink -f "$NGINX_DIR")" ]] && continue
                if grep -rqs "server_name.*\b${sn}\b" "$d" 2>/dev/null; then
                    echo "    ⚠️ server_name '$sn' 与 $d 里的配置冲突"
                fi
            done < <(docker ps --format '{{.Names}}' 2>/dev/null \
                     | xargs -r -I{} docker inspect {} \
                         --format '{{range .Mounts}}{{if eq .Destination "/etc/nginx/conf.d"}}{{.Source}}{{end}}{{end}}' \
                       2>/dev/null | grep -v '^$' | sort -u)
        done < <(grep -oP '(?<=server_name )[^;]+' "$c" | tr ' ' '\n' | grep -v '^$' | sort -u)
    done

    for c in "${nginx_files[@]}"; do
        echo "    $(basename "$c")"
    done

    # 4b. 生效验证：先证明【容器读的确实是这个目录】，再验语法并 reload。
    #     只做 `nginx -t && reload` 是不够的 —— 那在配置根本没送到的时候也会成功，
    #     那正是 2026-09-08 踩的坑。所以第一步查挂载源，不是查语法。
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^gooday-harness-nginx$'; then
        # 只取 Destination 恰好是 /etc/nginx/conf.d 的挂载。
        # 边界：如果哪天改成【单文件挂载】（-v .../gooday.conf:/etc/nginx/conf.d/gooday.conf），
        # Destination 对不上，mount_src 会是空 → 落进下面的 ❌ 分支。
        # 那是误报，但方向是安全的：宁可报「可能没生效」，不可报假的 ✅。
        mount_src="$(docker inspect gooday-harness-nginx \
            --format '{{range .Mounts}}{{if eq .Destination "/etc/nginx/conf.d"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)"
        if [[ -n "$mount_src" \
              && "$(readlink -f "$mount_src")" == "$(readlink -f "$NGINX_DIR")" ]]; then
            echo "    ✅ 容器挂载源 = $NGINX_DIR（本目录即生效目录，无需拷贝）"
            # 【不能让 nginx -t 失败直接掐死脚本】。set -e 下 `A && B && C`
            # 整体失败会当场退出，而本段在第 5 段（装 systemd + 重启服务）【之前】——
            # 一个 gooday.conf 语法错，代价会是 9 个服务全都没装没重启，
            # 输出里只有 nginx 的 stderr。所以这里显式吞掉退出码、记下失败，
            # 到脚本最后再整体判死。（2026-09-08 灵犀评审指出）
            if docker exec gooday-harness-nginx nginx -t 2>&1 \
               && docker exec gooday-harness-nginx nginx -s reload 2>&1; then
                echo "    ✅ 已验证语法并 reload"
            else
                echo "    ❌ nginx -t / reload 失败——配置有语法错，当前跑的还是旧配置"
                INSTALL_FAILED=1
            fi
        else
            echo "    ❌ 容器 /etc/nginx/conf.d 挂的是 '${mount_src:-（取不到）}'，不是 $NGINX_DIR"
            echo "       这个目录里改什么都【不会生效】。对齐 ops/docker/docker-compose.yml"
            echo "       后 docker compose up -d nginx 重建容器（挂载源改不了，只能重建）。"
            INSTALL_FAILED=1
        fi
    elif systemctl is-active --quiet nginx 2>/dev/null; then
        echo "    ❌ 宿主机 nginx 在跑，但它读的是 /etc/nginx/conf.d，不是本目录。"
        echo "       本项目的配置由容器挂载生效——现在没有任何东西在读它，【不生效】。"
        INSTALL_FAILED=1
    else
        echo "    ❌ 没有任何 nginx 在跑——配置【当前不生效】。"
        echo "       拉起来：cd ops/docker && docker compose up -d nginx"
        INSTALL_FAILED=1
    fi
fi

# ── 5. 生效 ────────────────────────────────────────────────────────────
log "reload + 重启"
systemctl daemon-reload
for svc in "${SERVICES[@]}"; do
    systemctl enable --now "$svc" >/dev/null 2>&1 || true
    systemctl restart "$svc" || echo "    ⚠️ $svc 重启失败"
done

# ── 6. 收尾校验 ────────────────────────────────────────────────────────
cat <<'EOF'

==> 装完了。以下必须逐项实验证，别只看脚本没报错：

  systemctl is-active gooday-harness-<名字>                 # 每个服务
  crontab -l | head -3                              # 期望 SHELL=/bin/bash
  ls /var/lib/gooday-harness/state /var/log/gooday-harness          # 期望存在

  ⚠️ 新增 cron 后【等一个执行周期，确认日志文件真的出现】。
     crontab -l 显示正常不算数——cron 默认 dash 没有 source，
     整行会静默失败且连日志都不生成。

  ⚠️ 改过服务代码的，确认【进程启动时间晚于代码 mtime】：
     ps -o lstart= -p $(systemctl show -p MainPID --value gooday-harness-<名字>)
     否则你验的是旧代码。

  ⚠️ 大模型凭据是全线单点：所有 bot 共用同一份。
     它失效时表现为「活着但答不出话」，心跳和 systemd 全绿，不会有告警。
EOF

# ── 7. 整体判死 ────────────────────────────────────────────────────────
# 「检测到了但仍然 exit 0」和「没检测」对调用方（CI、人、上层脚本）是同一回事。
# 前面每一处「装了但不生效」都置了 INSTALL_FAILED，在这里统一以非零退出。
if (( INSTALL_FAILED )); then
    echo
    echo "❌ 安装完成，但上面有【装了却不生效】的项——退出码 1。"
    echo "   逐条修掉再跑一次；别把它当成'基本成功'。"
    exit 1
fi
