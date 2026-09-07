#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""灵犀 · COO / 站长秘书。回答站长提问、组织审批、汇报全局。

⚠️ **这是全系统权限最大的角色**：它有 Bash、能操作数据库和服务器。
所以对它来说，注入成功 = 攻击者拿到 shell。

三条只对它成立的额外约束：

1. **工具权限走配置，不写死在代码里**——不同环境该给的权限不同，
   而且改权限应该是一次可 review 的配置变更，不是改代码。
2. **只服务站长**。它是私人秘书，非站长的消息根本不处理。
   这不是礼貌问题，是【谁能驱动一个有 shell 的角色】的问题。
3. **prompt 里不写具体路径**（旧版写了 16 处：数据库绝对路径、.env 位置、
   JWT_SECRET 在哪）。对有 Bash 的角色，那等于把攻击面写进它自己的提示词。
"""
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages", "botkit"))

from runner import Bot                                    # noqa: E402
import model as mdl                                       # noqa: E402

NAME = "bot-lingxi"

FACTS = (
    ("待分析工单", "SELECT COUNT(*) FROM Tickets WHERE Status='pending'"),
    ("进行中", "SELECT COUNT(*) FROM Tickets WHERE Status='in_progress'"),
    ("失败单", "SELECT COUNT(*) FROM Tickets WHERE Status='failed'"),
    ("待收款", "SELECT COUNT(*) FROM FinanceRecords "
             "WHERE Type='income' AND PaymentStatus='pending'"),
    ("未处理事件", "SELECT COUNT(*) FROM TicketEvents WHERE Status='new'"),
)


class LingxiBot(Bot):
    """带工具权限的 bot：调模型时要把 allowedTools 传下去。"""

    def _model_args(self):
        tools = self.cfg.get("allowed_tools", [])
        return ["--allowedTools", ",".join(tools)] if tools else []


def coo_context(cfg):
    """全局事实先查好。查不到要明说，不能留空让模型脑补一个数。"""
    conn = sqlite3.connect(cfg["db"], timeout=10)
    try:
        parts = []
        for label, sql in FACTS:
            try:
                parts.append(f"{label}: {conn.execute(sql).fetchone()[0]}")
            except Exception as e:
                parts.append(f"{label}: 查询失败（{type(e).__name__}）——这个数你不知道，别猜")
        return "【当前全局事实（系统查得，可直接引用）】\n" + "\n".join(parts)
    finally:
        conn.close()


if __name__ == "__main__":
    try:
        LingxiBot(NAME, HERE, context=coo_context).run()
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        print(f"[{NAME}] 致命错误: {e}", file=sys.stderr)
        sys.exit(1)
