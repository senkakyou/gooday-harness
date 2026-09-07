#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""擎天柱 · AI 项目经理。分析工单、生成方案、汇报项目状态。

主循环走 packages/botkit/runner.py。本文件只剩擎天柱独有的部分：
**先把工单与项目事实查好再交给模型**。

理由同招财：让模型自己去查库时，沙箱里命令可能不可用，
它会跳过查询靠记忆编造。项目状态编错了同样会误导决策。
"""
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages", "botkit"))

from runner import Bot                                    # noqa: E402

NAME = "bot-qingtianzu"

FACTS = (
    ("待分析工单", "SELECT COUNT(*) FROM Tickets WHERE Status='pending'"),
    ("进行中工单", "SELECT COUNT(*) FROM Tickets WHERE Status='in_progress'"),
    ("已交付待验收", "SELECT COUNT(*) FROM Tickets WHERE Status='delivering'"),
    ("失败工单", "SELECT COUNT(*) FROM Tickets WHERE Status='failed'"),
)


def project_context(cfg):
    """把工单事实查好注入 prompt。查不到要明说，不能留空让模型脑补。"""
    conn = sqlite3.connect(cfg["db"], timeout=10)
    try:
        parts = []
        for label, sql in FACTS:
            try:
                parts.append(f"{label}: {conn.execute(sql).fetchone()[0]}")
            except Exception as e:
                parts.append(f"{label}: 查询失败（{type(e).__name__}）——这个数你不知道，别猜")
        # 最近几单的摘要，让它能具体地谈而不是泛泛而论
        try:
            rows = conn.execute(
                "SELECT TicketNo, Status, substr(Title,1,30) FROM Tickets "
                "ORDER BY Id DESC LIMIT 5").fetchall()
            if rows:
                parts.append("最近工单：" + "；".join(
                    f"{r[0]}[{r[1]}]{r[2]}" for r in rows))
        except Exception:
            pass
        return "【当前项目事实（系统查得，可直接引用）】\n" + "\n".join(parts)
    finally:
        conn.close()


if __name__ == "__main__":
    try:
        Bot(NAME, HERE, context=project_context).run()
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        print(f"[{NAME}] 致命错误: {e}", file=sys.stderr)
        sys.exit(1)
