#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""如意 · 前台。唯一对客户可见的角色。

⚠️ 它读到的每一句话都来自不可信来源——其他角色至少只跟站长和彼此说话，
它面对的是任何注册用户。**对它来说注入不是「可能发生」，是日常。**

因此它是唯一一个 `serves` 为空的 bot：不限制发送者。
但反过来，出口白名单和工具权限收得最紧——**它一个工具都没有**。
"""
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages", "botkit"))

from runner import Bot                                    # noqa: E402
import outbound                                          # noqa: E402

sys.path.insert(0, HERE)
import intake                                            # noqa: E402

NAME = "bot-ruyi"


class FrontDeskBot(Bot):
    """对外窗口：服务所有人，但输出受最严限制。"""

    def send(self, to, text):
        """发给客户前把 ```order 块剥掉。

        【客户不该看见内部格式】。那段块是给 intake.py 解析用的，
        出现在聊天里客户要么以为出错了，要么照着改内容。
        剥离放在 send 而不是 on_reply 里：**发送是唯一出口**，
        放这里就不可能有哪条路径漏掉。
        """
        return super().send(to, intake.strip_block(text))

    def _handle_batch(self, msgs, sysp):
        # 【收发两侧都要动态放行】——2026-09-07 事故：只放行了收，没放行发。
        #
        # 原来这里只设 self.cfg["serves"]，而出口白名单是父类 __init__ 里
        # 用 may_send_to（空）configure 过一次就冻住的，于是每条回复都被
        # 自己的白名单拦下：日志刷「⛔ 出口白名单拦截：23 → 1」，
        # 站长发了两句 hello 一条都没收到。
        #
        # 而 config.example.json 的注释一直写着「运行时按发送者动态放行」——
        # **意图写下来了，另一半从没实现**，也没有任何东西会说。
        senders = {m["SenderId"] for m in msgs}
        self.cfg["serves"] = list(senders)

        # 只放行「这一批里真的来找过它的人」。
        # 不是放行所有人：绝不主动给未联系过的人发消息——
        # 那是骚扰，也是注入被利用后最想做的事（见 README）。
        outbound.configure({self.cfg["bot_id"]: set(senders)},
                           api_base=self.cfg.get("api_base"))
        try:
            super()._handle_batch(msgs, sysp)
        finally:
            # 批次结束收回放行，回到默认拒绝。
            # 不收回的话，两批之间若有别的代码路径想发消息，会带着上一批的授权。
            outbound.configure({self.cfg["bot_id"]: set()},
                               api_base=self.cfg.get("api_base"))


def client_context(cfg, sender_id=None):
    """查这个客户已有的记录，好让如意一开口就知道对方提过什么。

    只查【该客户自己的】数据——绝不把别人的信息带进上下文。

    ═══ 这个函数曾经是空的（2026-09-09 修）═══════════════════════

    函数名和上面这段注释都写着"查客户已有的记录"，而函数体里
    **一句查询都没有**，只返回一段固定纪律。更要命的是 prompt.md 里写着
    「系统会在每次对话里附上该客户的需求订单、客户档案、工单进度，
    开口前先看，别把客户已经说过的再问一遍」——
    **提示词承诺了一份资料，代码从来没附过。**

    结果就是何萍那次接待：她把需求说得很清楚，如意隔一轮就重新自我介绍、
    把同样三个问题再问一遍，最后回她"我这会儿手头没看到你之前发的需求内容"。

    教训：名字和注释不是实现。看函数体，不看函数名。
    ═══════════════════════════════════════════════════════════
    """
    base = ("【回复纪律】你不做技术判断、不承诺工期报价、不透露内部结构，"
            "**钱的事一句都不谈**。拿不准的一律说「我记下来，团队确认后回你」。")
    if not sender_id:
        return base

    conn = sqlite3.connect(cfg["db"], timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        who = conn.execute("SELECT Username FROM Users WHERE Id=?", (sender_id,)).fetchone()
        # 【ClientId 指 Clients.Id，不是 Users.Id】（2026-09-10 语义变更）。
        # 直接写 WHERE ClientId=? 传 sender_id 不会报错——两边都是整数——
        # 而是【安静地查出另一个客户的订单】。必须经 Clients 换算。
        tks = conn.execute(
            "SELECT TicketNo, Title, Status, BlockedReason FROM Tickets "
            "WHERE ClientId IN (SELECT Id FROM Clients WHERE UserId=?) "
            "   OR ClientContact = (SELECT Contact FROM Clients WHERE UserId=? LIMIT 1) "
            "ORDER BY Id DESC LIMIT 5", (sender_id, sender_id)).fetchall()
        cli = conn.execute(
            "SELECT Contact, ContactType, PreferredContact FROM Clients "
            "WHERE UserId=? ORDER BY Id DESC LIMIT 1", (sender_id,)).fetchone()
    except Exception as e:
        # 查不到不能阻断接待——但要说明"这次没查到"，
        # 不能让模型以为"这个客户什么记录都没有"
        return base + f"\n【注意】这次没能查到该客户的历史记录（{type(e).__name__}），" \
                      f"别据此断定他没提过需求。"
    finally:
        conn.close()

    lines = [base, f"\n【客户资料 · {who['Username'] if who else sender_id}】"]
    if cli:
        lines.append(f"联系方式：{cli['ContactType']} {cli['Contact']}")
    else:
        lines.append("客户档案：还没建")
    # 【不再查 DevRequests】：那张表 2026-09-10 删了，需求单→工单那层转换没有了，
    # 客户提的需求现在【直接就是订单】。留着查会抛异常，被上面的 except 吞掉，
    # 表现为如意静默失去客户资料——正是 2026-09-09 修过的那个 bug 的形状。
    if tks:
        lines.append("他的订单：")
        for t in tks:
            blocked = f"（卡住了：{t['BlockedReason']}）" if t["BlockedReason"] else ""
            lines.append(f"  · {t['TicketNo']} {t['Title']} → {t['Status']}{blocked}")
    else:
        lines.append("他还没有订单。")
    lines.append("**以上是他已经告诉过我们的，别再问一遍。**")
    return "\n".join(lines)


if __name__ == "__main__":
    try:
        # on_reply=intake.on_reply：她在回复末尾吐一段 ```order 块，
        # 由 intake.py 做白名单校验后落库。【如意本人仍然一个工具都没有】——
        # 那段块是「说」，落库的是确定性代码，注入最多让库里多一行 NEW 订单。
        FrontDeskBot(NAME, HERE, context=client_context,
                     on_reply=intake.on_reply).run()
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        print(f"[{NAME}] 致命错误: {e}", file=sys.stderr)
        sys.exit(1)
