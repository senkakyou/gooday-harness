# -*- coding: utf-8 -*-
"""G19 有 config.example.json 的 workflow，install.sh 必须播种 config.json。

2026-09-07 真实回归：install.sh 本来有播种逻辑，
后来重写 crontab 的 runas 分组时【把它连带删掉了】。
结果 install 报告成功，而 cert-renew / db-snapshot / disk-cleanup
三个 workflow 装上了却没有 config.json——一跑就退出。

而且这个故障极难发现：
  · install.sh 全绿
  · cron 装上了
  · 日志里只有一行「缺 config.json」，没人会去看
  · 备份因此停了几小时，直到 patrol 的 config_drift 项才抓出来

**「装完了」不等于「能跑」**（G08 的同一族）。
本规则管的是结构：只要有 workflow 依赖 config.json，
安装脚本就必须负责让它存在。

顺带查另一个方向：config.json 不得进版本库（各机器不同，且可能含本机路径）。
"""
import os
import re

RULE = "G19"
TITLE = "配置必须被播种"

INSTALL = "ops/install.sh"


def check(ctx):
    needs = []
    for name in ctx.subdirs("workflows"):
        if name.startswith("_"):
            continue
        if ctx.exists("workflows", name, "config.example.json"):
            needs.append(name)
    if not needs:
        yield ("SKIP", "没有 workflow 依赖 config.json", "")
        return

    src = ctx.read(INSTALL)
    if not src:
        yield ("ERROR", f"{INSTALL} 不存在", "")
        return

    # 必须有「缺就从 example 拷」这个动作
    seeded = re.search(r"config\.example\.json.*config\.json", src, re.S) and \
        re.search(r"(cp|install)\s+[^\n]*config\.example\.json", src)
    if not seeded:
        yield ("ERROR",
               f"{INSTALL} 没有播种 config.json 的逻辑，"
               f"但有 {len(needs)} 个 workflow 依赖它：{'、'.join(needs)}",
               "缺这一步时 install 会报告成功，而部署出来的 workflow "
               "一跑就退出——「装完了」不等于「能跑」")

    # 反向：config.json 不得进版本库
    if ctx.git_available():
        for f in ctx.tracked():
            if re.search(r"workflows/[^/]+/config\.json$", f):
                yield ("ERROR", f"config.json 进了版本库：{f}",
                       "它各机器不同、可能含本机路径。加进 .gitignore，"
                       "由 install.sh 从 example 播种")
