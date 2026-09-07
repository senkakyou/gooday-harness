# -*- coding: utf-8 -*-
"""G03 单一真源：同一份配置只能有一处。

上一版 scripts/ 里同时躺着 crontab.bak、crontab.bak.20260811、crontab.bak.20260814，
没人说得清哪份是真的；8 个 .service 文件和代码混在一起，
和 /etc/systemd/system/ 下实际在跑的那份靠人肉保持一致。
"""
import os
import re
from collections import defaultdict

RULE = "G03"
TITLE = "单一真源"

# 配置类型 -> 唯一允许的位置
HOMES = {
    ".service": "ops/systemd/",
    ".conf":    "ops/systemd/",     # drop-in
    ".cron":    "ops/cron/",
}
CRON_PAT = re.compile(r"^crontab", re.I)


def check(ctx):
    tracked = ctx.tracked()
    if not tracked:
        yield ("SKIP", "不是 git 仓库，跳过", "")
        return

    # 1) 配置文件是否待在自己家
    for f in tracked:
        ext = os.path.splitext(f)[1]
        home = HOMES.get(ext)
        if home and not f.startswith(home):
            yield ("ERROR", f"{ext} 配置不在 {home}：{f}",
                   f"移到 {home}，那里是它唯一的真源")
        if CRON_PAT.match(os.path.basename(f)) and not f.startswith("ops/cron/"):
            yield ("ERROR", f"crontab 相关文件不在 ops/cron/：{f}", "移过去")

    # 2) 同名文件出现在多处 = 副本
    by_name = defaultdict(list)
    for f in tracked:
        base = os.path.basename(f)
        if base in ("README.md", "__init__.py", ".gitkeep", "AGENTS.md"):
            continue
        by_name[base].append(f)
    for base, paths in sorted(by_name.items()):
        if len(paths) > 1:
            yield ("WARN", f"同名文件出现在 {len(paths)} 处：{base}",
                   "确认不是副本；是副本就合并成一处，" + "；".join(paths[:3]))

    # 3) 手工版本备份（G01 也会抓，这里给出针对性提示）
    baks = [f for f in tracked if re.search(r"\.bak(\.\d+)?$", f)]
    if baks:
        yield ("ERROR", f"存在手工 .bak 备份 {len(baks)} 个：{'；'.join(baks[:3])}",
               "删掉。要历史版本就查 git log，别在文件名里做版本管理")
