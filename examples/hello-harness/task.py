#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""被改进的对象：一个把中文数量词解析成数字的函数。

挑这个任务是因为它满足三个条件：
  · 会【真的失败】——初始实现只认阿拉伯数字，中文数字全挂
  · 失败【可归类】——按输入形态能分出「中文数字」「带单位」「全角」等类别
  · 改进【可度量】——通过率是硬指标，不是感觉

实现由一串「规则」组成，候选改动就是【往规则表里加一条】。
这样候选是数据不是代码，实验可以在隔离副本上安全地跑。
"""
import copy
import re

# 规则表：(名字, 匹配, 转换)。改进 = 往这里加规则。
BASE_RULES = [
    ("arabic", r"^\s*(\d+)\s*$", lambda m: int(m.group(1))),
]

CN_DIGITS = {"零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
             "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def _cn_to_int(s):
    """中文数字转整数。只处理万以内——够用就行，别提前造轮子。"""
    s = s.strip()
    if s in CN_DIGITS:
        return CN_DIGITS[s]
    total, section, num = 0, 0, 0
    for ch in s:
        if ch in CN_DIGITS:
            num = CN_DIGITS[ch]
        elif ch == "十":
            section += (num or 1) * 10
            num = 0
        elif ch == "百":
            section += (num or 1) * 100
            num = 0
        elif ch == "千":
            section += (num or 1) * 1000
            num = 0
        elif ch == "万":
            total += (section + num) * 10000
            section = num = 0
        else:
            return None
    return total + section + num


# 可用的候选规则库。Improver 从这里挑——确定性的，不需要模型，
# 这样 CI 能验证闭环本身，而不是验证模型今天心情好不好。
STRATEGY_LIBRARY = {
    "strip_unit": ("strip_unit", r"^\s*(\d+)\s*(?:个|只|件|台|张|本|次)\s*$",
                   lambda m: int(m.group(1))),
    "fullwidth": ("fullwidth", r"^\s*([０-９]+)\s*$",
                  lambda m: int(m.group(1).translate(
                      str.maketrans("０１２３４５６７８９", "0123456789")))),
    "chinese": ("chinese", r"^\s*([零一二两三四五六七八九十百千万]+)\s*$",
                lambda m: _cn_to_int(m.group(1))),
    "chinese_unit": ("chinese_unit",
                     r"^\s*([零一二两三四五六七八九十百千万]+)\s*(?:个|只|件|台|张|本|次)\s*$",
                     lambda m: _cn_to_int(m.group(1))),
}


class Parser:
    """规则表驱动的解析器。patch = 要加的规则名列表。"""

    def __init__(self, rules=None):
        self.rules = list(rules if rules is not None else BASE_RULES)

    # ── Subject 接口 ──────────────────────────────────────
    def run(self, inputs):
        out = []
        for text in inputs:
            out.append({"input": text, "output": self.parse(text)})
        return out

    def variant(self, patch):
        """隔离副本：不碰自身的规则表。"""
        v = Parser(copy.copy(self.rules))
        for name in patch.get("add_rules", []):
            if name in STRATEGY_LIBRARY and \
                    name not in [r[0] for r in v.rules]:
                v.rules.append(STRATEGY_LIBRARY[name])
        return v

    def checkpoint(self):
        return [r[0] for r in self.rules]

    def promote(self, patch):
        for name in patch.get("add_rules", []):
            if name in STRATEGY_LIBRARY and \
                    name not in [r[0] for r in self.rules]:
                self.rules.append(STRATEGY_LIBRARY[name])

    def rollback(self, ckpt):
        names = set(ckpt)
        keep = [r for r in self.rules if r[0] in names]
        # 基础规则不能被回滚掉
        self.rules = keep or list(BASE_RULES)

    # ── 业务 ──────────────────────────────────────────────
    def parse(self, text):
        for _name, pat, fn in self.rules:
            m = re.match(pat, str(text))
            if m:
                try:
                    return fn(m)
                except Exception:
                    return None
        return None
