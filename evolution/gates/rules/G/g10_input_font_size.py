# -*- coding: utf-8 -*-
"""G10 输入框字号 ≥16px。

iOS Safari 会在用户点击 font-size < 16px 的 input/textarea 时自动放大整个页面，
导致布局错位、发送按钮被挤出视口。内联 style 会覆盖 CSS 类，两者必须一致。

═══ 判定必须落到「输入框自己」身上 ═══════════════════════════════

初版是「在 ±6 行窗口里找到 fontSize，且附近有 <input> 就报」。
前端迁入时（2026-09-07）在真实代码上跑出 **114 条，抽查三条全是误报**：

  · `fontSize: '0.9rem'` 在 `<h2>` 上 → 正则把 `0.9` 截成 `0`，报「fontSize=0」
  · `fontSize: 12` 在标签 div「备注名」上，它下面那个 input 明明写着 `fontSize: 16`
  · `fontSize: 11` 在包着 **checkbox** 的 `<label>` 上 —— 复选框根本不触发 iOS 缩放

三个缺陷：**单位盲**（rem/em 当整数截）、**归属错**（邻近 ≠ 属于）、
**没排除非文本输入**。和 G12 当年在 C# 上误报是同一个形状：
匹配到了字符，但没匹配到语义。

**误报比漏报更危险**：114 条噪音会让人直接把整条规则关掉，
那这条规则就从「有时候错」退化成「完全不存在」。

所以现在只认一种情形：fontSize 写在 input/textarea/select **自己的标签内**。
"""
import re

RULE = "G10"
TITLE = "输入框字号 ≥16px"

# 只认文本类输入。checkbox/radio/button/file/range/color 等不触发 iOS 缩放，
# 给它们的 label 设小字号是完全正当的排版。
NON_TEXT = re.compile(
    r"""type\s*=\s*[\{"']\s*['"]?(checkbox|radio|button|submit|reset|file|
        range|color|image|hidden)""", re.I | re.X)

# 标签起始：<input / <textarea / <select
TAG_START = re.compile(r"<(input|textarea|select)\b", re.I)

# fontSize: 数字 [单位]。单位要一起抓 —— 不抓单位就会把 '0.9rem' 读成 0。
FONT = re.compile(r"fontSize\s*:\s*['\"]?\s*(\d+(?:\.\d+)?)\s*(px|rem|em|%)?", re.I)


def _px(value, unit):
    """折成 px。根字号按浏览器默认 16px 算。

    单位必须参与判断：`'1rem'` 是 16px（合规），`'0.9rem'` 是 14.4px（违规），
    而按整数截取两者都会变成 1 和 0 —— 一个漏报一个误报。
    """
    v = float(value)
    if unit in ("rem", "em"):
        return v * 16
    if unit == "%":
        return v / 100 * 16
    return v                       # px 或无单位


def _tag_text(lines, i):
    """从第 i 行的标签起始处，取到标签闭合（`>` 或 `/>`）为止。

    JSX 的属性常常跨多行，只看一行会漏掉写在下面几行的 fontSize。
    但也【不能无限往下找】——那就退回成「邻近即归属」的老毛病。
    """
    buf, depth = [], 0
    for line in lines[i:i + 12]:            # 一个标签写超过 12 行的极少
        buf.append(line)
        for ch in line:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth = max(0, depth - 1)
        # 花括号平衡时出现 > 才算标签真的闭合（style={{...}} 里的 > 不算）
        if depth == 0 and ">" in line:
            break
    return "\n".join(buf)


def check(ctx):
    # 目标不存在时必须明说。扫 0 个文件却静默通过，等于门禁在这一项上不存在——
    # 这正是 policies 记录过的失败形态（对某种情况静默跳过，看起来一切正常）。
    if not ctx.exists("services/web"):
        yield ("SKIP", "services/web/ 不存在，本规则未生效", "迁入代码后此项才会真正检查")
        return

    for f in ctx.walk(".jsx", ".tsx", ".js", ".ts", under="services/web"):
        lines = ctx.read(f).splitlines()
        for i, line in enumerate(lines):
            if not TAG_START.search(line):
                continue
            tag = _tag_text(lines, i)
            if NON_TEXT.search(tag):
                continue
            m = FONT.search(tag)             # 只看这个标签自己的 style
            if not m:
                continue
            px = _px(m.group(1), (m.group(2) or "").lower())
            if px >= 16:
                continue
            raw = m.group(1) + (m.group(2) or "")
            yield ("ERROR",
                   f"{ctx.rel(f)}:{i+1} 输入框 fontSize={raw}"
                   + (f"（={px:g}px）" if m.group(2) else "") + " < 16px",
                   "iOS Safari 会自动放大整页，布局错位、发送按钮被挤出视口；"
                   "内联 style 覆盖 CSS 类，必须同为 16")
