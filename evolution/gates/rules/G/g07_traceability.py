# -*- coding: utf-8 -*-
"""G07 可追溯：自动改动必须留痕，且实验必须有 Decision。

自我迭代的前提不是"能改"，是"改了之后说得清为什么改、凭什么判断改对了、
以及怎么退回去"。没有这三样，第二层循环就退化成随机扰动。

今晚（2026-09-07）踩的每个坑都是"发生了但没留痕"：
  · 凭据 8/25 就失效，没有任何地方记下这件事，三周无人发现
  · drop-in 装上了但安装脚本没记，重装即静默丢失
  · 注入防御条款写进文档三个月，没进任何 bot 的 prompt，也没人能发现

所以本规则查的是【结构上有没有留痕的位置】，以及【实验有没有理由和退路】。
"""
import os
import re

RULE = "G07"
TITLE = "自动改动可追溯"

# 运行期留痕目录（在仓库外，由 ops/install.sh 创建）
RUNTIME_DIRS = ("tasks", "events", "evidence", "evaluations", "checkpoints")


def _expand_braces(text):
    """把 bash 花括号展开成字面路径：/a/{x,y} → /a/x /a/y

    不做这一步的话，检查器会在【完全正确】的 install.sh 上报警——
    而在正确代码上报警的检查器会被人关掉，那比不检查更糟
    （今晚 C09 用 grep 抓 `except: pass` 已经栽过一次同样的坑）。
    """
    def one(m):
        prefix, items = m.group(1), m.group(2).split(",")
        return " ".join(prefix + i.strip() for i in items)
    return re.sub(r"(\S*?)\{([^{}]*,[^{}]*)\}", one, text or "")


def check(ctx):
    install = _expand_braces(ctx.read("ops/install.sh"))

    # 1) 安装脚本必须创建全部留痕目录，否则第一次跑就无处可写
    if install:
        missing = [d for d in RUNTIME_DIRS if f"/var/lib/gooday/{d}" not in install]
        if missing:
            yield ("ERROR",
                   f"ops/install.sh 未创建留痕目录：{'、'.join(missing)}",
                   "第二层循环靠它们说话，没有目录就等于没有证据链")

    # 2) Decision 必须进版本库（它是「为什么这么改」的唯一载体）
    if not ctx.exists("docs/decisions"):
        yield ("ERROR", "docs/decisions/ 不存在",
               "改动理由必须进版本库，运行期数据可以丢，决策记录不能丢")

    # 3) 每个实验必须关联一个 Decision，且写明回滚点
    for name in ctx.subdirs("evolution/experiments"):
        if name.startswith("_"):
            continue
        rel = f"evolution/experiments/{name}"
        body = ctx.read(os.path.join(rel, "README.md"))
        if not body:
            continue
        if not re.search(r"docs/decisions/\S+\.md", body):
            yield ("ERROR", f"{rel} 没有关联 Decision",
                   "没有 Decision 的实验，结果无从解释——先写清楚为什么要改")
        if not re.search(r"回滚|rollback|checkpoint", body, re.I):
            yield ("ERROR", f"{rel} 没写回滚点",
                   "实验必须能退回去。没演练过的回滚方案等于没有")

    # 4) 每个评价器必须说明 Evidence 来源
    for name in ctx.subdirs("evolution/evaluators"):
        if name.startswith("_"):
            continue
        rel = f"evolution/evaluators/{name}"
        body = ctx.read(os.path.join(rel, "README.md"))
        if body and not re.search(r"Evidence|证据", body, re.I):
            yield ("ERROR", f"{rel} 未说明 Evidence 来源",
                   "没有证据的评价是拍脑袋，用它驱动改进只会放大噪音")
