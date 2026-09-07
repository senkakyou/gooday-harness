# -*- coding: utf-8 -*-
"""canary —— 自检探针闭环。

**它证明的是「机器还活着」，不是「业务在进化」。** 这个区分很重要，
写在这里免得日后有人看着 decisions/ 里每天一条 promoted 就以为业务在自我改进。

它每天在**这台机器的真实环境**里把 hello-harness 的解析器闭环跑一轮：
从 3/10 通过开始，走完 Evaluate→Learn→Improve→Experiment→Gate→Promote，
留下 Decision 和 Checkpoint。

为什么需要它 —— CI 里绿不代表服务器上行：
凭据、Python 版本、$GOODAY_HARNESS_STATE 的权限、磁盘满没满，
这些只有在真机上才暴露。**闭环最危险的状态不是不转，是以为它在转。**

每轮都从 BASE_RULES 重新开始（不继承上一轮的成果）——
这是刻意的：要让它每天都真的走一遍 promote，
而不是收敛之后每天报一句 no_change_needed 就完事。
那样探针就只测到了 Evaluate 一环。
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))))
EXAMPLE = os.path.join(REPO, "examples", "hello-harness")

for p in (os.path.join(REPO, "packages", "evolve"), EXAMPLE):
    if p not in sys.path:
        sys.path.insert(0, p)

from loop import Loop                                     # noqa: E402
from task import Parser                                   # noqa: E402
from phases.evaluate import evaluate as _eval             # noqa: E402
from phases.learn import learn                            # noqa: E402
from phases.improve import improve                        # noqa: E402
from phases.gate import make_gate                         # noqa: E402


def build():
    with open(os.path.join(EXAMPLE, "cases.json"), encoding="utf-8") as f:
        cases = json.load(f)["cases"]

    inputs = [c["input"] for c in cases]
    parser = Parser()                      # 每轮全新：从 3/10 开始
    baseline = parser.run(inputs)

    return Loop(
        "canary", parser,
        evaluator=lambda r, i: _eval(r, i, cases),
        learner=learn,
        improver=improve,
        gate=make_gate(_eval, cases, baseline),
        inputs=inputs,
    )
