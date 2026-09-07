# -*- coding: utf-8 -*-
"""H08 提交必须带验证证据。

「应该没问题」不是证据。提交信息里要能看出【用什么验的】——
跑了什么命令、看到什么输出、哪个判据达成了。

为什么这条重要：本项目反复栽在「以为验过了」上——
复验时进程跑的还是旧代码、静态检查全绿而系统跑不起来、
检查器在坏代码上也不报警。**没有证据的「已验证」等于没验证。**

来源：harness-kit。接入决策见 docs/specs/005-policy-layers.md。
"""
import re

RULE = "H08"
TITLE = "提交带验证证据"

N = 15          # 看最近多少条
MIN_RATE = 0.6  # 低于此比例即红

EVIDENCE = re.compile(
    r"实测|实证|验证|复现|跑了|测过|退出码|输出|通过|OK\b|"
    r"verified|tested|实跑", re.I)
# 只有这些词但没有具体内容的，不算证据
HOLLOW = re.compile(r"^(应该没问题|没问题|已验证|测试通过)[。.!]?$")


def check(ctx):
    go, level, why = ctx.git_verdict()
    if not go:
        # 四态裁决：no_repo→SKIP（本来就没版本库），
        # no_git/failed→ERROR（检查本该跑却没跑成，绝不能当成没问题）
        yield (level, why, "")
        return
    log = ctx.git("log", f"-{N}", "--format=%H%x01%s%x02%b%x03")
    if not log.strip():
        yield ("SKIP", "没有提交记录", "")
        return

    total, withev, bad = 0, 0, []
    for chunk in log.split("\x03"):
        if not chunk.strip():
            continue
        head, _, body = chunk.partition("\x02")
        sha, _, subj = head.partition("\x01")
        total += 1
        text = subj + "\n" + body
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        if any(HOLLOW.match(l) for l in lines):
            bad.append((sha[:7], subj[:40], "只说了「应该没问题」这类空话"))
            continue
        if EVIDENCE.search(text):
            withev += 1
        else:
            bad.append((sha[:7], subj[:40], "看不出用什么验的"))

    if not total:
        return
    rate = withev / total
    if rate < MIN_RATE:
        yield ("ERROR", f"最近 {total} 条提交只有 {withev} 条带验证证据（{rate:.0%}）",
               "提交信息要写清【用什么验的】——"
               "没有证据的「已验证」等于没验证")
        for sha, subj, why in bad[:3]:
            yield ("ERROR", f"  {sha} {subj}：{why}", "")
