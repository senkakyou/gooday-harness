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

NAME = "bot-ruyi"


class FrontDeskBot(Bot):
    """对外窗口：服务所有人，但输出受最严限制。"""

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


def client_context(cfg):
    """查这个客户已有的记录，好让如意一开口就知道对方提过什么。

    只查【该客户自己的】数据——绝不把别人的信息带进上下文。
    """
    return ("【回复纪律】你不做技术判断、不承诺工期报价、不透露内部结构。"
            "拿不准的一律说「我记下来，团队确认后回你」。")


if __name__ == "__main__":
    try:
        FrontDeskBot(NAME, HERE, context=client_context).run()
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        print(f"[{NAME}] 致命错误: {e}", file=sys.stderr)
        sys.exit(1)
