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

# 【状态是大写的】（2026-09-10 / decisions 006）。旧的小写写法不会报错——
# SQL 照样执行，只是恒为 0，于是日报里「进行中」永远是 0 而没人觉得不对。
# 这正是大写硬切要防的：漏改处立刻沉默地不匹配，而不是悄悄匹配上别的东西。
FACTS = (
    ("待接单", "SELECT COUNT(*) FROM Tickets WHERE Status='NEW'"),
    ("开发中", "SELECT COUNT(*) FROM Tickets WHERE Status='IN_PROGRESS'"),
    ("待验收", "SELECT COUNT(*) FROM Tickets WHERE Status='DELIVERED'"),
    ("卡住了", "SELECT COUNT(*) FROM Tickets WHERE Status='BLOCKED'"),
    ("待收款", "SELECT COUNT(*) FROM FinanceRecords "
             "WHERE Type='income' AND PaymentStatus='pending'"),
)


class LingxiBot(Bot):
    """带工具权限的 bot：调模型时要把 allowedTools 传下去。"""

    def _model_args(self):
        args = []
        tools = self.cfg.get("allowed_tools", [])
        if tools:
            args += ["--allowedTools", ",".join(tools)]
        # 额外可访问目录。默认只有服务的工作目录（仓库根），
        # 而有些任务的对象天然在仓库外（演练副本、日志目录）。
        # **写在 config 里而不是硬编码**：谁能碰哪些目录要看得见、可审计，
        # 加一个目录是改配置，不是改代码。
        for d in self.cfg.get("extra_dirs", []):
            args += ["--add-dir", d]
        return args


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
