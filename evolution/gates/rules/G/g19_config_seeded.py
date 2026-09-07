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
    # 【两个扩展点都要查】。原来只查 workflows，于是 services 那边
    # 漏了播种也不报——7 个服务全部起不来而 install.sh 全绿（2026-09-07）。
    needs = []
    for point in ("workflows", "services"):
        for name in ctx.subdirs(point):
            if name.startswith("_"):
                continue
            if ctx.exists(point, name, "config.example.json"):
                needs.append(f"{point}/{name}")
    if not needs:
        yield ("SKIP", "没有 workflow 依赖 config.json", "")
        return

    src = ctx.read(INSTALL)
    if not src:
        yield ("ERROR", f"{INSTALL} 不存在", "")
        return

    # 【必须按扩展点分别查】。只查「有没有播种这个动作」是不够的：
    # 两个扩展点各有自己的循环，一边有一边没有时，粗判会全都放行——
    # 2026-09-07 实测踩到：workflows 那段在、services 那段漏了，
    # 7 个服务全部起不来而门禁全绿。
    for point in ("workflows", "services"):
        members = [n for n in needs if n.startswith(point + "/")]
        if not members:
            continue
        # 找该扩展点的循环体，看里面有没有播种
        m = re.search(rf'for dir in "\$REPO"/{point}/\*/;(.*?)^done', src,
                      re.S | re.M)
        if not m:
            yield ("ERROR", f"{INSTALL} 没有遍历 {point}/ 的循环",
                   f"该扩展点下 {len(members)} 个成员不会被安装")
            continue
        if "config.example.json" not in m.group(1):
            yield ("ERROR",
                   f"{INSTALL} 的 {point}/ 循环里没有播种 config.json，"
                   f"但有 {len(members)} 个成员依赖它："
                   f"{'、'.join(n.split('/')[-1] for n in members)}",
                   "install 会报告成功而部署出来的东西一跑就退出——"
                   "「装完了」不等于「能跑」")

    # 反向：config.json 不得进版本库
    if ctx.git_available():
        for f in ctx.tracked():
            if re.search(r"(workflows|services)/[^/]+/config\.json$", f):
                yield ("ERROR", f"config.json 进了版本库：{f}",
                       "它各机器不同、可能含本机路径。加进 .gitignore，"
                       "由 install.sh 从 example 播种")
