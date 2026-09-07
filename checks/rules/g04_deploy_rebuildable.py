# -*- coding: utf-8 -*-
"""G04 部署可重建：ops/install.sh 必须整目录扫描，不得写死文件名。

真实事故（2026-09-07）：claudecred.conf 已在服务器上生效，但安装脚本里
只写死装 memorymax.conf。一旦重装机器或重建服务，bot 会退回读一份早已失效的
凭据——表现是「活着但答不出话」，心跳、systemd 状态、服务列表全绿，没人会发现。

根因不是「忘了改脚本」，是【脚本要求你记得改】。所以规范不是「记得同步」，
而是【结构上不需要记得】——整目录扫描。
"""
import os
import re

RULE = "G04"
TITLE = "部署可重建"

INSTALL = "ops/install.sh"
# 必须被整目录扫描覆盖的配置目录
MUST_SCAN = ("ops/systemd", "ops/cron", "ops/nginx")


def check(ctx):
    if not ctx.exists(INSTALL):
        yield ("ERROR", f"{INSTALL} 不存在",
               "没有可重复执行的安装入口，机器重建时配置必丢")
        return

    src = ctx.read(INSTALL)

    for d in MUST_SCAN:
        if not ctx.exists(d):
            continue
        files = [f for f in os.listdir(ctx.path(d)) if not f.startswith(".")]
        if not files:
            continue

        # 有没有对这个目录做 glob 扫描
        globbed = re.search(rf"{re.escape(d)}/\*", src) or \
            re.search(rf"for\s+\w+\s+in\s+[^\n]*{re.escape(os.path.basename(d))}[^\n]*\*", src)
        if globbed:
            continue

        # 没 glob，但逐个写死了？那就是 G04 要抓的形态
        hardcoded = [f for f in files if f in src]
        if hardcoded:
            missing = [f for f in files if f not in src]
            msg = f"{d}/ 被逐个写死安装（{len(hardcoded)}/{len(files)} 个）"
            hint = "改成 for f in %s/*; do install ...; done —— 写死就要求人记得同步，迟早漏" % d
            if missing:
                msg += f"，已漏掉：{'、'.join(missing[:3])}"
                yield ("ERROR", msg, hint)
            else:
                yield ("WARN", msg, hint)
        else:
            yield ("ERROR", f"{d}/ 下有 {len(files)} 个配置，但 {INSTALL} 完全没安装它们",
                   "机器重建后这些配置会静默丢失")

    # 安装脚本必须幂等可重跑
    if "set -e" not in src:
        yield ("WARN", f"{INSTALL} 没有 set -e", "中途失败会继续跑下去，装出半套配置")
