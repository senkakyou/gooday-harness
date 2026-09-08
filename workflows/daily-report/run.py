#!/usr/bin/env python3
"""
灵犀三合一日报 —— 工单 + 项目 + 本月财务快照
每天 09:00 由 cron 触发，灵犀发给大海（Id=1）。
替代原来的 daily-ticket-report.py。
"""
import sqlite3, json, time, os, hmac, hashlib, base64
import sys
import urllib.request, ssl
from datetime import date

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


PRIORITY_LABELS = {"urgent": "🔴", "high": "🟠", "normal": "⚪", "low": "🔵"}
STATUS_LABELS   = {
    "pending": "待确认", "analyst_complete": "待客户确认报价", "confirmed": "已确认待付款",
    "in_progress": "开发中", "reviewing": "终审中", "delivering": "交付待验收",
    "testing": "测试中", "done": "已完成", "cancelled": "已取消",
    "failed": "失败待处理", "customer_rejected": "客户拒收", "refunding": "退款中", "refunded": "已退款",
}
PROJ_STATUS = {
    "planning": "规划", "in_progress": "进行中",
    "testing": "测试", "done": "已完成", "cancelled": "已取消",
}


def _summarize_event(ev):
    """从 notify 事件提取一行摘要：优先 payload.title，否则 body 首行，截断到 40 字"""
    import json as _json
    try:
        p = _json.loads(ev.get("payload") or "{}")
    except Exception:
        p = {}
    text = (p.get("title") or p.get("body") or ev.get("eventType") or "").strip()
    first = text.splitlines()[0] if text else ""
    first = first.replace("**", "")
    return first[:40] + ("…" if len(first) > 40 else "")


def build_report(ticket_data, project_data, finance_data, notifications=None):
    today = date.today().strftime("%Y-%m-%d")
    period = date.today().strftime("%Y-%m")
    lines = [f"📊 **灵犀日报 · {today}**\n"]

    # ── 工单 ──
    t_stats  = ticket_data.get("stats", {})
    new_today = ticket_data.get("newToday", [])
    active    = ticket_data.get("active", [])

    lines.append("**🗂 工单**")
    lines.append(
        f"总计 {t_stats.get('total', 0)} 条 · "
        f"待确认 {t_stats.get('pending', 0)} · "
        f"进行中 {t_stats.get('inProgress', 0)} · "
        f"已完成 {t_stats.get('done', 0)}"
    )
    if new_today:
        lines.append(f"今日新增 {len(new_today)} 条：" +
                     "、".join(f"{t['ticketNo']}" for t in new_today[:3]) +
                     ("…" if len(new_today) > 3 else ""))
    if active:
        for t in active[:4]:
            pri = PRIORITY_LABELS.get(t.get("priority", "normal"), "")
            st  = STATUS_LABELS.get(t.get("status", ""), "")
            lines.append(f"  {pri} [{t['ticketNo']}] {t['title']} · {st}")
        if len(active) > 4:
            lines.append(f"  …共 {len(active)} 条活跃工单")
    else:
        lines.append("  暂无活跃工单")

    # ── 项目 ──
    p = project_data
    lines.append("")
    lines.append("**📁 项目**")
    lines.append(
        f"总计 {p.get('total', 0)} 个 · "
        f"规划中 {p.get('planning', 0)} · "
        f"进行中 {p.get('inProgress', 0)} · "
        f"测试中 {p.get('testing', 0)} · "
        f"已完成 {p.get('done', 0)}"
    )

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

    # ── 今日进展（P2/P3，V3 通知分级：这些白天没实时打扰您，汇总在此）──
    if notifications:
        p2 = [e for e in notifications if (e.get("level") or "").upper() == "P2"]
        p3 = [e for e in notifications if (e.get("level") or "").upper() == "P3"]
        lines.append("")
        lines.append(f"**🔔 今日进展**（P2 {len(p2)} · P3 {len(p3)}，已为您过滤实时打扰）")
        for e in p2[:6]:
            lines.append(f"  · {_summarize_event(e)}")
        if len(p2) > 6:
            lines.append(f"  …另有 {len(p2) - 6} 条")

    lines.append("")
    lines.append("详情：`/admin/tickets` · `/admin/projects` · `/admin/finance`")

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
        print(f"[lingxi-daily] 获取工单日报失败: {e}", flush=True)
        ticket_data = {"stats": {}, "newToday": [], "active": []}

    try:
        project_data = api_get("/api/projects/stats", token)
    except Exception as e:
        print(f"[lingxi-daily] 获取项目统计失败: {e}", flush=True)
        project_data = {}

    try:
        finance_data = api_get(f"/api/finance/monthly-report?period={today_period}", token)
    except Exception as e:
        print(f"[lingxi-daily] 获取财务数据失败: {e}", flush=True)
        finance_data = {}

    try:
        since = date.today().strftime("%Y-%m-%d") + "T00:00:00Z"
        notifications = api_get(f"/api/ticket-events?eventType=notify&since={since}&limit=500", token)
        if not isinstance(notifications, list):
            notifications = []
    except Exception as e:
        print(f"[lingxi-daily] 获取今日通知事件失败: {e}", flush=True)
        notifications = []

    report = build_report(ticket_data, project_data, finance_data, notifications)
    print(f"[lingxi-daily] 报告（{len(report)} 字）:\n{report[:300]}...", flush=True)

    if len(report) > 990:
        report = report[:987] + "..."

    try:
        ok = send_message_safe(ADMIN_ID, report, token)
        print("[lingxi-daily] 日报发送 ✅" if ok else "[lingxi-daily] 发送失败", flush=True)
    except Exception as e:
        print(f"[lingxi-daily] 发送异常: {e}", flush=True)


if __name__ == "__main__":
    main()
