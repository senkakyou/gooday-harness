# -*- coding: utf-8 -*-
"""Learn：把失败沉淀成【结构化经验】，不是写一篇文档。

结构化的意义在于 Improve 能直接消费它：
「哪一类输入在失败」比「这次没做好」有用一万倍。

经验带 kind（失败类别）和 signal（判别依据），
下一轮遇到同类失败时能被检索到，而不是从头再学一遍。
"""
import re

CN = re.compile(r"[零一二两三四五六七八九十百千万]")
UNIT = re.compile(r"[个只件台张本次]")
FULL = re.compile(r"[０-９]")


def classify(text):
    """给失败输入归类。类别是给 Improve 用的检索键。"""
    has_cn, has_unit, has_full = bool(CN.search(text)), bool(UNIT.search(text)), bool(FULL.search(text))
    if has_cn and has_unit:
        return "chinese_with_unit"
    if has_cn:
        return "chinese_numeral"
    if has_full:
        return "fullwidth_digit"
    if has_unit:
        return "arabic_with_unit"
    return "unknown"


def learn(evaluation, results):
    """返回 [Experience]。每条经验必须能被 Improve 直接消费。"""
    by_kind = {}
    for f in evaluation.get("failures", []):
        k = classify(f["input"])
        by_kind.setdefault(k, []).append(f)

    out = []
    for kind, items in by_kind.items():
        out.append({
            "kind": kind,
            "type": "failure",
            "count": len(items),
            "samples": [i["input"] for i in items[:5]],
            # signal 是判别依据：下次遇到同类输入能认出来
            "signal": f"输入形态属于 {kind}，当前实现返回 {items[0]['got']}",
            "impact": f"{len(items)} 条用例不通过",
        })

    # 成功也要沉淀——只学失败会让系统不知道什么是【不能弄坏的】
    if evaluation.get("score", 0) > 0:
        passed = evaluation["evidence"]["total"] - evaluation["evidence"]["failed"]
        out.append({
            "kind": "baseline_passing",
            "type": "success",
            "count": passed,
            "signal": f"当前有 {passed} 条已通过，任何改动【不得让它们变差】",
            "impact": "回归保护基线",
        })
    return out
