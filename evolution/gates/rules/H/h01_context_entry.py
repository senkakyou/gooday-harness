# -*- coding: utf-8 -*-
"""H01 上下文入口：仓库根必须有 AGENTS.md，且不超过 150 行。

它是【索引，不是手册】。一旦膨胀成几百行，AI 每次都要整读一遍，
分层就失效了——细节该拆进 policies/ 和 docs/。

来源：harness-kit。接入决策见 docs/specs/005-policy-layers.md。
"""
RULE = "H01"
TITLE = "上下文入口"
LIMIT = 150


def check(ctx):
    for name in ("AGENTS.md", "CLAUDE.md"):
        if not ctx.exists(name):
            continue
        n = len(ctx.read(name).splitlines())
        if n > LIMIT:
            yield ("ERROR", f"{name} 有 {n} 行，超过 {LIMIT} 行的索引上限",
                   "把细节拆到 policies/ 与 docs/，入口只留铁律与索引")
        return
    yield ("ERROR", "仓库根缺 AGENTS.md",
           "它是 AI 作业的入口，也是 30+ 工具原生读取的标准文件")
