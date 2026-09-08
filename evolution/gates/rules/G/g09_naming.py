# -*- coding: utf-8 -*-
"""G09 文件与目录命名规则。

命名不统一的代价不是"不好看"，是**工具会骗你**：

2026-09-07 真实教训：`git diff --cached --name-only` 默认把非 ASCII 文件名
转义成 `"docs/\\345\\267\\245..."`。我拿它和 `find` 的输出做 comm 比对，
中文文件名全部对不上，**差点判定「整个 docs 目录丢了」**——实际一个都没丢。
文件名是给工具读的，不只是给人读的。

核心两条：**路径全 ASCII**、**同类东西同一形态**。
中文放进文件内容里，不放进文件名。
"""
import os
import re

# 全 ASCII 规则的豁免：**只给创作源，不给代码和配置**。
#
# content/ 装的是稿件（AGENTS.md 里与 docs/ 并列的独立类别）。
# 稿件的文件名【本身就是作品的一部分】——「序寂·六卷全本.txt」、
# 「投稿短篇.docx」是要交出去的东西，改成拼音等于改了作者的命名。
#
# 【豁免的前提是工具链真的扛得住，不是"算了不查了"】。2026-09-08 加序寂素材时
# 当场验证过两件事，验完才敢加这条：
#   · check.py 的 tracked() 用 -c core.quotepath=false，12 个中文路径全部能按名打开
#   · g20 的 --fix 独立入口【当时崩了】—— 它自己拼 git ls-files 没带 quotepath，
#     正是 G09 这条教训记录的同一个坑。修好之后才继续。
# 换句话说：豁免的代价是「工具必须处理它」，而不是「问题不存在」。
ASCII_EXEMPT = ("content/",)

RULE = "G09"
TITLE = "命名规则"

# 目录前缀 -> (文件名正则, 该叫什么样)
RULES = {
    "evolution/gates/rules/": (
        re.compile(r"^[hcg]\d{2}_[a-z0-9_]+\.py$"),
        "<层小写><两位数>_snake_case.py，如 g08_deploy_verified.py"),
    "docs/specs/": (
        re.compile(r"^\d{3}-[a-z0-9-]+\.md$"),
        "NNN-kebab-case.md（三位编号，不复用）"),
    "docs/decisions/": (
        re.compile(r"^\d{3}-[a-z0-9-]+\.md$"),
        "NNN-kebab-case.md（三位编号，不复用）"),
    "docs/incidents/": (
        re.compile(r"^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$"),
        "YYYY-MM-DD-kebab-case.md"),
}

# 扩展点成员目录：kebab-case 小写。下划线开头的是模板/内部件，不算成员。
MEMBER_POINTS = ("services", "workflows", "packages",
                 "evolution/evaluators", "evolution/experiments",
                 "evolution/loops")
KEBAB = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

# 固定名与占位，不参与形态检查
EXEMPT = {"README.md", "_template.md", ".gitkeep", "__init__.py"}


def check(ctx):
    go, level, why = ctx.git_verdict()
    if not go:
        # 四态裁决：no_repo→SKIP（本来就没版本库），
        # no_git/failed→ERROR（检查本该跑却没跑成，绝不能当成没问题）
        yield (level, why, "")
        return
    tracked = ctx.tracked()

    # 1) 路径必须全 ASCII
    for f in tracked:
        try:
            f.encode("ascii")
        except UnicodeEncodeError:
            if f.startswith(ASCII_EXEMPT):
                continue
            yield ("ERROR", f"路径含非 ASCII 字符：{f}",
                   "git 会转义成 \\xxx 八进制，与 find/ls 输出对不上，"
                   "比对脚本会得出错误结论。中文写进内容，不写进文件名")

    # 2) 受管目录下的文件名形态
    for f in tracked:
        base = os.path.basename(f)
        if base in EXEMPT:
            continue
        # `_` 开头 = 模板 / 内部件，不是受管对象（G09 表里就是这么写的）。
        # 原来漏了这一条：`rules/_srclib.py`（规则共用库，load_rules 明确跳过
        # `_` 开头的文件）被要求叫 `<层><NN>_xxx.py` —— 而它根本不是一条规则。
        # 2026-09-08 撞到：文件未跟踪时不报，一提交就报，症状还带延迟。
        if base.startswith("_"):
            continue
        for prefix, (pat, howto) in RULES.items():
            if f.startswith(prefix) and "/" not in f[len(prefix):]:
                if not pat.match(base):
                    yield ("ERROR", f"命名不合规：{f}", f"应为 {howto}")
                break

    # 3) 扩展点成员目录必须 kebab-case
    for point in MEMBER_POINTS:
        for name in ctx.subdirs(point):
            if name.startswith("_"):
                continue
            if not KEBAB.match(name):
                yield ("ERROR", f"{point}/{name} 目录名不合规",
                       "扩展点成员用 kebab-case 小写，如 bot-lingxi、audiobook")
