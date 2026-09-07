# -*- coding: utf-8 -*-
"""G11 全屏沉浸式浮层 z-index ≥ 1000。

现有全局层级：Navbar sticky 100、Navbar 抽屉 200、.bottom-tab-bar 200、
audiobook-player 250。全屏浮层若取值低于这些，会被盖住——
听书阅读器栽过：容器 z100，顶部靠 DOM 靠后压住了 Navbar，
但底部 BottomTabBar(z200) 更高，把阅读器自己的翻页/进度控制条整条遮没。

错误态、空态容器也要同样 fixed + 高 z-index，否则报错页会被全局栏穿透。
"""
import re

RULE = "G11"
TITLE = "全屏浮层 z-index"

FLOOR = 1000
FIXED = re.compile(r"position\s*:\s*['\"]?fixed", re.I)
INSET0 = re.compile(r"inset\s*:\s*['\"]?0|top\s*:\s*0[^\n]*left\s*:\s*0", re.I)
ZI = re.compile(r"zIndex\s*:\s*(\d+)")


def check(ctx):
    # 目标不存在时必须明说。扫 0 个文件却静默通过，等于门禁在这一项上不存在——
    # 这正是 policies 记录过的失败形态（对某种情况静默跳过，看起来一切正常）。
    if not ctx.exists("services/web"):
        yield ("SKIP", "services/web/ 不存在，本规则未生效", "迁入代码后此项才会真正检查")
        return
    for f in ctx.walk(".jsx", ".tsx", under="services/web"):
        lines = ctx.read(f).splitlines()
        for i, line in enumerate(lines):
            if not FIXED.search(line):
                continue
            window = "\n".join(lines[i:i + 8])
            if not INSET0.search(window):        # 不是全屏浮层，跳过
                continue
            m = ZI.search(window)
            if not m:
                yield ("WARN", f"{ctx.rel(f)}:{i+1} 全屏浮层没写 z-index",
                       f"会被 Navbar(100)/BottomTabBar(200) 盖住，明确写 ≥{FLOOR}")
            elif int(m.group(1)) < FLOOR:
                yield ("ERROR",
                       f"{ctx.rel(f)}:{i+1} 全屏浮层 z-index={m.group(1)} < {FLOOR}",
                       "低于 BottomTabBar(200) 会被遮；错误态/空态容器同样要提上去")
