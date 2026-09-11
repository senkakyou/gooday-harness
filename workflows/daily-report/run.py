#!/usr/bin/env python3
"""
灵犀三合一日报 —— 工单 + 项目 + 本月财务快照
每天 09:00 由 cron 触发，灵犀发给大海（Id=1）。
替代原来的 daily-ticket-report.py。
"""
import sqlite3, json, time, os, hmac, hashlib, base64
import sys
import urllib.request, ssl
from datetime import date, datetime, timedelta, timezone

DB_PATH   = "/var/lib/docker/volumes/gooday_gooday_data/_data/gooday.db"
API_BASE  = "https://localhost"
LINGXI_ID = 20
LINGXI_NAME = "灵犀"
ADMIN_ID  = 1



def _jwt_secret():
    """取 JWT_SECRET：环境变量 > .env 直读 > 【响亮失败】。

    原来是 `os.environ.get("JWT_SECRET", "")` —— 缺失时拿空串去签名，
    每个请求 401，而日志里看起来「跑了、没报错」。cron 不 source .env
    就会静默进入这个状态（CLAUDE.md 明确要求脚本自带 .env 直读兜底）。
    宁可起不来，也不要用一个必然失败的密钥假装在工作。
    """
    s = os.environ.get("JWT_SECRET", "")
    if s:
        return s
    for p in ("/opt/gooday-harness/.env",):
        try:
            for line in open(p, encoding="utf-8"):
                if line.startswith("JWT_SECRET="):
                    return line.split("=", 1)[1].strip().strip("'\"")
        except OSError:
            pass
    raise SystemExit("❌ 找不到 JWT_SECRET（环境变量与 /opt/gooday-harness/.env 都没有）——"
                     "签出来的 token 必然 401，中止。cron 请用 set -a; source .env; set +a")

def b64url(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def gen_jwt(secret):
    db = sqlite3.connect(DB_PATH)
    tver = db.execute("SELECT TokenVersion FROM Users WHERE Id=?", (LINGXI_ID,)).fetchone()[0]
    db.close()
    header  = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")))
    payload = b64url(json.dumps({
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier": str(LINGXI_ID),
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name": LINGXI_NAME,
        "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "admin",
        "tver": str(tver),
        "exp": int(time.time()) + 3600,
        "iss": "gooday.ltd",
        "aud": "gooday.ltd"
    }, separators=(",", ":")))
    sig = hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    return f"{header}.{payload}.{b64url(sig)}"


ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def api_get(path, token):
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
        return json.loads(resp.read().decode())


def send_message(receiver_id, content, token):
    data = json.dumps({"Content": content}).encode("utf-8")
    req = urllib.request.Request(
        f"{API_BASE}/api/messages/{receiver_id}",
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
        return resp.status == 200


# ── 长内容必须分段（G21）────────────────────────────────────────────
# 服务端 PrivateMessageController 判 content.Length > 4000 直接 400。
# 2026-09-08 事故：灵犀一份长评审因此被整条丢掉，日志里只有三行 HTTP 400。
# 分段、上限、**失败补报**三件事都复用 packages/botkit/outbound.send_each ——
# 不在这里搓第二份循环（G03）。自己搓的那一版漏了「补报」：单段失败时
# 收件人看到的是一段完整的话，完全不知道后面还有（2026-09-08 灵犀评审指出）。
sys.path.insert(0, "/opt/gooday-harness/packages/botkit")
from outbound import MAX_CONTENT, send_each      # noqa: E402


def send_message_safe(receiver_id, content, token):
    """超长自动分段；单段失败不 break，最后补一条「第 x/y 段失败」。"""
    return send_each(content, lambda seg: send_message(receiver_id, seg, token),
                     tag="daily-report")


# 躺多久算「躺着不动」。大海 2026-09-11 定的：一天。
#
# 【为什么必须有这一项】：v2 删掉了所有自动流转（docs/decisions/006），
# 好处是没有诈尸、没有抢单、没有看门狗误伤；代价是**没人推的单会一直躺着**。
# 上线时这条缺口是明确欠着的——现在补上。
#
# 放在日报里而不是 patrol 里，是因为 patrol 只把发现写进证据链、不给人发消息，
# 而这件事的要求是「让灵犀提醒我」。日报本来就是灵犀每天发给大海的。
# 躺着的单每天都会再出现一次，这是刻意的：提醒一次就忘，等于没提醒。
STALE_DAYS = 1

# 只管怎么显示。【状态本身的真源在 API 的 TicketWorkflow】——
# 这里多一个键少一个键都不影响判断，因为下面用的是 .get(k, k) 兜底。
STATUS_LABELS = {
    "NEW": "待接单", "IN_PROGRESS": "开发中", "DELIVERED": "待验收",
    "CLOSED": "已结单", "BLOCKED": "卡住了", "CANCELLED": "已取消",
}


def _parse_ts(s):
    """解析时间戳。API 返回 ISO（带 T、可能带 Z 和微秒），库里是空格分隔。
    【解析不出来要返回 None 而不是当成"很久以前"】——否则格式一变，
    全部单子都会被判成躺着不动，日报天天喊狼来了，然后就没人看了。"""
    if not s:
        return None
    t = str(s).replace("T", " ").replace("Z", "").strip()
    if "." in t:
        t = t.split(".")[0]
    try:
        return datetime.strptime(t[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def build_report(ticket_data, finance_data):
    today = date.today().strftime("%Y-%m-%d")
    period = date.today().strftime("%Y-%m")
    lines = [f"📊 **灵犀日报 · {today}**\n"]

    # ── 订单 ──
    # stats 是 {状态: 条数}，服务端按实际分组返回。
    # 【遍历它给的键，不是列举我以为有的几个】——列举法在加状态时必漏，
    # 而漏掉的那类单会从日报里静默消失。
    t_stats  = ticket_data.get("stats", {}) or {}
    new_today = ticket_data.get("newToday", [])
    active    = ticket_data.get("active", [])

    lines.append("**🗂 订单**")
    total = sum(t_stats.values())
    parts = [f"{STATUS_LABELS.get(k, k)} {v}" for k, v in sorted(t_stats.items()) if v]
    lines.append(f"总计 {total} 条" + ("　·　" + " · ".join(parts) if parts else ""))
    if new_today:
        lines.append(f"今日新增 {len(new_today)} 条：" +
                     "、".join(f"{t['ticketNo']}" for t in new_today[:3]) +
                     ("…" if len(new_today) > 3 else ""))
    if active:
        for t in active[:6]:
            st = STATUS_LABELS.get(t.get("status", ""), t.get("status", ""))
            blocked = f" ⚠️ {t['blockedReason']}" if t.get("blockedReason") else ""
            lines.append(f"  [{t['ticketNo']}] {t['title']} · {st}{blocked}")
        if len(active) > 6:
            lines.append(f"  …共 {len(active)} 条在跑")
    else:
        lines.append("  暂无在跑的订单")

    # ── 躺着不动的单（大海亲自要的提醒）──
    # 【只看 UpdatedAt，不看 CreatedAt】：客户补充需求、大海改金额都会刷新它，
    # 按建单时间算的话，一张正在来回沟通的单也会被当成「没人管」。
    stale = []
    cutoff = datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)
    for t in active:
        if t.get("status") != "NEW":
            continue
        ts = _parse_ts(t.get("updatedAt") or t.get("createdAt"))
        if ts is not None and ts < cutoff:
            stale.append((t, (datetime.now(timezone.utc) - ts).days))
    if stale:
        lines.append("")
        lines.append(f"**⚠️ 这些单躺着没动超过 {STALE_DAYS} 天，等你拍**")
        for t, days in sorted(stale, key=lambda x: -x[1]):
            lines.append(f"  [{t['ticketNo']}] {t['title']} —— 躺了 {days} 天"
                         f"（客户 {t.get('clientName') or '—'}）")
        lines.append("  → 跟客户确认细节和价格后，在 /admin/tickets 填金额、点「开工」；"
                     "不做就点「取消订单」。")

    # ── 财务（本月） ──
    f = finance_data
    income   = float(f.get("income", 0))
    received = float(f.get("received", 0))
    pending  = float(f.get("pending", 0))
    count    = f.get("orderCount", 0)

    lines.append("")
    lines.append(f"**💰 财务（{period}）**")
    lines.append(f"收入 ¥{income:.2f}（{count} 笔）· 已收 ¥{received:.2f} · 待收 ¥{pending:.2f}")
    if pending > 0:
        lines.append(f"⚠️ 待收 ¥{pending:.2f}，请跟进")

    # 【「今日进展」整段已删】原来它读 /api/ticket-events?eventType=notify。
    # 事件表 2026-09-10 删掉了（docs/decisions/006）——它有 119 条永远卡在
    # new 没人消费，而全站只有这份日报在读其中的 notify 一类。
    # 订单的动静现在看上面那段，逐单细节看后台的工作记录时间线。

    lines.append("")
    lines.append("详情：`/admin/tickets` · `/admin/finance`")

    return "\n".join(lines)


def main():
    secret = _jwt_secret()
    if not secret:
        print("[lingxi-daily] 错误：JWT_SECRET 未设置", flush=True)
        return

    token = gen_jwt(secret)
    today_period = date.today().strftime("%Y-%m")

    try:
        ticket_data = api_get("/api/tickets/daily-report", token)
    except Exception as e:
        print(f"[lingxi-daily] 获取订单日报失败: {e}", flush=True)
        ticket_data = {"stats": {}, "newToday": [], "active": []}

    try:
        finance_data = api_get(f"/api/finance/monthly-report?period={today_period}", token)
    except Exception as e:
        print(f"[lingxi-daily] 获取财务数据失败: {e}", flush=True)
        finance_data = {}

    report = build_report(ticket_data, finance_data)
    print(f"[lingxi-daily] 报告（{len(report)} 字）:\n{report[:300]}...", flush=True)

    # 【不再截断】。这里原来是 `if len(report) > 990: report = report[:987] + "..."` ——
    # 990 是分段能力存在【之前】留下的保命措施，而它保的方式是【把尾巴直接扔掉】：
    # 日报写长了，后半截静默消失，收件人只看到一个「...」。
    # 现在 send_message_safe 会按服务端上限分段发，内容一个字都不丢。
    # （2026-09-08 灵犀第四轮建议「grep 一遍 Python 侧拿 len() 卡长度的点」，扫出来的）

    try:
        ok = send_message_safe(ADMIN_ID, report, token)
        print("[lingxi-daily] 日报发送 ✅" if ok else "[lingxi-daily] 发送失败", flush=True)
    except Exception as e:
        print(f"[lingxi-daily] 发送异常: {e}", flush=True)


if __name__ == "__main__":
    main()
