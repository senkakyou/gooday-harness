# -*- coding: utf-8 -*-
"""Evaluate：这一轮做得怎么样。

判据是通过率——【数据不是感觉】。
同时把每个失败的具体形态记下来，Learn 要靠它归类。
"""


def evaluate(results, inputs, cases):
    expect = {c["input"]: c["expect"] for c in cases}
    fails = []
    for r in results:
        want = expect.get(r["input"])
        if r["output"] != want:
            fails.append({"input": r["input"], "got": r["output"], "want": want})
    score = 1 - len(fails) / max(len(results), 1)
    verdict = "pass" if not fails else ("warn" if score >= 0.8 else "fail")
    reasons = ([f"{len(fails)}/{len(results)} 条不通过"] +
               [f"  {f['input']!r} 得到 {f['got']} 应为 {f['want']}" for f in fails[:4]]
               ) if fails else [f"{len(results)} 条全部通过"]
    return {"score": round(score, 4), "verdict": verdict,
            "reasons": reasons, "failures": fails,
            "evidence": {"total": len(results), "failed": len(fails)}}
