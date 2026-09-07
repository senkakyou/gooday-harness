# -*- coding: utf-8 -*-
"""Improve：根据经验生成候选改进方案。

【每个候选必须说清四件事】，缺一不可（policies G07 的精神）：
  target     改什么
  scope      影响范围
  risk       风险
  acceptance 验收指标

说不清这四样的「改进」不该被自动执行——那不是改进，是碰运气。

═══ 为什么用确定性策略库而不是让模型生成补丁 ═══

不是因为模型不行，是因为【CI 必须能验证这个闭环本身】。
用模型生成时，CI 跑绿只能说明「今天模型状态不错」，
说明不了闭环的机械部分（隔离、门禁、回滚、留痕）是对的。

模型驱动的 improver 作为可选实现接入即可——接口是一样的。
先让确定性版本把闭环跑通并被 CI 锁住，再谈更聪明的候选来源。
"""

# 失败类别 → 能治它的策略。这就是「经验」到「候选」的映射。
KIND_TO_STRATEGY = {
    "chinese_numeral":    ["chinese"],
    "chinese_with_unit":  ["chinese_unit", "chinese"],
    "arabic_with_unit":   ["strip_unit"],
    "fullwidth_digit":    ["fullwidth"],
}

RISK = {
    "chinese":      "中文数字解析范围有限（万以内），超出会返回错值而非 None",
    "chinese_unit": "同上，且单位表是白名单，未列的单位仍不认",
    "strip_unit":   "会把「3个」和「3」视作等价——若业务需要区分则不适用",
    "fullwidth":    "仅转全角数字，全角单位不处理",
}


def improve(experiences, evaluation):
    """返回候选列表，按能覆盖的失败数排序——先试收益大的。"""
    failures = [e for e in experiences if e.get("type") == "failure"]
    if not failures:
        return []

    # 按失败条数降序：一次解决得多的先试
    failures.sort(key=lambda e: -e.get("count", 0))
    baseline = evaluation.get("score", 0)

    cands, seen = [], set()
    for exp in failures:
        for strat in KIND_TO_STRATEGY.get(exp["kind"], []):
            if strat in seen:
                continue
            seen.add(strat)
            cands.append({
                "target": f"task.py 规则表 += {strat}",
                "why": f"经验 {exp['kind']}：{exp['signal']}（{exp['count']} 条）",
                "scope": "仅新增一条匹配规则；已有规则顺序不变，"
                         "因此不会改变当前已通过用例的行为",
                "risk": RISK.get(strat, "未评估——未评估风险的候选不该自动 promote"),
                "acceptance": f"通过率 > {baseline}，且【已通过的用例一条都不能退化】",
                "patch": {"add_rules": [strat]},
            })
    return cands
