#!/usr/bin/env python3
"""
灵犀财务月报
每月1日定时调用 /api/finance/monthly-report，生成上月财务总结私信发给站长（大海，Id=1）。
用法：python3 monthly-finance-report.py [2026-05]
      不带参数时自动取上月账期
"""
import sqlite3, json, time, os, sys, hmac, hashlib, base64
import urllib.request, ssl
from datetime import date

DB_PATH = "/var/lib/docker/volumes/gooday_gooday_data/_data/gooday.db"
API_BASE = "https://localhost"
LINGXI_ID = 20
LINGXI_NAME = "灵犀"
ADMIN_ID = 1



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
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")))
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


def api_get(path, token):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
        return json.loads(resp.read().decode())


def send_message(receiver_id, content, token):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
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
                     tag="finance-report")


def format_report(data):
    period = data.get("period", "")
    income  = float(data.get("income", 0))
    expense = float(data.get("expense", 0))
    profit  = float(data.get("profit", 0))
    received = float(data.get("received", 0))
    pending  = float(data.get("pending", 0))
    count    = data.get("orderCount", 0)
    ytd      = float(data.get("ytdIncome", 0))
    details  = data.get("details", [])

    profit_icon = "📈" if profit >= 0 else "📉"
    profit_sign = "+" if profit >= 0 else ""

    lines = [f"💰 **财务月报 · {period}**\n"]

    lines.append("**📊 本月汇总**")
    lines.append(f"- 收入：¥{income:.2f}（{count} 笔）")
    if expense > 0:
        lines.append(f"- 支出：¥{expense:.2f}")
    lines.append(f"- 净利润：{profit_icon} {profit_sign}¥{profit:.2f}")
    lines.append(f"- 已收款：¥{received:.2f} · 待收款：¥{pending:.2f}")
    lines.append(f"- 今年累计收入：¥{ytd:.2f}")
    lines.append("")

    if details:
        income_items = [d for d in details if d.get("type") == "income"]
        expense_items = [d for d in details if d.get("type") == "expense"]

        if income_items:
            lines.append(f"**🧾 收入明细（{len(income_items)} 笔）**")
            for d in income_items[:8]:
                status_map = {
                    "pending": "待收", "received": "已收",
                    "partial": "部分", "refunded": "已退"
                }
                st = status_map.get(d.get("paymentStatus", ""), "")
                lines.append(f"- {d['title']} ¥{float(d['amount']):.2f} [{st}]")
            if len(income_items) > 8:
                lines.append(f"  …共 {len(income_items)} 笔，详见后台")
            lines.append("")

        if expense_items:
            lines.append(f"**💸 支出明细（{len(expense_items)} 笔）**")
            for d in expense_items[:5]:
                lines.append(f"- {d['title']} ¥{float(d['amount']):.2f}")
            lines.append("")

    if pending > 0:
        lines.append(f"⚠️ 待收款 ¥{pending:.2f}，请及时跟进。")
    else:
        lines.append("✅ 所有款项已收齐。")

    lines.append("\n详细记录请前往 `/admin/finance` 查看。")
    return "\n".join(lines)


def last_month_period():
    today = date.today()
    if today.month == 1:
        return f"{today.year - 1}-12"
    return f"{today.year}-{str(today.month - 1).padStart(2, '0')}"


def last_month_period():
    today = date.today()
    if today.month == 1:
        return f"{today.year - 1}-12"
    return f"{today.year}-{str(today.month - 1).zfill(2)}"


def main():
    secret = _jwt_secret()
    if not secret:
        print("[finance-report] 错误：JWT_SECRET 未设置", flush=True)
        return

    period = sys.argv[1] if len(sys.argv) > 1 else last_month_period()
    print(f"[finance-report] 生成账期：{period}", flush=True)

    token = gen_jwt(secret)

    try:
        data = api_get(f"/api/finance/monthly-report?period={period}", token)
    except Exception as e:
        print(f"[finance-report] 获取月报失败: {e}", flush=True)
        return

    # 没有记录时也发送（让站长知道本月无数据）
    report = format_report(data)
    print(f"[finance-report] 报告（{len(report)} 字）：\n{report[:300]}…", flush=True)

    # 【不再截断】。这里原来是 `if len(report) > 990: report = report[:987] + "..."` ——
    # 990 是分段能力存在【之前】留下的保命措施，而它保的方式是【把尾巴直接扔掉】：
    # 财报写长了，后半截静默消失，收件人只看到一个「...」。
    # 现在 send_message_safe 会按服务端上限分段发，内容一个字都不丢。
    # （2026-09-08 灵犀第四轮建议「grep 一遍 Python 侧拿 len() 卡长度的点」，扫出来的）

    try:
        ok = send_message_safe(ADMIN_ID, report, token)
        if ok:
            print("[finance-report] 月报已发送给大海 ✅", flush=True)
        else:
            print("[finance-report] 发送失败", flush=True)
    except Exception as e:
        print(f"[finance-report] 发送异常: {e}", flush=True)


if __name__ == "__main__":
    main()
