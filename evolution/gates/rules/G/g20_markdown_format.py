# -*- coding: utf-8 -*-
"""G20 Markdown 排版统一。

这些文档是**给人读的主要界面** —— 新人接手先读 README，出事先读 runbook。
排版不统一的代价不是"不好看"：标题前不空行会被某些渲染器吞掉标题，
列表前不空行会被当成上一段的续行整段挤在一起，
首行不是 H1 会让目录生成器抓不到标题。
**在终端里勉强能看，在渲染后就散了。**

规矩取最小集，每条都能自动判定，不做风格偏好之争：

  1. 首行必须是 `# ` —— 状态横幅之类放标题【之后】
  2. 标题、列表、表格、代码块前面要有空行（文件首行除外）
  3. 不留行尾空格
  4. 文件以恰好一个换行结束
  5. 标题层级不跳级（H2 下面不能直接出 H4）

自动修：`python3 evolution/gates/rules/G/g20_markdown_format.py --fix`
"""
import os
import re
import sys

RULE = "G20"
TITLE = "Markdown 排版"

H = re.compile(r"^(#{1,6}) ")
LIST = re.compile(r"^[-*+] |^\d+\. ")
FENCE = re.compile(r"^```")


# prompt.md 不是文档，是【喂给模型的数据】：首行是给人看的 HTML 注释，
# runner.py 会把注释剥掉再送模型。强改成 H1 会改变模型真正读到的内容。
# 豁免的是「首行必须 H1」这一条，其余排版规矩照常适用。
NOT_A_DOC = ("prompt.md",)


def _problems(path, text):
    """返回 [(行号, 说明)]。行号从 1 起；0 表示整个文件。"""
    out = []
    lines = text.split("\n")
    if lines and not lines[0].startswith("# ") \
            and os.path.basename(path) not in NOT_A_DOC:
        out.append((1, "首行不是 H1 —— 状态横幅等放标题之后，目录生成器要靠它抓标题"))
    if text and not text.endswith("\n"):
        out.append((0, "文件末尾缺换行"))
    if text.endswith("\n\n"):
        out.append((0, "文件末尾有多余空行"))

    in_fence = False
    levels = []
    for i, l in enumerate(lines):
        n = i + 1
        prev = lines[i - 1] if i else ""
        if FENCE.match(l):
            if not in_fence and i and prev.strip():
                out.append((n, "代码块前缺空行"))
            in_fence = not in_fence
            continue
        if in_fence:
            continue                        # 代码块内不管排版
        if l != l.rstrip():
            out.append((n, "行尾有空格"))
        m = H.match(l)
        if m:
            if i and prev.strip():
                out.append((n, "标题前缺空行"))
            lv = len(m.group(1))
            if levels and lv > levels[-1] + 1:
                out.append((n, f"标题层级跳跃：H{levels[-1]} 直接到 H{lv}"))
            levels.append(lv)
        elif LIST.match(l):
            if i and prev.strip() and not LIST.match(prev) and not prev.startswith(" "):
                out.append((n, "列表前缺空行"))
        elif l.startswith("|"):
            if i and prev.strip() and not prev.startswith("|"):
                out.append((n, "表格前缺空行"))
    return out


def fix(text):
    """按同一套规矩自动修。**只加空行、去行尾空格，不改任何字**。"""
    lines = text.rstrip("\n").split("\n")
    out, in_fence = [], False
    for i, l in enumerate(lines):
        l = l.rstrip()
        is_fence = FENCE.match(l)
        need_blank = False
        if is_fence and not in_fence:
            need_blank = True
        elif not in_fence:
            if H.match(l) or LIST.match(l) or l.startswith("|"):
                prev_raw = lines[i - 1].rstrip() if i else ""
                same_kind = (
                    (LIST.match(l) and (LIST.match(prev_raw) or prev_raw.startswith(" ")))
                    or (l.startswith("|") and prev_raw.startswith("|")))
                need_blank = not same_kind
        if need_blank and out and out[-1].strip():
            out.append("")
        out.append(l)
        if is_fence:
            in_fence = not in_fence
    return "\n".join(out) + "\n"


def check(ctx):
    go, level, why = ctx.git_verdict()
    if not go:
        yield (level, why, "")
        return
    for f in ctx.tracked():
        if not f.endswith(".md"):
            continue
        text = ctx.read(f)
        if not text:
            continue
        for n, msg in _problems(f, text):
            where = f"{f}:{n}" if n else f
            yield ("WARN", f"{where} {msg}",
                   "跑 python3 evolution/gates/rules/G/g20_markdown_format.py --fix 自动修")


if __name__ == "__main__":
    import subprocess
    root = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                          capture_output=True, text=True).stdout.strip()
    files = subprocess.run(["git", "-C", root, "ls-files", "*.md"],
                           capture_output=True, text=True).stdout.split()
    do_fix = "--fix" in sys.argv
    changed = 0
    for rel in files:
        p = os.path.join(root, rel)
        with open(p, encoding="utf-8") as fh:
            old = fh.read()
        probs = _problems(rel, old)
        if not probs:
            continue
        if do_fix:
            new = fix(old)
            if new != old:
                with open(p, "w", encoding="utf-8") as fh:
                    fh.write(new)
                changed += 1
                print(f"  修 {rel}（{len(probs)} 处）")
        else:
            print(f"  {rel}：{len(probs)} 处")
            for n, m in probs[:3]:
                print(f"      {n}: {m}")
    print(f"\n{'已修 ' + str(changed) + ' 个文件' if do_fix else '仅检查，加 --fix 自动修'}")
