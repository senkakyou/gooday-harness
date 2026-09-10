#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""如意的开单闸门 —— 确定性代码，不是给如意的工具。

═══ 为什么这么设计 ═══════════════════════════════════════════════════

  如意面对的是任何注册用户，**她读到的每一句话都是不可信输入**。
  给她一个「建单工具」等于把注入直接变成写库。

  所以：她只负责【说】——在回复末尾吐一段 ```order 结构化块；
  真正落库的是本文件，走 botkit runner 已有的 on_reply 钩子。
  本文件不调模型、不解释语义，只做白名单校验和幂等。

  爆炸半径写清楚：客户确实可以诱导如意吐一个假的 order 块。
  结果 = 库里多一行 NEW 订单 + 大海多收一条通知。
  **没有任何东西会因此开工**——开工是大海的动作。可接受。

═══════════════════════════════════════════════════════════════════
"""
import json
import os
import re
import sqlite3
import ssl
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages", "botkit"))

import auth                                                # noqa: E402

# ── 门槛 ────────────────────────────────────────────────────────────

FIELDS = ("title", "client", "contact", "need")      # 白名单，多余字段一律丢弃
MIN_NEED = 30                                        # 需求描述下限（字）
MAX_FIELD = 4000

# 交付形式白名单。不在里面的一律不开单——线下服务、硬件、
# 要接第三方账号的，我们做不了，开了单只是让大海白跑一趟。
DOABLE = ("网页", "命令行", "脚本", "小程序", "html", "cli", "web")

# 违规词。命中就不开单，也不解释太多。
FORBIDDEN = ("爬取", "爬虫", "破解", "代刷", "刷单", "外挂", "撞库",
             "绕过登录", "盗号", "秒杀脚本")

PER_CLIENT_24H = 2       # 同一客户一天最多两单
GLOBAL_24H = 10          # 全站一天最多十单

BLOCK_RE = re.compile(r"```order\s*(.*?)```", re.S | re.I)

_ssl = ssl.create_default_context()
_ssl.check_hostname = False
_ssl.verify_mode = ssl.CERT_NONE


class Rejected(Exception):
    """不开单。带一句给日志看的原因——【不回给客户】，
    免得把门槛的具体判据暴露成可以被绕过的说明书。"""


def parse_block(text):
    """从回复里抠出 order 块。没有就返回 None（绝大多数轮次都是 None）。"""
    m = BLOCK_RE.search(text or "")
    if not m:
        return None
    out = {}
    for line in m.group(1).splitlines():
        if ":" not in line and "：" not in line:
            continue
        k, _, v = line.partition(":") if ":" in line else line.partition("：")
        k = k.strip().lower()
        if k in FIELDS:                       # 【白名单】：没登记的键直接丢
            out[k] = v.strip()[:MAX_FIELD]
    return out or None


def validate(d):
    """硬门槛。任何一条不过就不开单。"""
    for k in FIELDS:
        if not d.get(k):
            raise Rejected(f"缺字段 {k}")

    need = d["need"]
    if len(need) < MIN_NEED:
        raise Rejected(f"需求只有 {len(need)} 字，不够 {MIN_NEED}")

    blob = f"{d['title']} {need}"
    if not any(w in blob.lower() for w in DOABLE):
        raise Rejected("交付形式不在白名单里（网页/命令行/脚本/小程序）")

    hit = [w for w in FORBIDDEN if w in blob]
    if hit:
        raise Rejected(f"命中违规词 {hit}")

    # 【钱不该出现在这里】。如意的 prompt 写了不谈钱，但那是提示词，
    # 提示词是软的——这里做一次硬校验，模型哪天没守住也落不进库。
    if re.search(r"(预算|报价|多少钱|工期|￥|¥|\d+\s*(元|块|万))", need):
        raise Rejected("需求里出现了价格/工期，如意不该谈钱")
    return d


def _recent(conn, since_ts):
    return conn.execute(
        "SELECT COUNT(*) FROM Tickets WHERE CreatedAt >= ?", (since_ts,)).fetchone()[0]


def check_quota_and_dup(db, d):
    """防灌 + 24 小时幂等。

    【幂等按「客户 + 标题」指纹，不按订单号】：如意每轮都可能把同一段
    order 块再吐一遍（她没有记忆保证），不去重就是一个需求建出五张单。
    """
    day_ago = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(time.time() - 86400))
    conn = sqlite3.connect(db, timeout=10)
    try:
        if _recent(conn, day_ago) >= GLOBAL_24H:
            raise Rejected(f"全站 24 小时内已建 {GLOBAL_24H} 单，转人工")

        n = conn.execute(
            "SELECT COUNT(*) FROM Tickets WHERE CreatedAt >= ? AND ClientContact = ?",
            (day_ago, d["contact"])).fetchone()[0]
        if n >= PER_CLIENT_24H:
            raise Rejected(f"该客户 24 小时内已建 {n} 单")

        dup = conn.execute(
            "SELECT TicketNo FROM Tickets WHERE CreatedAt >= ? "
            "AND ClientContact = ? AND Title = ?",
            (day_ago, d["contact"], d["title"])).fetchone()
        if dup:
            raise Rejected(f"24 小时内已有同名单 {dup[0]}，不重复建")
    finally:
        conn.close()


def create_ticket(cfg, d, sender_id):
    """走 API 建单。【不直接写库】——建单要连带通知大海、写工作记录，
    那些逻辑在服务端，绕过 API 就会各写一份。"""
    token = auth.provider(cfg["bot_id"], cfg.get("username", "如意"),
                          cfg.get("role", "staff"), cfg["db"])()
    # 【必须带上 clientUserId】。如意是在站内私信里接待的，发信人必然有账号，
    # 服务端拿它换/建客户档案。第一版恒传 clientId=None，后果是这张单
    # **永远走不到放行那一步**——上架端点要把交付物挂到具体用户名下，
    # 没有客户档案它直接拒绝。而这个信息本来就在手上，只是没传。
    body = json.dumps({
        "title": d["title"], "description": d["need"],
        "clientName": d["client"], "clientContact": d["contact"],
        "clientId": None, "clientUserId": sender_id,
    }).encode()
    req = urllib.request.Request(
        cfg.get("api_base", "https://localhost") + "/api/tickets",
        data=body, method="POST",
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=30, context=_ssl) as r:
        return json.load(r)


def on_reply(bot, sender_id, batch, text, task):
    """runner 拿到模型输出后调这里。**绝不能抛异常**——
    开单失败不该让如意这一轮回复也发不出去。"""
    try:
        d = parse_block(text)
        if not d:
            return
        validate(d)
        check_quota_and_dup(bot.cfg["db"], d)
        r = create_ticket(bot.cfg, d, sender_id)
        bot.log(f"✅ 开单 {r.get('ticketNo')}（客户 {d['client']} / {d['contact']}）")
        if task:
            task.event("ticket_created", "P2",
                       {"ticketNo": r.get("ticketNo"), "contact": d["contact"]})
    except Rejected as e:
        # 【不开单是正常结果，不是错误】。日志说清为什么，但不回给客户——
        # 把门槛的判据告诉不可信输入方，等于给他一份绕过说明书。
        bot.log(f"未开单：{e}")
        if task:
            task.event("intake_rejected", "P3", {"why": str(e)})
    except Exception as e:
        bot.log(f"⚠️ 开单出错（不影响本轮回复）：{type(e).__name__}: {e}")
        if task:
            task.event("intake_error", "P1", {"error": f"{type(e).__name__}: {e}"})
