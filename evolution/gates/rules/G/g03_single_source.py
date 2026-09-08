# -*- coding: utf-8 -*-
"""G03 单一真源：同一份配置只能有一处，且那一处必须是它的归属方。

⚠️ 本规则曾与 G06 打架，2026-09-07 修正后的口径：

    「单一真源」不等于「集中存放」。

    集中存放（所有 .service 塞进 ops/systemd/）反而制造问题：
    新增服务必须改公共目录，而改公共目录就会漏——那是 G06 要防的事故。

    正确的单一真源是【配置跟着它的归属方走，且只有那一份】：
      services/<名>/deploy/     该服务的 unit 与 drop-in
      workflows/<名>/deploy/    该产线的 cron 片段
      ops/nginx/                不属于任何单个服务的全局配置

上一版真实教训：scripts/ 里同时躺着 crontab.bak、crontab.bak.20260811、
crontab.bak.20260814 三份，没人说得清哪份是真的。
"""
import os
import re
from collections import defaultdict

RULE = "G03"
TITLE = "单一真源"

# 配置类型 -> 允许出现的位置（正则），任一命中即合法
HOMES = {
    ".service": [r"^services/[^/]+/deploy/"],
    # ops/dropins/ 是刻意的例外：当一份配置对【所有服务】内容完全相同时，
    # 随服务走就是 N 份真副本，改一次要改 N 处——那正是本规则要防的。
    # 归属方是「所有需要它的服务」这个集合时，它就该放在集合的位置上。
    # 判据仍然成立：那一份仍然只有一处。
    ".conf":    [r"^services/[^/]+/deploy/", r"^ops/nginx/", r"^ops/dropins/"],
    ".cron":    [r"^workflows/[^/]+/deploy/"],
}

# 汇总产物：由 install.sh 生成，不该有人手工维护一份进版本库
GENERATED = re.compile(r"^ops/cron/|^ops/systemd/")


def check(ctx):
    go, level, why = ctx.git_verdict()
    if not go:
        # 四态裁决：no_repo→SKIP（本来就没版本库），
        # no_git/failed→ERROR（检查本该跑却没跑成，绝不能当成没问题）
        yield (level, why, "")
        return
    tracked = ctx.tracked()
    if not tracked:
        yield ("WARN", "git 可用但无跟踪文件（新仓库？）", "确认这是预期状态")
        return

    # 1) 配置是否待在归属方那里
    for f in tracked:
        ext = os.path.splitext(f)[1]
        pats = HOMES.get(ext)
        if pats and not any(re.search(p, f) for p in pats):
            yield ("ERROR", f"{ext} 配置不在归属方目录：{f}",
                   "服务配置放 services/<名>/deploy/，产线放 workflows/<名>/deploy/，"
                   "全局放 ops/nginx/。集中存放会逼着新增成员改公共目录（见 G06）")

    # 2) 汇总产物不得入库——它由 install.sh 生成，入库就会和真源分叉
    for f in tracked:
        if GENERATED.match(f):
            yield ("ERROR", f"汇总产物进了版本库：{f}",
                   "crontab / systemd 单元由 ops/install.sh 从各归属方汇总生成，"
                   "版本库里留一份必然与真源分叉")

    # 3) 同名文件出现在多处 = 疑似副本
    by_name = defaultdict(list)
    for f in tracked:
        # content/ 是【创作源】，不是配置或代码，本条的「单一真源」不适用于它：
        # 六本书各有 ch01.md…ch10.md、各有 VOLUME-DESIGN.md，
        # 那是结构性重名，和 README.md 到处都有是同一回事，不是副本。
        # 【只豁免重名这一项】——.bak 备份、汇总产物那几条对 content/ 照查不误。
        if f.startswith("content/"):
            continue
        base = os.path.basename(f)
        # 退役归档会把执行入口改名加 `.txt`（让发现机制扫不到，见
        # examples/retired-*/README.md）。剥掉这个后缀再判——
        # `run.py.txt` 和 `run.py` 是同一个结构位置，豁免理由完全相同。
        # 不剥的话，每退役第二条产线就凭空多两条 WARN，而它们不是副本。
        if base.endswith(".txt"):
            base = base[:-4]
        # 模板化的文件名本来就该重复，是结构的一部分，不算副本
        if base in ("README.md", "__init__.py", ".gitkeep", "AGENTS.md", "_template.md",
                    "unit.service", "schedule.cron", "main.py", "run.py",
                    "evaluate.py", "config.example.json", "config.json", "prompt.md"):
            continue
        by_name[base].append(f)
    for base, paths in sorted(by_name.items()):
        if len(paths) > 1:
            yield ("WARN", f"同名文件出现在 {len(paths)} 处：{base}",
                   "确认不是副本；是副本就合并成一处 —— " + "；".join(paths[:3]))

    # 4) 手工版本备份
    baks = [f for f in tracked if re.search(r"\.bak(\.\d+)?$", f)]
    if baks:
        yield ("ERROR", f"存在手工 .bak 备份 {len(baks)} 个：{'；'.join(baks[:3])}",
               "删掉。要历史版本就查 git log，别在文件名里做版本管理")
