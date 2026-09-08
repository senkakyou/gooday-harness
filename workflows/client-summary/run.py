#!/usr/bin/env python3
"""
客户 AI 画像生成脚本（灵犀调用）
- 遍历所有客户，调用 /api/clients/:id/summary-context 拿到原始上下文
- 调用 Claude CLI 生成客户画像摘要
- PUT /api/clients/:id/ai-summary 存回数据库
- 每个客户每 7 天最多刷新一次
用法：python3 generate-client-summary.py [--all]  # --all 强制刷新全部
"""
import json, os, subprocess, sqlite3, time, hmac, hashlib, base64
import urllib.request, ssl, sys
from datetime import datetime, timezone, timedelta

# 打子进程输出前必须脱敏（AGENTS.md 三条不可协商第一条）
sys.path.insert(0, "/opt/gooday-harness/packages/trace")
from trace import redact                                  # noqa: E402

DB_PATH  = "/var/lib/docker/volumes/gooday_gooday_data/_data/gooday.db"
API_BASE = "https://localhost"
LINGXI_ID   = 20
LINGXI_NAME = "灵犀"

REFRESH_DAYS = 7   # 画像多少天后才重新生成



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
        "exp":  int(time.time()) + 3600,
        "iss":  "gooday.ltd",
        "aud":  "gooday.ltd",
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


def api_put(path, body, token):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="PUT",
    )
    with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
        return json.loads(resp.read().decode())


def call_claude(prompt):
    """调用本机 claude CLI 生成摘要，返回纯文本"""
    result = subprocess.run(
        ["claude", "-p", prompt],
        capture_output=True, text=True, timeout=120
    )
    if result.returncode != 0:
        # 脱敏后再打：claude 的认证类报错里常带 token 前缀 / Authorization 回显，
        # 而这条异常会落进 cron 日志（AGENTS.md 不可协商第一条）。
        raise RuntimeError(f"claude CLI 报错: {redact(result.stderr)}")
    return result.stdout.strip()


def needs_refresh(ctx, force_all):
    """判断是否需要重新生成画像"""
    if force_all:
        return True
    # 没有工单就跳过
    if not ctx.get("tickets"):
        return False
    # 画像为空直接刷
    summary_updated = ctx.get("aiSummaryUpdatedAt")
    if not summary_updated:
        return True
    # 超过 REFRESH_DAYS 天则刷
    try:
        updated_at = datetime.fromisoformat(summary_updated.replace("Z", "+00:00"))
        return datetime.now(timezone.utc) - updated_at > timedelta(days=REFRESH_DAYS)
    except Exception:
        return True


def build_prompt(ctx):
    name    = ctx.get("clientName", "未知")
    contact = ctx.get("contact", "")
    tickets = ctx.get("tickets", [])
    msgs    = ctx.get("recentMessages") or []
    note    = ctx.get("adminNote") or ""

    ticket_text = ""
    for t in tickets[:10]:
        ticket_text += f"  - [{t.get('ticketNo','')}] {t.get('title','')}（{t.get('status','')}）预算 {t.get('budget') or '未知'} 报价 {t.get('estimatedPrice') or '未报价'}\n"

    msg_text = ""
    for m in msgs[:20]:
        role = "客户" if m.get("senderUsername") != "如意" else "如意"
        msg_text += f"  {role}: {(m.get('content') or '')[:120]}\n"

    return f"""你是灵犀，Gooday 定制开发平台的数字秘书。请根据以下客户信息，生成一段 80-150 字的客户画像摘要，供内部参考。

要求：
- 覆盖：行业/身份、沟通风格、决策特征、预算范围、主要需求类型
- 语气：专业简洁，像 CRM 系统里的客户备注
- 格式：纯文字，不加 Markdown、不加标题

客户姓名：{name}
联系方式：{contact}
内部备注：{note or '无'}

历史工单：
{ticket_text or '  暂无'}

近期对话摘录（最新在前）：
{msg_text or '  暂无'}

请直接输出摘要正文，不要有任何开头说明："""


def main():
    force_all = "--all" in sys.argv
    secret = _jwt_secret()
    if not secret:
        print("[summary] 错误：JWT_SECRET 未设置", flush=True)
        return

    token = gen_jwt(secret)

    # 拉取客户列表（最多 200 个）
    try:
        data = api_get("/api/clients?pageSize=200", token)
    except Exception as e:
        print(f"[summary] 获取客户列表失败: {e}", flush=True)
        return

    clients = data.get("list", [])
    print(f"[summary] 共 {len(clients)} 位客户", flush=True)

    updated, skipped = 0, 0
    for c in clients:
        cid = c["id"]
        name = c.get("name", "—")
        try:
            ctx = api_get(f"/api/clients/{cid}/summary-context", token)
            # 把已有的 aiSummaryUpdatedAt 也并入判断
            ctx["aiSummaryUpdatedAt"] = c.get("aiSummaryUpdatedAt")

            if not needs_refresh(ctx, force_all):
                skipped += 1
                continue

            prompt = build_prompt(ctx)
            summary = call_claude(prompt)
            if not summary:
                print(f"[summary] 客户 {name}({cid}) Claude 未返回内容，跳过", flush=True)
                continue

            api_put(f"/api/clients/{cid}/ai-summary", {"summary": summary}, token)
            print(f"[summary] ✅ {name}({cid}): {summary[:60]}…", flush=True)
            updated += 1
            time.sleep(3)  # 避免并发过快

        except Exception as e:
            print(f"[summary] ❌ 客户 {name}({cid}) 失败: {e}", flush=True)

    print(f"[summary] 完成：更新 {updated} 位，跳过 {skipped} 位", flush=True)


if __name__ == "__main__":
    main()
