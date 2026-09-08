# -*- coding: utf-8 -*-
"""规则共用：把源码里【不会被执行的部分】剥掉再做匹配。

下划线开头 = 加载器不把它当规则（见 check.py 的 load_rules）。

为什么需要它（2026-09-08 连撞两次）：

1. `g04` 要求 install.sh 里有 `ops/nginx/*` 这种通配扫描。nginx 段改写之后
   代码里已经没有这个 glob 了，**但注释里写了一句「原来 glob 写成
   ops/nginx/*.conf」** —— 规则匹配到注释，判定通过。
2. `g17` 要求 `.pre-commit-config.yaml` 里真的调用了 check.py。
   把那行 `entry: python3 evolution/gates/check.py .` 注释掉，G17 照样绿。

**一个能被注释文字满足的检查器是假的。** 而假绿正是本项目存在的理由要消灭的东西，
检查器自己更不能犯。

字符串字面量同理：`echo "记得扫 ops/nginx/conf.d/*"` 是一句提示语，不是扫描。
本项目 install.sh 里真有这种行（第 162 行那句 echo 里带着 workflows/*）。
"""
import re

# 单行内的 '...' 与 "..." 。跨行字符串（heredoc、三引号）不处理——
# 处理它们要真做词法分析，而【做一半的词法分析比不做更危险】：
# 它会在某些写法上悄悄剥错东西，制造出比原问题更难查的假阴性。
_STR = re.compile(r"'[^'\n]*'|\"[^\"\n]*\"")


def code_only(src, strip_strings=True):
    """去掉整行注释（可选：再去掉单行字符串字面量）后的源码。

    只剥【整行】注释，不碰行尾 `#`——行尾的 `#` 可能落在字符串里，
    剥了会造出新的假象。宁可少剥一点，也不要剥错。
    """
    lines = []
    for ln in src.splitlines():
        s = ln.lstrip()
        if s.startswith("#") or s.startswith("//"):
            continue
        lines.append(_STR.sub(" ", ln) if strip_strings else ln)
    return "\n".join(lines)
