#!/usr/bin/env python3
"""
灵犀 COO 巡检 —— 内部流程协调中心（cron 每5分钟）

职责（监督式 COO）：发现卡死/异常 → 自动处置（重推流程/重启服务/修复状态）→
摆不平的上报大海，并说清卡在哪、谁负责。

巡检项：
  1. bot systemd 服务挂掉 → 自动重启 + 上报
  2. app 容器停了 → docker start + 上报
  3. 卡死工单：
     - pending      > 30分钟（擎天柱没处理完）→ 以如意身份重推通知（幂等重入）
     - analyst_complete > 24小时（客户未确认报价）→ 如意温柔提醒客户
     - confirmed    > 24小时（客户未付款）→ 如意提醒付款 + 提示大海
     - in_progress  > 2小时（威震天没交付）→ 重启威震天（重启后自动重捡）
     - testing      > 48小时（验收积压）→ 提醒大海
     - failed       → 上报大海
  4. 状态不一致：工单 done 但项目未 done → 自动同步
  5. 收件箱积压：bot 未读消息超 30 分钟 → 重启对应 bot

用法：python3 lingxi-coo-patrol.py [--dry-run]
"""
import sqlite3, subprocess, json, time, os, sys, hmac, hashlib, base64
import urllib.request, ssl
from datetime import datetime, timezone, timedelta

DB_PATH    = "/var/lib/docker/volumes/gooday_gooday_data/_data/gooday.db"
STATE_PATH = "/var/lib/gooday-harness/state/coo-patrol/state.json"
# ⚠️ 【命令行开关，不是环境变量】。
# 2026-09-08 我自己栽了：一直用 `DRY_RUN=1 python3 run.py` 测，
# 以为在干跑，实际 DRY_RUN 恒为 False —— **4 条测试注入真发给了站长**。
# 长得像环境变量的东西却只认 argv，是这类误用的温床。
# 所以两种都认，并且【环境变量为真时也生效】：
# 演练场景下宁可多干跑一次，也不要真发出去。
DRY_RUN    = ("--dry-run" in sys.argv
              or os.environ.get("DRY_RUN", "").lower() in ("1", "true", "yes"))

LINGXI_ID, LINGXI_NAME = 20, "灵犀"
OPTIMUS_ID = 21
RUYI_ID, RUYI_NAME = 23, "如意"
DAHAI_ID = 1

BOT_SERVICES = {
    "gooday-harness-bot-lingxi": LINGXI_ID,
    "gooday-harness-bot-qingtianzu": OPTIMUS_ID,
    "gooday-harness-bot-weizhentian": 22,
    "gooday-harness-bot-ruyi": RUYI_ID,
    "gooday-harness-bot-zhaocai": 25,
}
# 收件箱积压检查只针对真正消费收件箱的 bot（威震天不读私信，排除）
INBOX_BOTS = {LINGXI_ID: "gooday-harness-bot-lingxi", OPTIMUS_ID: "gooday-harness-bot-qingtianzu",
              RUYI_ID: "gooday-harness-bot-ruyi", 25: "gooday-harness-bot-zhaocai"}

# pending 看门狗（项一/四配套）：各 bot 回执发送身份(uid, 名称, JWT角色) + 超时阈值
PENDING_BOTS = {
    "zhaocai":     (25,         "招财",   "admin"),
    "ruyi":        (RUYI_ID,    "如意",   "staff"),
    "qingtianzu":  (OPTIMUS_ID, "擎天柱", "admin"),
    "weizhentian": (22,         "威震天", "admin"),
    "lingxi":      (LINGXI_ID,  "灵犀",   "admin"),
}
PENDING_THRESHOLD_MIN = {"dispatch": 10, "message": 5}  # 派单类 10min / 消息类 5min

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE



# ═══ 并行输出：文字给人看，结构化 finding 进证据流 ═══════════════
#
# 迁移之前 coo-patrol 只产出一条发给站长的消息 —— 它每 5 分钟发现的东西
# 不进 events/、不受 patrol 的退避与升级管、patrol 的巡检也看不到，
# **第二层循环对这 8 项业务检查是瞎的**（灵犀 2026-09-08 指出根因：
# 两条互不相通的输出路径，而可见性是基础设施问题，
# 不该由「这条给人看还是给机器看」来决定）。
#
# 做法是**纯加法**：27 个 escalations.append 调用点一个都不动，
# 换掉 escalations 这个对象本身。文字那一路照旧（人还在读，别断），
# 同时多落一条结构化 finding。结构化跑对一周再考虑删文字那路。
_HARNESS = "/opt/gooday-harness"
sys.path.insert(0, os.path.join(_HARNESS, "packages", "trace"))
sys.path.insert(0, os.path.join(_HARNESS, "packages", "finding"))
try:
    from trace import Task as _Task
    import finding as _fnd
except Exception as _e:          # 装不上就退回纯文字，不能让巡检本身挂掉
    _Task, _fnd = None, None
    print(f"[coo-patrol] ⚠️ 证据流不可用，退回纯文字输出: {_e}",
          file=sys.stderr, flush=True)


class _Escalations(list):
    """append 时同时落一条结构化 finding。调用点无感。"""

    def __init__(self):
        super().__init__()
        self.current = "coo"          # 当前正在跑哪一项，由 main 设置
        self.findings = []

    def append(self, text):
        super().append(text)
        self.findings.append({"check": self.current, "level": "P1",
                              "what": str(text)[:120], "why": str(text),
                              "fix": "见 workflows/coo-patrol/README.md"})


def log(msg):
    print(f"[{datetime.now().strftime('%m-%d %H:%M:%S')}][COO巡检] {msg}", flush=True)

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)   # 防数据库锁瞬断（#27 规范 / V3.1 P3）
    conn.row_factory = sqlite3.Row
    return conn

def parse_ts(s):
    """解析 DB 时间戳（'YYYY-MM-DD HH:MM:SS.fff' 或 ISO T/Z），返回 UTC datetime"""
    if not s:
        return None
    s = s.replace("T", " ").rstrip("Z")
    if "." in s:
        s = s.split(".")[0]
    try:
        return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None

def age_minutes(ts_str):
    ts = parse_ts(ts_str)
    if ts is None:
        return 0
    return (datetime.now(timezone.utc) - ts).total_seconds() / 60


# ---- 去重状态 ----

def load_state():
    try:
        with open(STATE_PATH) as f:
            return json.load(f)
    except Exception:
        return {}

def save_state(state):
    if DRY_RUN:
        return
    with open(STATE_PATH, "w") as f:
        json.dump(state, f, ensure_ascii=False)

def dedup(state, key, window_hours):
    """该 key 在窗口期内已处理过 → True（跳过）；否则记录时间并返回 False"""
    now = time.time()
    if now - state.get(key, 0) < window_hours * 3600:
        return True
    state[key] = now
    return False


# ---- API 工具（与各 bot 保持相同风格）----

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

def read_jwt_secret() -> str:
    secret = os.environ.get("JWT_SECRET", "")
    if not secret:
        with open("/opt/gooday-harness/.env") as f:
            for line in f:
                if line.startswith("JWT_SECRET="):
                    secret = line.strip().split("=", 1)[1].strip('"\'')
    return secret

def dispatch_is_on() -> bool:
    """读 .env 的 V3_DISPATCH：on 表示调度器已接管工单自愈，patrol 不再重复处理卡单"""
    v = os.environ.get("V3_DISPATCH", "")
    if not v:
        try:
            with open("/opt/gooday-harness/.env") as f:
                for line in f:
                    if line.startswith("V3_DISPATCH="):
                        v = line.strip().split("=", 1)[1].strip('"\'')
        except Exception:
            pass
    return v.lower() == "on"

def gen_token(uid: int, uname: str, role: str) -> str:
    jwt_secret = read_jwt_secret()
    with get_db() as conn:
        row = conn.execute("SELECT TokenVersion FROM Users WHERE Id=?", (uid,)).fetchone()
        tver = row["TokenVersion"] if row else "1"
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64url(json.dumps({
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier": str(uid),
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name": uname,
        "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": role,
        "tver": str(tver),
        "exp": int(time.time()) + 600,
        "iss": "gooday.ltd", "aud": "gooday.ltd"
    }).encode())
    sig = b64url(hmac.new(jwt_secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"

def get_app_ip() -> str:
    try:
        r = subprocess.run(["docker", "inspect", "gooday-harness-api",
                            "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"],
                           capture_output=True, text=True, timeout=5)
        if r.stdout.strip():
            return r.stdout.strip()
    except Exception:
        pass
    return "127.0.0.1"

def api_call(method, path, body=None, uid=LINGXI_ID, uname=LINGXI_NAME, role="admin"):
    if DRY_RUN:
        log(f"DRY-RUN api_call {method} {path} as {uname}")
        return {}
    token = gen_token(uid, uname, role)
    url = f"http://{get_app_ip()}:8080{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"error": e.code, "msg": e.read().decode()[:200]}
    except Exception as e:
        return {"error": str(e)}

# 出口白名单：coo-patrol 以灵犀身份只发给站长，不发给任何其他人。
# 写在这里而不是配置文件，是因为它就一条且是安全边界——
# 让它跟着代码走比散到配置里更难被无意改掉。
OUTBOUND_WHITELIST = {LINGXI_ID: {DAHAI_ID}}


def send_as(uid, uname, role, receiver_id, content):
    # 出口白名单：名单外拦截 + 告警站长。
    #
    # 迁移时改过两处（2026-09-07）：
    # 1. 原来 import 的 `bot_common` 是旧 scripts/ 里的模块，没跟着迁 ——
    #    实测报 `No module named 'bot_common'`。改用 packages/botkit/outbound，
    #    harness 本来就有这个能力，不该在这里复制第二份（G03）。
    # 2. 原来导入失败时【保守放行】。那是把「检查没跑成」当成「检查通过」——
    #    本项目最痛恨的形态，而且这里是安全控制：白名单查不了就更不该发。
    #    改成 fail-closed：查不成就不发，并记下原因。
    try:
        sys.path.insert(0, "/opt/gooday-harness/packages/botkit")
        import outbound as _ob
        _ob.configure(OUTBOUND_WHITELIST)
        if not _ob.allowed(uid, receiver_id):
            log(f"⚠️ 出口拦截 身份{uid}→{receiver_id}：不在白名单，未发")
            api_call("POST", f"/api/messages/{DAHAI_ID}",
                     {"content": f"⚠️ 出口拦截：coo-patrol(身份{uid})欲发给 {receiver_id}，已拦未发。\n内容首60字：{content[:60]}"},
                     uid=LINGXI_ID, uname=LINGXI_NAME, role="admin")
            return None
    except Exception as e:
        # 【fail-closed】：查不成 = 不发。放行才是危险的那一边。
        log(f"❌ 出口白名单检查失败，按不发处理（不是放行）：{e}")
        return None
    # 【超长必须分段】。服务端判 content.Length > 4000 直接 400，整条丢掉
    # （2026-09-08 事故，见 docs/incidents/2026-09-08-long-reply-dropped.md）。
    # 巡检报告正是最容易写长的那类。
    #
    # 这里的自嘲写过两遍了，第二遍是灵犀 2026-09-08 复评指出的：
    #   第一版只借了 outbound 的 allowed()  —— 半个能力，split() 的坑照踩；
    #   第二版借了 split() 却自己搓循环     —— 还是半个，漏了「失败补报」，
    #                                          而且只返回最后一段的结果，
    #                                          前面段失败调用方完全看不见。
    # 现在整段交给 outbound.send_each：分段、逐段发、失败补报三件事只有一份。
    ok_all = True

    def _one(seg):
        nonlocal ok_all
        r = api_call("POST", f"/api/messages/{receiver_id}", {"content": seg},
                     uid=uid, uname=uname, role=role)
        good = not (isinstance(r, dict) and r.get("error"))
        if not good:
            ok_all = False
        return good

    try:
        _ob.send_each(content, _one, tag="coo-patrol")
    except Exception as e:
        # 分段器本身出问题不该把消息吃掉：退回单段直发，并说清楚降级了。
        log(f"⚠️ 分段发送异常，退回单段直发（可能被服务端判 400）：{e}")
        return api_call("POST", f"/api/messages/{receiver_id}", {"content": content},
                        uid=uid, uname=uname, role=role)
    return {"ok": ok_all}

# ═══ 2026-09-07：coo-patrol 不再自己动手 ═══════════════════════════
#
# 摘掉的原因不是「重复」那么简单，是**两个看门狗同时对同一批 unit 动手**：
#   · 本文件 check_dispatcher 在 :00 重启 dispatcher（心跳停 >10 分钟）
#   · workflows/patrol 的 services 检查在 :02 用同样的阈值再重启一次
# 两边看的还是**两个不同的心跳文件**，谁也不知道对方刚动过手。
# patrol 当初设成 shadow 就是为了防这个；把 patrol 切 active 时若不摘这里，
# 那件事会以另一个形状原样回来（灵犀 2026-09-07 指出，我漏了）。
#
# 我漏掉的原因值得记：我核对的是「注掉了哪几个 check」，
# **没核对剩下的 check 里还有没有 restart** —— 查了标签，没查行为。
#
# 现在的分工：**patrol 是唯一动手的**（它有动作分级、白名单、升级路径），
# coo-patrol 只负责发现业务态异常并上报。收件箱积压的自愈能力
# 已移到 patrol 的 bot_inbox 检查项，在那边统一受分级约束。
def _REMOVED_restart_service(name):
    """【已停用，保留仅为记录】。coo-patrol 不再动手，见上方注释。

    函数体保留是为了让「以前怎么做的」有出处；但它不再被任何地方调用，
    改名加 _REMOVED_ 前缀是为了让「不小心又调它」变成 NameError 而不是静默重启。
    """
    if DRY_RUN:
        log(f"DRY-RUN systemctl restart {name}")
        return True
    r = subprocess.run(["systemctl", "restart", name], capture_output=True, text=True)
    return r.returncode == 0


# ---- 巡检项 ----

def check_services(state, actions, escalations):
    for svc in BOT_SERVICES:
        r = subprocess.run(["systemctl", "is-active", svc], capture_output=True, text=True)
        if r.stdout.strip() != "active":
            log(f"服务 {svc} 状态异常：{r.stdout.strip()}")
            escalations.append(f"服务 {svc} 状态异常（重启由 workflows/patrol 负责）")

    r = subprocess.run(["docker", "inspect", "gooday-harness-api", "--format", "{{.State.Running}}"],
                       capture_output=True, text=True)
    if r.stdout.strip() != "true":
        # 动手交给 patrol（单一执行者）。原来这里 `docker start`，
        # 留着就是雷：本函数现在没被 main 调用，但随时可能被重新启用，
        # 而**按关键词搜 restart 搜不到 `docker start`**（灵犀指出，
        # 所以复核判据要换成「有没有 subprocess 调 systemctl/docker」）。
        log("gooday-harness-api 容器未运行")
        escalations.append("网站容器停止运行，请确认网站是否正常（启动交给 patrol）")


def check_stuck_tickets(state, actions, escalations):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT Id, TicketNo, Title, Status, EstimatedPrice, ClientId, ClientName, "
            "Description, UpdatedAt FROM Tickets "
            "WHERE Status IN ('pending','analyst_complete','confirmed','in_progress','testing','failed')"
        ).fetchall()

    for t in rows:
        t = dict(t)
        tid, tno, status = t["Id"], t["TicketNo"], t["Status"]
        stale_min = age_minutes(t["UpdatedAt"])

        if status == "pending" and stale_min > 30:
            if dedup(state, f"repush-{tid}", 6):
                continue
            # 以如意身份重推给擎天柱（handle_ticket_notification 已幂等，可安全重试）
            log(f"工单 {tno} pending 卡了 {stale_min:.0f} 分钟，重推擎天柱")
            send_as(RUYI_ID, RUYI_NAME, "staff", OPTIMUS_ID,
                    f"📋 新工单需要分析（COO巡检重推）\n\n工单ID：{tid}\n编号：{tno}\n"
                    f"标题：{t['Title']}\n客户：{t['ClientName']}\n\n请生成项目方案并回报站长。")
            actions.append(f"♻️ 工单 {tno} 在「待处理」卡了 {stale_min/60:.1f} 小时，已重推擎天柱重新分析")

        elif status == "analyst_complete" and stale_min > 24 * 60:
            if dedup(state, f"quote-remind-{tid}", 24):
                continue
            if t["ClientId"]:
                log(f"工单 {tno} 报价 {stale_min/60:.0f} 小时无回应，如意提醒客户")
                send_as(RUYI_ID, RUYI_NAME, "staff", t["ClientId"],
                        f"您好～关于您的需求「{t['Title']}」，我们之前发您的报价还在等您确认哦。"
                        f"如认可请回复「确认」，有任何疑问也欢迎随时问我 😊")
            actions.append(f"⏰ 工单 {tno} 报价超 24 小时未确认，如意已跟进客户")

        elif status == "confirmed" and stale_min > 24 * 60:
            if dedup(state, f"pay-remind-{tid}", 24):
                continue
            if t["ClientId"]:
                log(f"工单 {tno} 待付款 {stale_min/60:.0f} 小时，如意提醒客户")
                price = t["EstimatedPrice"]
                price_txt = f"（¥{price}）" if price not in (None, "") else ""
                send_as(RUYI_ID, RUYI_NAME, "staff", t["ClientId"],
                        f"您好～您的订单 **{tno}**「{t['Title']}」{price_txt}还在等待付款，"
                        f"付款后回复「已付款」我们就立即开工～如有问题随时找我 😊")
            actions.append(f"💳 工单 {tno} 确认后超 24 小时未付款，如意已提醒客户")
            escalations.append(f"工单 {tno} 待付款超 24 小时，若客户已线下付款，请对招财说「收到 {tno} 的款」")

        elif status == "in_progress" and stale_min > 120:
            if dedup(state, f"wzt-restart-{tid}", 6):
                continue
            # 【取消自愈，改上报】。触发条件是 in_progress > 120 分钟，
            # 那是「活着但流程不前进」，不是「服务挂了」——重启对前者基本无效，
            # 只会清掉现场让根因不可复现，还把结果染成「重启后好像好了」。
            # 而且它和 patrol 新加的退避规则直接冲突：同一工单反复触发
            # = 反复「成功」= 按判据该升 P1，而不是再重启一次（灵犀 2026-09-07）。
            log(f"工单 {tno} in_progress 卡了 {stale_min/60:.1f} 小时")
            escalations.append(
                f"工单 {tno} 开发超 {stale_min/60:.1f} 小时未交付，威震天疑似卡死。"
                "判断交给人：重启会清掉现场，根因就查不到了")

        elif status == "testing" and stale_min > 48 * 60:
            if dedup(state, f"testing-{tid}", 24):
                continue
            escalations.append(f"工单 {tno}「{t['Title']}」在测试验收阶段已停留 {stale_min/1440:.1f} 天，请安排验收")

        elif status == "failed":
            if dedup(state, f"failed-{tid}", 24):
                continue
            escalations.append(f"工单 {tno}「{t['Title']}」执行失败（failed），需要您人工处理")


def check_pending_timeout(state, actions, escalations):
    """读各 bot 的 .{bot}-pending.json：认领后超阈值（派单10min/消息5min）仍未完成
    = 「读了不办 / 活着但卡死」。给原发送者回执 + 升级到灵犀清单（项一/项四核心）。
    心跳正常但逻辑没推进的情况，靠这里兜（心跳巡检漏掉的盲区）。"""
    now = time.time()
    for bot, (uid, name, role) in PENDING_BOTS.items():
        path = f"/opt/gooday-harness/workflows/coo-patrol/.{bot}-pending.json"
        try:
            with open(path) as f:
                data = json.load(f)
        except Exception:
            continue
        for key, rec in (data or {}).items():
            if not isinstance(rec, dict):
                continue
            kind = rec.get("kind", "message")
            thr = PENDING_THRESHOLD_MIN.get(kind, 5)
            age = (now - rec.get("claimed_at", now)) / 60
            if age <= thr:
                continue
            if dedup(state, f"pending-{bot}-{key}", 1):
                continue
            tid = rec.get("ticket_id")
            sid = rec.get("sender_id")
            unit = f"工单 {tid}" if tid else (f"消息 {rec.get('msg_id')}" if rec.get("msg_id") else key)
            log(f"{name} 认领 {unit} 后 {age:.0f} 分钟未完成（pending 超时，阈值 {thr}min）")
            if sid and sid != uid:
                send_as(uid, name, role, sid,
                        f"⚠️ 你的请求已收到但处理超时（约 {age:.0f} 分钟），我正在排查，"
                        f"稍后给你回复（{unit}）。")
            escalations.append(
                f"⏱️ {name} 认领 {unit} 后 {age:.0f} 分钟仍未完成（疑似读了不办/卡死，"
                f"心跳正常但逻辑未推进），已回执发送者并排查")


def check_dirty_state(state, actions, escalations):
    """脏状态探测（项四）：心跳正常、bot 没挂，但流程数据脏。
    ① delivering 却查无收款（income/received）→ 疑似未收款就交付（#27 同型）；
    ② in_progress 超 15min 但威震天 pending 无该单 → 疑似漏接未认领。"""
    with get_db() as conn:
        for t in conn.execute(
                "SELECT Id, TicketNo, Title FROM Tickets WHERE Status='delivering'").fetchall():
            # 退回-3：收款判定须与后端闸门(3a2fd00)口径一致——加 Amount>0，否则 ¥0 received
            # 假账会让闸门视为「未收款」、COO 视为「已收款」而漏报。Amount 是 TEXT 列，
            # 用 CAST AS REAL 比较，避开 TEXT 字典序比较坑（"0.0">"0" 之类）。
            paid = conn.execute(
                "SELECT COUNT(*) FROM FinanceRecords WHERE TicketId=? AND Type='income' "
                "AND PaymentStatus='received' AND CAST(Amount AS REAL) > 0", (t["Id"],)).fetchone()[0]
            if not paid and not dedup(state, f"dirty-deliver-{t['Id']}", 6):
                escalations.append(
                    f"🚩 脏状态：工单 {t['TicketNo']}「{t['Title']}」处于 delivering 但查无收款记录，"
                    f"疑似未收款就交付，请核查（后端闸门应已拦，出现即说明有绕过路径）")
        inprog = conn.execute(
            "SELECT Id, TicketNo, Title, UpdatedAt FROM Tickets WHERE Status='in_progress'").fetchall()
    claimed = set()
    try:
        with open("/opt/gooday-harness/workflows/coo-patrol/.weizhentian-pending.json") as f:
            for rec in (json.load(f) or {}).values():
                if isinstance(rec, dict) and rec.get("ticket_id"):
                    claimed.add(rec["ticket_id"])
    except Exception:
        pass
    for t in inprog:
        if t["Id"] in claimed or age_minutes(t["UpdatedAt"]) <= 15:
            continue
        if dedup(state, f"dirty-inprog-{t['Id']}", 6):
            continue
        escalations.append(
            f"🚩 脏状态：工单 {t['TicketNo']}「{t['Title']}」in_progress 超 15 分钟但威震天未认领"
            f"（pending 无此单），疑似漏接，请核查")


def check_consistency(state, actions, escalations):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT p.Id AS Pid, p.Status AS Pstatus, t.TicketNo "
            "FROM Projects p JOIN Tickets t ON t.Id = p.TicketId "
            "WHERE t.Status='done' AND p.Status != 'done'"
        ).fetchall()
    for r in rows:
        log(f"项目 {r['Pid']}（{r['TicketNo']}）状态 {r['Pstatus']} 与工单 done 不一致，自动同步")
        result = api_call("PUT", f"/api/projects/{r['Pid']}", {"status": "done"})
        if "error" not in result:
            actions.append(f"🔄 项目 {r['TicketNo']} 状态已同步为完成（原 {r['Pstatus']}）")


def check_inbox_backlog(state, actions, escalations):
    with get_db() as conn:
        for uid, svc in INBOX_BOTS.items():
            row = conn.execute(
                "SELECT MIN(CreatedAt) AS oldest, COUNT(*) AS n FROM PrivateMessages "
                "WHERE ReceiverId=? AND IsRead=0", (uid,)
            ).fetchone()
            if row["n"] and age_minutes(row["oldest"]) > 30:
                if dedup(state, f"backlog-{uid}", 1):
                    continue
                log(f"{svc} 收件箱积压 {row['n']} 条（最老 {age_minutes(row['oldest']):.0f} 分钟）")
                escalations.append(
                    f"{svc} 收件箱积压 {row['n']} 条未读超 30 分钟。"
                    "（自愈已移交 workflows/patrol 的 bot_inbox 检查项，"
                    "在那边受动作分级与退避约束）")


# 心跳阈值（分钟）按各 bot 单次最长 Claude 工作时间设定：
# 灵犀480s、如意120s、擎天柱单工单约6-8分钟、威震天最坏3轮约27分钟、招财60s
HEARTBEAT_RULES = {
    "gooday-harness-bot-lingxi":      ("lingxi", 12),
    "gooday-harness-bot-ruyi":        ("ruyi", 10),
    "gooday-harness-bot-qingtianzu":  ("qingtianzu", 20),
    "gooday-harness-bot-weizhentian": ("weizhentian", 35),
    "gooday-harness-bot-zhaocai":     ("zhaocai", 10),
}

def check_heartbeats(state, actions, escalations):
    """bot 心跳超阈值没更新 = 进程活着但卡死（systemd 管不到）→ 重启"""
    for svc, (name, threshold) in HEARTBEAT_RULES.items():
        hb_path = f"/opt/gooday-harness/workflows/coo-patrol/.{name}-heartbeat"
        if not os.path.exists(hb_path):
            continue  # 未部署心跳的版本，跳过
        try:
            with open(hb_path) as f:
                hb = int(f.read().strip())
        except Exception:
            continue
        stale_min = (time.time() - hb) / 60
        if stale_min > threshold:
            if dedup(state, f"heartbeat-{name}", 0.5):
                continue
            log(f"{name} 心跳停了 {stale_min:.0f} 分钟（阈值{threshold}），判定卡死")
            escalations.append(f"{name} 心跳停了 {stale_min:.0f} 分钟（重启由 workflows/patrol 负责）")


BACKUP_ROOT = "/opt/gooday-harness/backups"

def check_db_snapshot(state, actions, escalations):
    """数据库快照体系失效 = 单点风险回归，升级 P0：
    1) 快照脚本留下失败标记（备份做出来但校验不过）
    2) hourly 目录超过 2 个周期没有新快照（cron 静默失败/没装）"""
    marker = os.path.join(BACKUP_ROOT, ".snapshot-failure")
    if os.path.exists(marker):
        if not dedup(state, "snapshot-failure", 2):
            try:
                with open(marker) as f:
                    last = f.read().strip().splitlines()[-1]
            except Exception:
                last = "（标记内容读取失败）"
            escalations.append(
                f"🚨 P0：数据库快照校验失败（{last}）。备份链已断，主库一旦损坏将无新快照可恢复，"
                f"请立即查 /var/log/gooday-db-snapshot.log")
        return
    hourly = os.path.join(BACKUP_ROOT, "hourly")
    snaps = [os.path.join(hourly, f) for f in os.listdir(hourly)
             if f.startswith("gooday-") and f.endswith(".db")] if os.path.isdir(hourly) else []
    if not snaps:
        if not dedup(state, "snapshot-missing", 2):
            escalations.append("🚨 P0：数据库小时快照一份都没有，备份体系未生效，请检查 crontab 与脚本")
        return
    stale_min = (time.time() - max(os.path.getmtime(p) for p in snaps)) / 60
    if stale_min > 130:
        if not dedup(state, "snapshot-stale", 2):
            escalations.append(
                f"🚨 P0：数据库快照已 {stale_min:.0f} 分钟没有更新（cron 可能静默失败），"
                f"请检查 crontab 与 /var/log/gooday-db-snapshot.log")


def check_db_health(state, actions, escalations):
    """运行库健康专项探测（V3.1 P3：原"DB 异常 P0 检测点偏弱"）。
    check_db_snapshot 只防"没快照可恢复"；这条补"主库自己正在坏/锁死"——
    quick_check 完整性 + 锁/损坏识别，异常一律 P0（资金/事件流转的根基）。
    探测本身只读、短超时，不写不阻塞业务。"""
    try:
        conn = sqlite3.connect(DB_PATH, timeout=5)
        try:
            row = conn.execute("PRAGMA quick_check(1)").fetchone()
            res = (row[0] if row else "").strip().lower()
        finally:
            conn.close()
    except sqlite3.OperationalError as e:    # 锁/打开失败（OperationalError 是 DatabaseError 子类，须先捕）
        msg = str(e).lower()
        if "locked" in msg or "busy" in msg:
            if not dedup(state, "db-locked", 1):
                escalations.append(f"🚨 P0：运行库长期锁死（{e}）。事件流转/记账可能阻塞，请查持锁进程（lsof + 长事务）")
        else:
            if not dedup(state, "db-open-error", 1):
                escalations.append(f"🚨 P0：运行库打开/查询异常（{e}）。请立即排查（恢复手册 doc11）")
        return
    except sqlite3.DatabaseError as e:        # malformed / file is not a database = 损坏
        if not dedup(state, "db-corrupt", 1):
            escalations.append(f"🚨 P0：运行库疑似损坏（{e}）。立即停写、从最近快照恢复（doc11），**勿覆盖现库**以便取证")
        return
    if res != "ok":
        if not dedup(state, "db-integrity", 1):
            escalations.append(f"🚨 P0：运行库完整性检查未通过（quick_check={res}）。立即从最近快照恢复（doc11）")


# ---- TLS 证书到期监控（2026-06-18 xray 证书静默过期事故的监控网）----
# 背景：xray 入站口 /etc/xray/cert.pem 跟 nginx 的自动续期没对齐，月中过期没人发现，
# 节点直接连不上才被察觉。加这条主动探各端口证书到期日，过期前 7 天就告警，杜绝"过期才发现"。
CERT_MONITOR = {       # 展示名 -> 本机端口
    "主站 nginx(443)":  443,
    "xray 入站 555":    555,
    "xray 入站 2096":   2096,
    "xray 入站 314":    314,
}
CERT_SNI       = "www.gooday.ltd"
CERT_WARN_DAYS = 7

def _cert_notafter(port):
    """探 127.0.0.1:port 的 TLS 证书 notAfter（UTC datetime）；非 TLS/握手失败返回 None（不误报）。"""
    try:
        r = subprocess.run(
            ["bash", "-c",
             f"echo | openssl s_client -connect 127.0.0.1:{port} -servername {CERT_SNI} 2>/dev/null "
             f"| openssl x509 -noout -enddate"],
            capture_output=True, text=True, timeout=15)
        out = r.stdout.strip()
        if not out.startswith("notAfter="):
            return None
        return datetime.strptime(out.split("=", 1)[1].strip(), "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    except Exception:
        return None

def check_cert_expiry(state, actions, escalations):
    """各 TLS 端口证书到期监控：已过期 → P0；< CERT_WARN_DAYS 天 → P1。
    即便自动续期再次静默失效，也提前告警，不再靠用户报"连不上"才发现。"""
    now = datetime.now(timezone.utc)
    for name, port in CERT_MONITOR.items():
        na = _cert_notafter(port)
        if na is None:
            continue   # 端口不在/非 TLS，跳过
        days = (na - now).total_seconds() / 86400
        if days < 0:
            if not dedup(state, f"cert-expired-{port}", 12):
                escalations.append(
                    f"🚨 P0：{name} TLS 证书已过期 {-days:.1f} 天（{na:%Y-%m-%d %H:%M} UTC）。"
                    f"客户端无法握手，请立即续期并部署到该服务。")
        elif days < CERT_WARN_DAYS:
            if not dedup(state, f"cert-soon-{port}", 24):
                escalations.append(
                    f"⚠️ P1：{name} TLS 证书将在 {days:.1f} 天后到期（{na:%Y-%m-%d}），"
                    f"请确认自动续期已挂到该服务（防月中静默过期）。")


DISPATCHER_HB = "/opt/gooday-harness/workflows/coo-patrol/.dispatcher-heartbeat"

def check_dispatcher(state, actions, escalations):
    """监控 V3 调度器死活（docs/v3/05）：心跳超 10 分钟 → L1 重启；
    自愈无效（重启后下轮仍无心跳）→ P0。未部署（无心跳文件）则跳过，不误报。"""
    if not os.path.exists(DISPATCHER_HB):
        return  # 尚未部署 gooday-dispatcher，跳过
    try:
        # 心跳格式 ts|mode（V3.1 P1②）；旧格式仅 ts，mode=None 时跳过模式探针不误报
        raw = open(DISPATCHER_HB).read().strip()
        parts = raw.split("|")
        hb = int(parts[0])
        mode = parts[1] if len(parts) > 1 else None
    except Exception:
        return
    stale_min = (time.time() - hb) / 60
    if stale_min > 10:
        log(f"调度器心跳停了 {stale_min:.0f} 分钟")
        escalations.append(
            f"灵犀调度器心跳停了 {stale_min:.0f} 分钟。"
            "（重启由 workflows/patrol 负责——它用同样的阈值看同一个 unit，"
            "两边都动手就是两个看门狗抢着重启同一个服务）")
        # 连续两轮（>15min）仍无心跳 = 重启无效，升 P0
        if stale_min > 15 and not dedup(state, "dispatcher-dead", 1):
            escalations.append("🚨 P0：灵犀调度器重启后仍无心跳，事件流转可能停滞，请尽快查 journalctl -u gooday-dispatcher")
        return
    # 心跳新鲜=进程活着。V3.1 P1② shadow 探针：进程活着但运行态≠产线(on) → 状态机不接管、
    # 工单静默不流转（TOP1 风险）。off=大海主动回滚 V2 不告警；shadow/未知 → P1（~30min 限频）。
    if mode is not None and mode not in ("on", "off") and not dedup(state, "dispatcher-shadow", 0.5):
        escalations.append(
            f"⚠️ P1：灵犀调度器在「{mode}」模式空转——状态机不接管、工单不流转。"
            f"请确认 /opt/gooday-harness/.env 的 V3_DISPATCH=on 后重启 gooday-dispatcher。")


SLOTS_DB = "/var/lib/gooday-harness/state/coo-patrol/claude-slots.db"

def check_claude_queue(state, actions, escalations):
    """Claude 并发队列积压监控（V3，见 docs/v3/13）：
    等待 >10 分钟 → P2 记日报；等待 >30 分钟 或 等待数 ≥5 → P1 报大海。"""
    if not os.path.exists(SLOTS_DB):
        return
    try:
        conn = sqlite3.connect(SLOTS_DB, timeout=5)
        rows = conn.execute("SELECT holder, since FROM waiting").fetchall()
        conn.close()
    except Exception:
        return
    if not rows:
        return
    now = time.time()
    max_wait_min = max((now - s) / 60 for _, s in rows)
    n = len(rows)
    if max_wait_min > 30 or n >= 5:
        if not dedup(state, "claude-queue-p1", 1):
            escalations.append(
                f"⏳ P1：Claude 任务排队积压（{n} 个等待，最长 {max_wait_min:.0f} 分钟）。"
                f"已达扩容信号——建议调大并发数或错峰，命令见 docs/v3/13。")
    elif max_wait_min > 10:
        if not dedup(state, "claude-queue-p2", 2):
            actions.append(f"⏳ Claude 队列轻度积压：{n} 个任务等待，最长 {max_wait_min:.0f} 分钟（已自动排队，无需处理）")


def check_daily_report(state, actions, escalations):
    """09:30 后还没有今日日报 → 自动补发（防 cron 静默失败复发）"""
    now = datetime.now(timezone.utc)
    if (now.hour, now.minute) < (9, 30):
        return
    today = now.strftime("%Y-%m-%d")
    with get_db() as conn:
        n = conn.execute(
            "SELECT COUNT(*) FROM PrivateMessages WHERE SenderId=? AND ReceiverId=? "
            "AND Content LIKE '%灵犀日报%' AND CreatedAt >= ?",
            (LINGXI_ID, DAHAI_ID, today)).fetchone()[0]
    if n:
        return
    if dedup(state, f"daily-report-{today}", 12):
        return
    log("今日日报缺失，自动补发")
    if not DRY_RUN:
        env = os.environ.copy()
        env["JWT_SECRET"] = read_jwt_secret()
        subprocess.run(["python3", "/opt/gooday-harness/workflows/coo-patrol/lingxi-daily-report.py"],
                       env=env, capture_output=True, timeout=180)
    actions.append("📊 发现今日 09:00 日报未发出，已自动补发")


# ---- 主流程 ----


# 抽成常量便于自测——未经测试的告警等于没有告警（这次事故的核心教训）
# 2026-09-07 起只监控 agent 这一份——bot 已统一共用它。
# root 那份即使还留在盘上也不再被任何进程使用，继续监控只会产生"过期"噪音，
# 而噪音会让人关掉告警，从此真故障也看不见。
CRED_PATHS = (("agent", "/home/agent/.claude/.credentials.json"),)

# 谁的凭据是「必须存在」的。
# 2026-09-07 起 5 个 bot 经 systemd drop-in 设 HOME=/home/agent，改共用 agent 那一份，
# root 侧不再需要单独维护一份（见 scripts/systemd-dropins/claudecred.conf）。
CRED_REQUIRED = {"agent"}

# 共用方案的唯一真风险：bot 以 root 跑，若 Claude CLI 刷新时重写凭据文件，
# 新文件会变成 root:root 600，把 agent 自己锁在外面——而听书/时光机/奇妙数学
# 三条产线都以 agent 身份依赖它，断了是静默停摆。patrol 以 root 跑，有能力改回来，
# 所以这里做 L1 自愈：发现属主不对就 chown 回 agent，只记录不打扰（四级阶梯 L1）。
CRED_SHARED_PATH = "/home/agent/.claude/.credentials.json"
CRED_SHARED_OWNER = "agent"


def heal_shared_cred_owner(actions):
    """凭据文件属主漂移自愈。返回 True 表示做了修复。"""
    import pwd
    try:
        want = pwd.getpwnam(CRED_SHARED_OWNER)
        st = os.stat(CRED_SHARED_PATH)
    except (FileNotFoundError, KeyError):
        return False
    if st.st_uid == want.pw_uid:
        return False
    try:
        os.chown(CRED_SHARED_PATH, want.pw_uid, want.pw_gid)
        os.chmod(CRED_SHARED_PATH, 0o600)
    except PermissionError:
        return False        # 非 root 跑（如手工 --dry-run），修不了也不该报错
    actions.append(f"🔧 Claude 凭据属主漂移（uid={st.st_uid}），已 chown 回 {CRED_SHARED_OWNER}")
    return True


def check_claude_credential(state, actions, escalations):
    """Claude 凭据可用性探测（2026-08-14 加）。

    痛点：心跳只证明 bot 进程活着，证明不了它调得动 Claude。
    2026-08-09 起 root 侧凭据失效，6 个 bot 全都"活着"却连续 5 天一句话都答不出，
    心跳、systemd 状态、服务列表全绿，无人发现。

    判据：凭据文件里的 expiresAt 一旦落在过去超过 2 小时，说明很久没有一次成功刷新
    （正常使用下每次调用都会把它续到 8 小时后）。零成本，只读文件，不发起任何调用。
    """
    import json as _json
    heal_shared_cred_owner(actions)      # 先自愈属主，再读——否则读不出会误报成「链路已断」
    for who, path in CRED_PATHS:
        try:
            with open(path) as f:
                d = _json.load(f)
            exp = float(d["claudeAiOauth"]["expiresAt"]) / 1000.0
        except FileNotFoundError:
            # 2026-09-07 补盲区：原来这里一律 continue，"文件根本不存在" 和
            # "这台机器上没有这份" 被当成同一件事静默跳过——而 6 个 bot 全以 root 跑，
            # root 的凭据缺失恰恰是最严重的故障。实测 root 侧从 8 月中起就没有这个文件，
            # patrol 却连续三周报「一切正常」，正是它专门要抓的那个场景。
            if who in CRED_REQUIRED and not dedup(state, f"cred-missing-{who}", 6):
                escalations.append(
                    f"🔑 {who} 的 Claude 凭据文件不存在（{path}），"
                    f"以 {who} 身份跑的 Claude 调用【全部】在静默失败。"
                    f"处理：以 root 执行 `sudo -H claude` 登录，再重启 gooday-* 服务。")
            continue
        except Exception as e:
            if not dedup(state, f"cred-unreadable-{who}", 6):
                escalations.append(f"⚠️ {who} 的 Claude 凭据读不出（{type(e).__name__}），"
                                   f"同步/续期链路可能已断：{path}")
            continue
        overdue_h = (time.time() - exp) / 3600.0
        if overdue_h > 2 and not dedup(state, f"cred-stale-{who}", 6):
            escalations.append(
                f"🔑 {who} 的 Claude 凭据已过期 {overdue_h:.1f} 小时且未见刷新——"
                f"以 {who} 身份跑的 Claude 调用多半全在静默失败。"
                f"处理：以 root 执行 `sudo -H claude` 重新 /login，再重启 gooday-* 服务。")


def main():
    state = load_state()
    actions, escalations = [], _Escalations()
    # 逐项跑，跑之前告诉 escalations 现在是哪一项 ——
    # 这样包装对象落 finding 时才知道 check 名字（27 个调用点无需改）
    CHECKS = [
        ("stuck_tickets", check_stuck_tickets),
        ("consistency", check_consistency),
        ("inbox_backlog", check_inbox_backlog),
        ("pending_timeout", check_pending_timeout),
        ("dirty_state", check_dirty_state),
        ("claude_queue", check_claude_queue),
        ("dispatcher", check_dispatcher),
        ("daily_report", check_daily_report),
    ]
    for _name, _fn in CHECKS:
        escalations.current = _name
        if _name == "stuck_tickets" and dispatch_is_on():
            # V3：调度器 on 时工单卡单自愈由 dispatcher 接管，不重复处理
            continue
        _fn(state, actions, escalations)
    escalations.current = "coo"

    save_state(state)

    # ── 结构化 finding 落进证据流 ──────────────────────────────
    # 与文字那一路并行，不替代它。分类走 ops/dispositions.json，
    # 聚合走同一个 Aggregator —— **和 patrol 用同一套规则**，
    # 否则两边各算各的，退避与降噪等于白做。
    if _Task and _fnd and escalations.findings:
        try:
            rules, default, err = _fnd.load_table()
            agg = _fnd.Aggregator("coo-patrol", window_min=60)
            with _Task("coo-patrol-findings", actor="coo-patrol") as _t:
                if err:
                    _t.event("disposition_table_unreadable", "P1", {"error": err})
                unknown = set()
                fresh_n = 0
                for f in escalations.findings:
                    kind = f"finding:{f['check']}"
                    disp, known = _fnd.classify(kind, rules, default)
                    if not known:
                        unknown.add(kind)
                    fresh, _n = agg.see(f)
                    if fresh:
                        fresh_n += 1
                        _t.event(kind, f["level"],
                                 {"what": f["what"], "why": f["why"],
                                  "fix": f["fix"], "disposition": disp})
                if unknown:
                    _t.event("disposition_unknown_kind", "P2",
                             {"kinds": sorted(unknown),
                              "why": "不在 ops/dispositions.json 里，已按默认处理"})
                sup = agg.suppressed()
                if sup:
                    _t.event("findings_aggregated", "P3",
                             {"fingerprints": len(sup),
                              "total_suppressed": sum(v["count"] - 1 for v in sup.values())})
                agg.flush()
                _t.event("coo_patrol_summary", "P3",
                         {"escalations": len(escalations), "new_findings": fresh_n})
        except Exception as _e:
            # 证据流出问题不能让巡检本身失败，但必须喊出来
            print(f"[coo-patrol] ⚠️ 结构化 finding 落盘失败: {_e}",
                  file=sys.stderr, flush=True)

    if not actions and not escalations:
        log("一切正常")
        return

    lines = ["🛡️ **COO 巡检报告**（灵犀）"]
    if actions:
        lines.append("\n**已自动处理：**")
        lines += [f"- {a}" for a in actions]
    if escalations:
        lines.append("\n**需要您处理：**")
        lines += [f"- {e}" for e in escalations]
    digest = "\n".join(lines)

    log(f"巡检摘要：{len(actions)} 项已处理，{len(escalations)} 项需人工")
    if DRY_RUN:
        print("---- DRY RUN 摘要 ----\n" + digest)
    else:
        send_as(LINGXI_ID, LINGXI_NAME, "admin", DAHAI_ID, digest)


if __name__ == "__main__":
    main()
