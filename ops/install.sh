#!/usr/bin/env bash
# Gooday 部署安装 —— 机器重建的唯一入口。
#
#   sudo bash ops/install.sh
#
# 幂等，可重复执行。
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

# ── 4. ops/nginx/* —— 装进本项目自己的目录，并【验证真的会被读到】 ──────
#
# ⚠️ 别想当然往 /etc/nginx/conf.d 写。
#
# 2026-09-07 实测：这台机器【宿主机根本没有 nginx】（systemctl 显示 inactive），
# nginx 跑在容器里，配置来自 bind mount。往 /etc/nginx/conf.d 写会
# 「写入成功、脚本显示 OK、实际零效果」——比冲突更难发现，因为没有任何报错。
#
# 所以本段的规矩是：**验证生效，不能只验证写入。**
NGINX_DIR=/opt/gooday-harness/nginx/conf.d
log "安装 nginx 配置 → $NGINX_DIR"
install -d -m 755 "$NGINX_DIR"

nginx_files=("$REPO"/ops/nginx/*.conf)
if [[ ${#nginx_files[@]} -eq 0 ]]; then
    echo "    （无配置，跳过）"
else
    # 4a. 冲突预检：端口与 server_name 是不是已经被别人占了
    for c in "${nginx_files[@]}"; do
        while read -r port; do
            if ss -lntp 2>/dev/null | grep -q ":${port}\b"; then
                echo "    ⚠️ 端口 $port 已被占用（$(ss -lntp 2>/dev/null | grep ":${port}\b" | head -1 | sed 's/.*users:((//;s/).*//'))"
                echo "       迁移期旧系统仍在服务，两套 nginx 不能同时持有同一端口。"
            fi
        done < <(grep -oP '(?<=listen )\d+' "$c" | sort -u)

        while read -r sn; do
            if grep -rqs "server_name.*\b${sn}\b" /opt/gooday/nginx/conf.d/ 2>/dev/null; then
                echo "    ⚠️ server_name '$sn' 与旧系统冲突（/opt/gooday/nginx/conf.d/）"
            fi
        done < <(grep -oP '(?<=server_name )[^;]+' "$c" | tr ' ' '\n' | grep -v '^$' | sort -u)
    done

    for c in "${nginx_files[@]}"; do
        install -m 644 "$c" "$NGINX_DIR/$(basename "$c")"
        echo "    $(basename "$c")"
    done

    # 4b. 生效验证：有没有【真的】有一个 nginx 在读这个目录
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^gooday-harness-nginx$'; then
        docker exec gooday-harness-nginx nginx -t \
            && docker exec gooday-harness-nginx nginx -s reload \
            && echo "    ✅ 已验证语法并 reload"
    elif systemctl is-active --quiet nginx 2>/dev/null; then
        nginx -t && systemctl reload nginx && echo "    ✅ 已验证语法并 reload"
    else
        echo "    ⚠️ 配置已写入，但【没有任何 nginx 在读这个目录】——当前不生效。"
        echo "       这台机器上 nginx 跑在容器里，宿主机没装。"
        echo "       迁移期这是预期状态：旧系统的 gooday_nginx 仍独占 80/443。"
        echo "       切换时才把本目录挂进 nginx 容器，见 docs/specs/002-known-gaps.md 缺口三。"
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
