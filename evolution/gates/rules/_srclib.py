# -*- coding: utf-8 -*-
"""规则共用：把源码里【不会被执行的部分】剥掉再做匹配。

下划线开头 = 加载器不把它当规则（见 check.py 的 load_rules）。

为什么需要它（2026-09-08 连撞三次）：

1. `g04` 要求 install.sh 里有 `ops/nginx/*` 这种通配扫描。nginx 段改写之后
   代码里已经没有这个 glob 了，**但注释里写了一句「原来 glob 写成
   ops/nginx/*.conf」** —— 规则匹配到注释，判定通过。
2. `g17` 要求 `.pre-commit-config.yaml` 里真的调用了 check.py。
   把那行 `entry: python3 evolution/gates/check.py .` 注释掉，G17 照样绿。
3. `g21` 自己也犯：一行 `# TODO: 之后复用 outbound 的 MAX_CONTENT` 就能让它报绿。

**一个能被注释文字满足的检查器是假的。** 而假绿正是本项目存在的理由要消灭的东西，
检查器自己更不能犯。

## 为什么不无差别剥字符串（这是第一版的错）

第一版把所有单行引号内容一起剥了，理由是 `echo "记得扫 ops/nginx/conf.d/*"`
是提示语不是扫描（install.sh 第 162 行真有这么一句，它单独就能满足 G04）。
理由对，**下手过宽**——灵犀 2026-09-08 评审给了两个实测假红：

| 完全合法的写法 | 剥完之后 | 结果 |
|---|---|---|
| `for dir in "$REPO/services"/*/` | `for dir in /*/` | ❌ G04「没有扫描 services/」 |
| `entry: "python3 evolution/gates/check.py ."` | `entry:` | ⚠️ G17「pre-commit 未接入检查器」 |

两个都是常见风格。**现在能绿只是因为本仓库恰好把引号闭在了别处**——
那是靠写法运气，不是靠规则。

Python 里引号内基本不承载被 grep 的语义，**shell 和 YAML 里承载**。
所以剥字符串这件事按语言分开对待，别跨语言套同一套：
`strip_echo` 只剥 `echo` / `printf` 的引号参数（那才是"提示语"的所在），
别的字符串一律留着。**跨语言套用同一套剥法，正是"做一半的词法分析"。**
"""
import re

# 单行内的 '...' 与 "..." 。跨行字符串（heredoc、三引号）不处理——
# 处理它们要真做词法分析，而【做一半的词法分析比不做更危险】：
# 它会在某些写法上悄悄剥错东西，制造出比原问题更难查的假阴性。
_STR = re.compile(r"'[^'\n]*'|\"[^\"\n]*\"")
# 行内从 echo / printf 开始的部分（命令名之后就是它的参数）
_ECHO = re.compile(r"\b(echo|printf)\b")


def code_only(src, strip_echo=False):
    """去掉整行注释后的源码。

    只剥【整行】注释，不碰行尾 `#`——行尾的 `#` 可能落在字符串里，
    剥了会造出新的假象。宁可少剥一点，也不要剥错。

    strip_echo=True（只对 shell 用）：再把 echo / printf 的引号参数剥掉。
    那是"打给人看的提示语"，不是"脚本真的在做的事"——
    一句 `echo "改要改 workflows/*/deploy/schedule.cron"` 不该满足
    「install.sh 有没有扫描 workflows/」。
    """
    lines = []
    for ln in src.splitlines():
        s = ln.lstrip()
        if s.startswith("#") or s.startswith("//"):
            continue
        if strip_echo:
            m = _ECHO.search(ln)
            if m:
                # 只对 echo/printf 之后的部分动手，前半行原样保留：
                # `foo services/*/ && echo "..."` 里前半截是真的在扫描。
                ln = ln[:m.end()] + _STR.sub(" ", ln[m.end():])
        lines.append(ln)
    return "\n".join(lines)
