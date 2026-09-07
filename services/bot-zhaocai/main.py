#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""招财 · AI 财务。轮询私信，回答站长的财务提问、确认收款。

主循环走 `packages/botkit/runner.py`——心跳、只读模式、按发送者合并、
失败必回执、基础设施错误单独报 P0、留痕，这些每个 bot 都要且都容易写错的，
不再各抄一份。

本文件只剩招财独有的那部分：**先把财务事实查好再交给模型**。

⚠️ 涉及钱。`prompt.md` 里「资金相关判定永不自愈」是硬规矩：
金额对不上就停下来问人，任何"聪明"的自动处理在钱上都是负资产。
"""
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages", "botkit"))

from runner import Bot                                    # noqa: E402

NAME = "bot-zhaocai"

# 金额一律 CAST(x AS REAL)：SQLite 的 TEXT 列直接比较是【字典序】，
# "9" > "10"。旧系统在闸门与巡检口径不一致上真栽过。
FACTS = (
    ("本月收入", "SELECT COALESCE(SUM(CAST(Amount AS REAL)),0) FROM FinanceRecords "
               "WHERE Type='income' AND PaymentStatus='received' "
               "AND CreatedAt >= date('now','start of month')"),
    ("待收款", "SELECT COALESCE(SUM(CAST(Amount AS REAL)),0) FROM FinanceRecords "
             "WHERE Type='income' AND PaymentStatus='pending'"),
    ("待收笔数", "SELECT COUNT(*) FROM FinanceRecords "
              "WHERE Type='income' AND PaymentStatus='pending'"),
)


def finance_context(cfg):
    """把财务事实先查好注入 prompt，而不是让模型自己去查。

    理由（旧系统的教训）：让模型在沙箱里自己跑 sqlite3 时，命令可能不可用，
    它会跳过查询【靠记忆编造】——数字型的幻觉在财务场景最危险。

    查不到也要【明说查询失败】，不能留空让模型自己脑补一个数。
    """
    conn = sqlite3.connect(cfg["db"], timeout=10)
    try:
        parts = []
        for label, sql in FACTS:
            try:
                parts.append(f"{label}: {conn.execute(sql).fetchone()[0]}")
            except Exception as e:
                parts.append(f"{label}: 查询失败（{type(e).__name__}）——"
                             f"这个数你不知道，别猜")
        return "【当前财务事实（系统查得，可直接引用）】\n" + "\n".join(parts)
    finally:
        conn.close()


if __name__ == "__main__":
    try:
        Bot(NAME, HERE, context=finance_context).run()
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        print(f"[{NAME}] 致命错误: {e}", file=sys.stderr)
        sys.exit(1)      # 必须 exit(1)，否则 Restart=always 也不会拉起
