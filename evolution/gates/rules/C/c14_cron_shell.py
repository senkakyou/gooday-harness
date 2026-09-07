# -*- coding: utf-8 -*-
"""C14 cron 必须 SHELL=/bin/bash，且 source .env 要用 set -a 包住。

cron 默认 SHELL=/bin/sh（dash），没有 source 命令，
整行会【静默失败且连日志文件都不生成】——你看不到任何错误，
只会在几天后发现「日报怎么一直没来」。

而 .env 里没有 export 时，光 source 也不会把变量传给 python 子进程，
所以必须 set -a 包起来。

配套纪律（人工）：新增 cron 后必须等一个执行周期，
确认日志文件真的出现——crontab -l 显示正常不算数。

来源：ai-company-kit。接入决策见 docs/specs/005-policy-layers.md。
"""
import re

RULE = "C14"
TITLE = "cron 环境"


def check(ctx):
    crons = list(ctx.walk(".cron", under="workflows"))
    if not crons:
        yield ("SKIP", "workflows/ 下暂无 cron 片段", "")
        return

    # 汇总后的 crontab 由 install.sh 生成，头部必须有 SHELL
    install = ctx.read("ops/install.sh")
    if install and "SHELL=/bin/bash" not in install:
        yield ("ERROR", "ops/install.sh 汇总 crontab 时没写 SHELL=/bin/bash",
               "cron 默认 dash 没有 source，整行会静默失败且不生成日志")

    for c in crons:
        body, rel = ctx.read(c), ctx.rel(c)
        for i, line in enumerate(body.splitlines(), 1):
            if line.lstrip().startswith("#") or not line.strip():
                continue
            if "source" in line and not re.search(r"set\s+-a", line):
                yield ("ERROR", f"{rel}:{i} source 了 env 但没有 set -a",
                       ".env 里没 export 时，变量传不给子进程")
