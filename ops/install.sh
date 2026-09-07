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
# 新增一个 service 或 pipeline 时，【不需要改本脚本】。
# 如果你发现必须改本脚本才能装上某个东西，说明结构错了——回去看 norms G06。
#
# 换来这条的事故（2026-09-07）：claudecred.conf 已在服务器上生效，
# 但安装脚本只写死装 memorymax.conf。重装机器时静默丢配置，
# bot 退回读失效凭据，表现为「活着但答不出话」，心跳/systemd 全绿，无人发现。
# 根因不是「忘了改」，是【脚本要求你记得改】。
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail
shopt -s nullglob

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SD=/etc/systemd/system
log() { printf '==> %s\n' "$*"; }

# ── 1. 仓库外的四个位置（G01 五类分离）─────────────────────────────────
# 状态、日志、产物、备份一律在仓库外。先建，否则服务启动即失败。
log "创建仓库外目录"
install -d -m 755 /var/lib/gooday/state /var/log/gooday \
                  /srv/gooday/media /srv/gooday/backups

# ── 2. services/*/deploy —— 通配扫描 ───────────────────────────────────
log "安装服务单元"
SERVICES=()
for dir in "$REPO"/services/*/; do
    name="$(basename "$dir")"
    [[ "$name" == _* ]] && continue          # _template 不是成员
    unit="$dir/deploy/unit.service"
    [[ -f "$unit" ]] || { echo "    ⚠️ $name 缺 deploy/unit.service，跳过"; continue; }

    sed "s/{{NAME}}/$name/g" "$unit" > "$SD/gooday-$name.service"
    SERVICES+=("gooday-$name")
    install -d -m 755 "/var/lib/gooday/state/$name"

    # 该服务自带的 drop-in（可选，同样通配）
    for conf in "$dir"/deploy/*.conf; do
        install -m 644 -D "$conf" "$SD/gooday-$name.service.d/$(basename "$conf")"
    done
    echo "    gooday-$name"
done

# ── 3. pipelines/*/deploy/schedule.cron —— 汇总成唯一 crontab ──────────
# G03 单一真源：不做增量合并。增量合并会让「实际在跑的」和「仓库里的」慢慢分叉。
log "汇总 crontab"
CRON_TMP="$(mktemp)"
{
    echo "# 本文件由 ops/install.sh 从 pipelines/*/deploy/schedule.cron 自动汇总。"
    echo "# 【不要手工编辑】——改动会在下次 install 时被覆盖。要改就改产线目录里那份。"
    echo "SHELL=/bin/bash"
    echo "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    echo
    for dir in "$REPO"/pipelines/*/; do
        name="$(basename "$dir")"
        [[ "$name" == _* ]] && continue
        sched="$dir/deploy/schedule.cron"
        [[ -f "$sched" ]] || continue
        echo "# ── $name ──"
        grep -v '^\s*#' "$sched" | grep -v '^\s*$' | sed "s/{{NAME}}/$name/g"
        echo
        install -d -m 755 "/var/lib/gooday/state/$name" "/srv/gooday/media/$name"
    done
} > "$CRON_TMP"
crontab "$CRON_TMP" && rm -f "$CRON_TMP"
echo "    已整份替换"

# ── 4. ops/nginx/* —— 通配扫描 ─────────────────────────────────────────
log "安装 nginx 配置"
for c in "$REPO"/ops/nginx/*.conf; do
    install -m 644 "$c" "/etc/nginx/conf.d/$(basename "$c")"
    echo "    $(basename "$c")"
done

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

  systemctl is-active gooday-<名字>                 # 每个服务
  crontab -l | head -3                              # 期望 SHELL=/bin/bash
  ls /var/lib/gooday/state /var/log/gooday          # 期望存在

  ⚠️ 新增 cron 后【等一个执行周期，确认日志文件真的出现】。
     crontab -l 显示正常不算数——cron 默认 dash 没有 source，
     整行会静默失败且连日志都不生成。

  ⚠️ 改过服务代码的，确认【进程启动时间晚于代码 mtime】：
     ps -o lstart= -p $(systemctl show -p MainPID --value gooday-<名字>)
     否则你验的是旧代码。

  ⚠️ 大模型凭据是全线单点：所有 bot 共用同一份。
     它失效时表现为「活着但答不出话」，心跳和 systemd 全绿，不会有告警。
EOF
