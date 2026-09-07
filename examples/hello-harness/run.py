#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""hello-harness：一次完整的第二层循环。

    python3 run.py            # 跑一轮
    python3 run.py --loop 5   # 连跑到收敛，演示「一轮的结果是下一轮的输入」

它证明的是【闭环的机械部分是对的】：隔离实验、门禁比较、
回归保护、失败回滚、全程留痕。不依赖大模型——所以 CI 能锁住它。
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages", "evolve"))
sys.path.insert(0, HERE)

from loop import Loop                                     # noqa: E402
from task import Parser                                   # noqa: E402
from phases.evaluate import evaluate as _eval                # noqa: E402
from phases.learn import learn                               # noqa: E402
from phases.improve import improve                           # noqa: E402
from phases.gate import make_gate                            # noqa: E402


def load_cases():
    with open(os.path.join(HERE, "cases.json"), encoding="utf-8") as f:
        return json.load(f)["cases"]


def one_round(parser, cases, n):
    inputs = [c["input"] for c in cases]
    baseline_results = parser.run(inputs)

    lp = Loop(
        "hello-harness", parser,
        evaluator=lambda r, i: _eval(r, i, cases),
        learner=learn,
        improver=improve,
        gate=make_gate(_eval, cases, baseline_results),
        inputs=inputs,
    )
    before = _eval(baseline_results, inputs, cases)["score"]
    out = lp.cycle()
    after = _eval(parser.run(inputs), inputs, cases)["score"]

    icon = {"promoted": "⬆️", "no_change_needed": "✅",
            "needs_human": "🙋", "all_rejected": "⛔"}.get(out.status, "❌")
    print(f"  第{n}轮 {icon} {out.phase}:{out.status}  "
          f"通过率 {before:.0%} → {after:.0%}"
          f"{'  规则: ' + ','.join(parser.checkpoint()) if after != before else ''}")
    return out, after


def main():
    rounds = 1
    if "--loop" in sys.argv:
        rounds = int(sys.argv[sys.argv.index("--loop") + 1])

    cases = load_cases()
    parser = Parser()
    print(f"=== hello-harness：{len(cases)} 条用例，最多 {rounds} 轮 ===")

    last = None
    for n in range(1, rounds + 1):
        out, score = one_round(parser, cases, n)
        last = out
        if out.status == "no_change_needed":
            print(f"\n✅ 已收敛：{score:.0%} 通过，无需再改")
            return 0
        if out.status in ("all_rejected", "needs_human", "failed"):
            print(f"\n⚠️ 停在 {out.phase}:{out.status} —— "
                  f"这是【安全状态】，不是成功")
            return 1
    print(f"\n跑满 {rounds} 轮，最终 {last.status}")
    return 0 if last and last.ok else 1


if __name__ == "__main__":
    sys.exit(main())
