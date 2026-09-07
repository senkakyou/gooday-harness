# -*- coding: utf-8 -*-
"""G10 输入框字号 ≥16px。

iOS Safari 会在用户点击 font-size < 16px 的 input/textarea 时自动放大整个页面，
导致布局错位、发送按钮被挤出视口。内联 style 会覆盖 CSS 类，两者必须一致。
"""
import re

RULE = "G10"
TITLE = "输入框字号 ≥16px"

FONT = re.compile(r"fontSize\s*:\s*['\"]?(\d+)")
INPUTISH = re.compile(r"<(input|textarea|select)\b", re.I)


def check(ctx):
    for f in ctx.walk(".jsx", ".tsx", ".js", ".ts", under="apps/web"):
        lines = ctx.read(f).splitlines()
        for i, line in enumerate(lines):
            m = FONT.search(line)
            if not m or int(m.group(1)) >= 16:
                continue
            # 只在 input/textarea/select 的上下文里才算违规
            window = "\n".join(lines[max(0, i - 6):i + 4])
            if INPUTISH.search(window):
                yield ("ERROR", f"{ctx.rel(f)}:{i+1} 输入框 fontSize={m.group(1)} < 16",
                       "iOS Safari 会自动放大整页；内联 style 覆盖 CSS 类，必须同为 16")
