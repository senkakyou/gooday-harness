# -*- coding: utf-8 -*-
"""G06 扩展点契约：新增成员必须能靠复制模板完成，不改任何现有文件。

这条是「可扩展」的执行体。判据很硬：
    新增一个 service / pipeline / package = cp -r _template <名字>，
    【不需要改 install.sh、不需要改 crontab、不需要改任何公共文件】。

反面教材（2026-09-07 真实事故）：新增 systemd drop-in 需要手工改
install-v3-root.sh 才装得上。结果 claudecred.conf 在服务器上生效了，
脚本却没同步——重装机器时静默丢配置，bot 退回读失效凭据，
表现为「活着但答不出话」，心跳和 systemd 全绿，无人发现。

根因不是「忘了改」，是【结构要求你记得改】。所以本规则查的是结构，不是记性。
"""
import os

RULE = "G06"
TITLE = "扩展点契约"

# 扩展点 -> 每个成员必须有的东西
POINTS = {
    "services":                ["README.md", "deploy/unit.service"],
    "workflows":               ["README.md", "deploy/schedule.cron"],
    "packages":                ["README.md"],
    # 第二层循环的两个扩展点：评价器与实验
    "evolution/evaluators":    ["README.md"],
    "evolution/experiments":   ["README.md"],
}


def check(ctx):
    for point, required in POINTS.items():
        if not ctx.exists(point):
            yield ("ERROR", f"扩展点 {point}/ 不存在", "骨架缺了一个扩展点")
            continue

        # 1) 模板必须在——没有模板，"复制模板"就无从谈起
        tpl = os.path.join(point, "_template")
        if not ctx.exists(tpl):
            yield ("ERROR", f"{point}/_template/ 缺失",
                   "扩展点必须自带模板，否则新增成员只能靠抄别人的、抄漏了没人知道")
            continue
        for r in required:
            if not ctx.exists(tpl, *r.split("/")):
                yield ("ERROR", f"{point}/_template/ 缺 {r}",
                       "模板不完整，照它复制出来的成员也会缺")

        # 2) 每个成员必须符合模板结构
        for name in ctx.subdirs(point):
            if name.startswith("_"):
                continue
            for r in required:
                if not ctx.exists(point, name, *r.split("/")):
                    yield ("ERROR", f"{point}/{name}/ 缺 {r}",
                           f"照 {point}/_template/ 补齐；缺了它装不上或没人知道它算不算成功")

    # 3) 反向：部署配置不得散落在扩展点之外
    #    服务的 unit 必须待在自己服务目录里，不能回到全局 ops/
    for stray in ("ops/systemd", "ops/cron", "pipelines", "norms", "checks"):
        if ctx.exists(stray):
            yield ("ERROR", f"{stray}/ 不该存在",
                   "部署配置随服务/流程走（services/*/deploy、workflows/*/deploy）；"
                   "pipelines→workflows、norms→policies、checks→evolution/gates 已改名，"
                   "集中放会让新增成员必须改公共目录——那正是本规则要防的")
