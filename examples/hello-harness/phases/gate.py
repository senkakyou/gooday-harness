# -*- coding: utf-8 -*-
"""Gate：候选能不能上。跑评价 ＋ 与基线比较 ＋ 回归保护。

三条判据，缺一不可：
  1. 分数必须【高于】基线——不是「不低于」。持平的改动没有理由上。
  2. 【原本通过的用例一条都不能退化】——总分涨了但弄坏了老功能，
     是最阴的一种「改进」，只看总分看不出来。
  3. 候选本身不能让实现崩溃。

第 2 条尤其重要：只比总分时，一个候选可以「修好 3 条、弄坏 2 条」
而显示为净赚 1 条。那不是改进，是拆东墙补西墙。
"""


def make_gate(evaluate_fn, cases, baseline_results):
    """baseline_results：改动前哪些用例是通过的——回归保护的依据。"""
    passing_before = {r["input"] for r in baseline_results
                      if r["output"] == {c["input"]: c["expect"]
                                         for c in cases}.get(r["input"])}

    def gate(variant, inputs, baseline):
        try:
            results = variant.run(inputs)
        except Exception as e:
            # 候选让实现崩了——【门禁失败绝不能当成通过】
            return {"passed": False, "score": None,
                    "reasons": [f"候选导致运行崩溃: {type(e).__name__}: {e}"]}

        ev = evaluate_fn(results, inputs, cases)
        expect = {c["input"]: c["expect"] for c in cases}
        regressed = [r["input"] for r in results
                     if r["input"] in passing_before
                     and r["output"] != expect.get(r["input"])]

        reasons = []
        passed = True
        if regressed:
            passed = False
            reasons.append(f"【回归】原本通过的 {len(regressed)} 条退化了："
                           f"{regressed[:3]}——总分涨了也不能上")
        if baseline is not None and (ev["score"] or 0) <= baseline:
            passed = False
            reasons.append(f"分数 {ev['score']} 未高于基线 {baseline}")
        if passed:
            reasons.append(f"分数 {baseline} → {ev['score']}，无回归")
        return {"passed": passed, "score": ev["score"], "reasons": reasons,
                "regressed": regressed}

    return gate
