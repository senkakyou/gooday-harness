# -*- coding: utf-8 -*-
"""G17 门禁必须被自动触发。

**规范 + 检查器 + 没人自动跑它 = 等于没有。**

2026-09-07 站长问「骨架算完事了吗」，一查才发现：15 条规范、一个检查器，
但既没有 CI、也没有 pre-commit、install.sh 也不调用它——全靠人记得敲命令。

这和本项目记录过的那几次是【完全同一个形状】：
  · 注入防御条款写进文档三个月，没进任何 bot 的 prompt
  · drop-in 装到服务器上了，但安装脚本没记，重装即丢
  · 备份脚本配置好了，但没在跑，出事那天才发现最新快照是三周前的

共同点都是「东西存在，但不会自动生效」。本项目存在的理由就是消灭这个形状，
所以它自己更不能犯——本规则是那道保险丝。
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _srclib import code_only                                        # noqa: E402

RULE = "G17"
TITLE = "门禁必须被自动触发"

CHECKER = "evolution/gates/check.py"


def check(ctx):
    triggers = []

    # 1) CI：.github/workflows 下必须有工作流真的调用检查器
    wf_dir = ctx.path(".github", "workflows")
    ci_ok = False
    if os.path.isdir(wf_dir):
        for fn in os.listdir(wf_dir):
            if fn.endswith((".yml", ".yaml")) and CHECKER in code_only(ctx.read(os.path.join(wf_dir, fn))):
                ci_ok = True
                triggers.append(f"CI({fn})")
                break
    if not ci_ok:
        yield ("ERROR", "没有 CI 工作流调用检查器",
               f".github/workflows/ 下加一个跑 `python3 {CHECKER} .` 的工作流")

    # 2) 本地钩子：pre-commit 配置里必须有它
    pc = code_only(ctx.read(".pre-commit-config.yaml"))
    if CHECKER in pc:
        triggers.append("pre-commit")
    else:
        yield ("WARN", "pre-commit 未接入检查器",
               "CI 是最后一道；本地这道能让人在提交前就发现，别只留 CI")

    # 3) CI 必须用全量 clone —— 浅克隆会让依赖 git 列表的规则失真
    if ci_ok:
        for fn in os.listdir(wf_dir):
            if not fn.endswith((".yml", ".yaml")):
                continue
            body = code_only(ctx.read(os.path.join(wf_dir, fn)))
            if CHECKER not in body:
                continue
            if "fetch-depth" not in body:
                yield ("WARN", f".github/workflows/{fn} 没设 fetch-depth",
                       "actions/checkout 默认浅克隆，G01/G03/G09 靠 git 跟踪列表判断，"
                       "浅克隆下结论会失真")

    # 4) 服务器侧：CI 盖不到运行期实证（G07 的证据链、进程是否比代码新），
    #    工作流里必须写明这一点，否则「接了 CI」会给人全都覆盖了的错觉
    if ci_ok:
        blob = "".join(ctx.read(os.path.join(wf_dir, f))
                       for f in os.listdir(wf_dir) if f.endswith((".yml", ".yaml")))
        if not re.search(r"crontab|服务器|运行期", blob):
            yield ("WARN", "CI 未说明哪些项它盖不到",
                   "运行期实证只能在服务器上跑。不写明的话，"
                   "「CI 绿了」会被当成「全都查过了」")

    if triggers:
        yield ("SKIP", f"门禁触发点：{'、'.join(triggers)}", "")
