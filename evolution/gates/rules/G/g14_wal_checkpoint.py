# -*- coding: utf-8 -*-
"""G14 cp 数据库前必须 WAL checkpoint。

SQLite 在 WAL 模式下，INSERT 先写 -wal 文件。直接 cp 主文件只复制了一半，
拿到的是一份【看起来正常但缺最近写入】的快照——这种损坏不会报错，
只会在你真的需要恢复的那天才发现。
"""
import re

RULE = "G14"
TITLE = "WAL checkpoint"

# cp/rsync/install 一个 .db 文件
COPY_DB = re.compile(r"\b(cp|rsync|install)\b[^\n|;]*\.db\b")
CHECKPOINT = re.compile(r"wal_checkpoint", re.I)


def check(ctx):
    for f in ctx.walk(".sh", ".py", under=None):
        rel = ctx.rel(f)
        if rel.startswith(("checks/", "policies/", "docs/")):
            continue
        lines = ctx.read(f).splitlines()
        for i, line in enumerate(lines):
            if line.lstrip().startswith("#"):
                continue
            if not COPY_DB.search(line):
                continue
            # 往前找 15 行，有没有先做 checkpoint
            before = "\n".join(lines[max(0, i - 15):i])
            if not CHECKPOINT.search(before):
                yield ("ERROR", f"{rel}:{i+1} 复制 .db 前没有 wal_checkpoint",
                       "先跑 sqlite3 <db> \"PRAGMA wal_checkpoint(FULL);\"，"
                       "否则复制出的快照缺最近写入且不报错")
