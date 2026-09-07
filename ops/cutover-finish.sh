#!/usr/bin/env bash
# 收尾切换：装新 cron → 停旧 cron → 停旧 systemd → 把 /opt/gooday 改名 goodayback
#
# 需要 root（要动 root crontab、systemd、/opt 下的目录名）。
#
# ⚠️ 顺序不能乱，理由都在各步注释里。核心一条：
#    **先让新的跑起来并验过，再停旧的；先改名，再删。**
#    改名不是删除——留着 /opt/goodayback 是为了万一漏了什么还能捞回来。
#
# 幂等：重复跑安全。每步都先检查当前状态。
set -uo pipefail

REPO=/opt/gooday-harness
OLD=/opt/gooday
BACK=/opt/goodayback
ok=0; warn=0
say()  { echo -e "\n▸ $*"; }
good() { echo "   ✅ $*"; ok=$((ok+1)); }
bad()  { echo "   ⚠️  $*"; warn=$((warn+1)); }

[[ $EUID -eq 0 ]] || { echo "❌ 需要 root：sudo bash $0"; exit 1; }

# ── 0. 前置：新栈必须是健康的，否则不该动旧的 ─────────────────────
say "0. 前置检查（新栈没跑起来就不该拆旧的）"
code=$(curl -sk -o /dev/null -w '%{http_code}' https://localhost/ || echo 000)
[[ "$code" == "200" ]] && good "站点 200" || { bad "站点返回 $code —— 中止，先修站点"; exit 1; }
for u in bot-lingxi bot-ruyi bot-qingtianzu bot-weizhentian bot-zhaocai dispatcher; do
    systemctl is-active --quiet "gooday-harness-$u" || bad "gooday-harness-$u 没在跑"
done
[[ $warn -eq 0 ]] && good "六个 bot 都在跑" || { echo "❌ 有服务没起来，中止"; exit 1; }

# ── 1. 装 cron（install.sh 会把 8 条新工作流写进托管块）────────────
say "1. 安装新 cron（只动本项目托管块，块外任务原样保留）"
bash "$REPO/ops/install.sh" || { echo "❌ install.sh 失败，中止"; exit 1; }
for u in root agent; do
    n=$(crontab -u "$u" -l 2>/dev/null | grep -c "gooday-harness/workflows" || true)
    good "[$u] 托管块里有 $n 条 harness 任务"
done

# ── 2. 停旧 cron ───────────────────────────────────────────────────
# 【改名之前必须先停】：改名后旧 cron 会指向不存在的路径，
# 每次触发都在日志里刷一条 No such file —— 而且是静默的那种，
# 没人会去看 /var/log/syslog。停掉比让它报错更干净。
say "2. 摘掉指向 $OLD 的旧 cron 行（逐条注释，不删——留着能看出原来是什么）"
for u in root agent; do
    BAK="/var/lib/gooday-harness/checkpoints/crontab-$u-precutover-$(date +%Y%m%d-%H%M%S).bak"
    mkdir -p "$(dirname "$BAK")"
    crontab -u "$u" -l > "$BAK" 2>/dev/null || true
    before=$(grep -cE "^[^#].*$OLD/" "$BAK" 2>/dev/null || echo 0)
    if [[ "$before" -eq 0 ]]; then good "[$u] 没有指向 $OLD 的活跃行"; continue; fi
    TMP=$(mktemp)
    sed -E "s|^([^#].*$OLD/.*)$|# [切换于 $(date +%F) 停用，已迁至 gooday-harness] \1|" "$BAK" > "$TMP"
    crontab -u "$u" "$TMP" && rm -f "$TMP"
    after=$(crontab -u "$u" -l 2>/dev/null | grep -cE "^[^#].*$OLD/" || echo 0)
    [[ "$after" -eq 0 ]] && good "[$u] $before 条已停用（备份 $BAK）" \
                         || bad "[$u] 还剩 $after 条没停掉"
done

# ── 3. 移除旧 systemd 单元 ─────────────────────────────────────────
# 它们现在是 disabled+inactive，但单元文件还指向 $OLD。
# 留着的风险：日后有人 systemctl start 一下，或者哪次 enable 手滑，
# 就会起一个读旧目录的进程，和新的抢同一个数据库。
say "3. 移除指向 $OLD 的旧 systemd 单元"
for u in gooday-dispatcher gooday-lingxi gooday-ocr gooday-qingtianzu \
         gooday-ruyi gooday-weizhentian gooday-zhaocai; do
    f="/etc/systemd/system/$u.service"
    [[ -f "$f" ]] || continue
    systemctl stop "$u" 2>/dev/null
    systemctl disable "$u" 2>/dev/null
    mkdir -p /var/lib/gooday-harness/checkpoints/old-units
    mv "$f" /var/lib/gooday-harness/checkpoints/old-units/
    rm -rf "/etc/systemd/system/$u.service.d"
    good "$u 已停用并归档"
done
systemctl daemon-reload
systemctl reset-failed 2>/dev/null || true

# ── 4. 改名 ────────────────────────────────────────────────────────
# **改名不是删除。** 留着 goodayback 是为了万一漏了什么还能捞。
# 改名本身也是最好的验证手段：漏掉的引用会立刻炸出来，
# 而不是等三个月后某条 cron 悄悄失效。
say "4. $OLD → $BACK"
if [[ -d "$BACK" ]]; then
    good "$BACK 已存在，跳过（幂等）"
elif [[ -d "$OLD" ]]; then
    mv "$OLD" "$BACK" && good "已改名（原目录 $(du -sh "$BACK" 2>/dev/null | cut -f1)）"
else
    bad "$OLD 不存在，跳过"
fi

# ── 5. 复验：改完之后新栈还得是好的 ────────────────────────────────
# 【这一步不能省】：改名会立刻暴露所有漏掉的引用。
# 只验「改名成功」不算数，要验「改完之后系统还活着」。
say "5. 复验"
sleep 3
code=$(curl -sk -o /dev/null -w '%{http_code}' https://localhost/ || echo 000)
[[ "$code" == "200" ]] && good "站点仍 200" || bad "站点变成 $code —— 有东西还依赖 $OLD，立刻查"
for u in bot-lingxi bot-ruyi bot-qingtianzu bot-weizhentian bot-zhaocai dispatcher ocr; do
    systemctl is-active --quiet "gooday-harness-$u" \
        && good "gooday-harness-$u 仍在跑" || bad "gooday-harness-$u 挂了"
done
python3 "$REPO/workflows/patrol/run.py" 2>&1 | tail -6

echo
echo "────────────────────────────────────────────"
echo "完成：$ok 项正常，$warn 项需要看一眼"
echo
echo "接下来观察 24 小时，重点看这几条第一次触发："
echo "  02:00 client-summary / math-episodes   02:30 cert-renew"
echo "  08:05 invest-warmup（工作日）          09:00 daily-report"
echo "  日志都在 /var/log/gooday-harness/"
echo
echo "确认无误后再删 $BACK。删之前先确认 backups/ 里的快照不需要了。"
exit $(( warn > 0 ? 1 : 0 ))
