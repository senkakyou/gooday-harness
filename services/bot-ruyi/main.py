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

NAME = "bot-ruyi"


class FrontDeskBot(Bot):
    """对外窗口：服务所有人，但输出受最严限制。"""

    def _handle_batch(self, msgs, sysp):
        # serves 为空表示服务所有人。父类用 serves 白名单过滤，
        # 这里把每个发送者都放进去。
        senders = {m["SenderId"] for m in msgs}
        self.cfg["serves"] = list(senders)
        super()._handle_batch(msgs, sysp)


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
