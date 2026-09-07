#!/usr/bin/env bash
# Gooday 部署安装 —— 机器重建的唯一入口。
#
#   sudo bash ops/install.sh
#
# 幂等，可重复执行。
#
# 【G04 铁律】所有配置一律【整目录扫描】安装，不得写死文件名。
# 写死就要求人记得同步，而人不会记得——2026-09-07 就是这么丢的：
# claudecred.conf 在服务器上生效了，但安装脚本只写死装 memorymax.conf，
# 一旦重装，bot 退回读失效凭据，表现为「活着但答不出话」，全绿无人发现。
#
# 新增配置时【不需要改本脚本】。如果你发现必须改本脚本才能装上某个东西，
# 那说明结构错了，回去看 norms G04。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SD=/etc/systemd/system

log() { printf '==> %s\n' "$*"; }

# ── 1. systemd 单元（整目录扫描）────────────────────────────────
log "安装 systemd 单元"
shopt -s nullglob
for unit in "$REPO"/ops/systemd/*.service; do
    install -m 644 "$unit" "$SD/$(basename "$unit")"
    echo "    $(basename "$unit")"
done

# ── 2. systemd drop-in（整目录扫描 × 全部 bot）──────────────────
# 约定：ops/systemd/dropins/ 下每个 .conf 对【全部 bot】生效。
# 若将来某个 drop-in 要按服务区分，改成显式映射，别在目录里放特例。
log "安装 systemd drop-in"
BOTS=()
for unit in "$REPO"/ops/systemd/*.service; do
    n="$(basename "$unit" .service)"
    [[ "$n" == *dispatcher* || "$n" == *bot* || "$n" == gooday-* ]] && BOTS+=("$n")
done
for conf in "$REPO"/ops/systemd/dropins/*.conf; do
    for svc in "${BOTS[@]}"; do
        install -m 644 -D "$conf" "$SD/$svc.service.d/$(basename "$conf")"
    done
    echo "    $(basename "$conf") → ${#BOTS[@]} 个服务"
done

# ── 3. nginx（整目录扫描）───────────────────────────────────────
log "安装 nginx 配置"
for c in "$REPO"/ops/nginx/*.conf; do
    install -m 644 "$c" "/etc/nginx/conf.d/$(basename "$c")"
    echo "    $(basename "$c")"
done

# ── 4. cron（唯一真源，整份替换）────────────────────────────────
# 不做增量合并——增量合并会让「实际在跑的」和「仓库里的」慢慢分叉，
# 那正是 G03 单一真源要防的。
log "安装 crontab"
if [[ -f "$REPO/ops/cron/crontab" ]]; then
    crontab "$REPO/ops/cron/crontab"
    echo "    已整份替换（真源：ops/cron/crontab）"
fi

# ── 5. 仓库外的四个位置（状态/日志/产物/备份，G01）──────────────
log "创建仓库外目录"
install -d -m 755 /var/lib/gooday/state /var/log/gooday \
                  /srv/gooday/media /srv/gooday/backups
echo "    /var/lib/gooday/state  /var/log/gooday  /srv/gooday/{media,backups}"

# ── 6. 生效 ─────────────────────────────────────────────────────
log "reload + 重启"
systemctl daemon-reload
for svc in "${BOTS[@]}"; do
    systemctl restart "$svc" || echo "    ⚠️ $svc 重启失败"
done

# ── 7. 收尾校验 ─────────────────────────────────────────────────
cat <<'EOF'

==> 装完了。必须验这几项，别只看脚本没报错：

  systemctl show -p Environment --value gooday-lingxi   # 期望 HOME=/home/agent
  ls -l /home/agent/.claude/.credentials.json           # 期望存在且属主 agent
  crontab -l | head -3                                  # 期望 SHELL=/bin/bash

  ⚠️ Claude 凭据是全线单点：所有 bot 共用同一份。
     它没了或属主变 root，全部 bot 会「活着但答不出话」——
     心跳、systemd 状态、服务列表全绿，不会有任何告警。
     重建机器后必须先确认 agent 已 claude /login。

  ⚠️ 新增 cron 后等一个执行周期，确认【日志文件真的出现】。
     crontab -l 显示正常不算数——cron 默认 dash 没有 source，
     整行会静默失败且连日志都不生成。
EOF
