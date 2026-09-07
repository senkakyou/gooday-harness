# -*- coding: utf-8 -*-
"""C18 每个调模型的服务，prompt 必须带注入防御条款；且不得写死敏感路径。

2026-09-07 迁移时逐个查过旧版：**五个 bot 的 prompt 里注入防御条款
全部是 0 处**。防御文档在 docs/ 里躺了三个月，没进任何一个 bot。

最危险的是灵犀：它有 Bash 和文件读写，注入成功等于攻击者拿到 shell。
而它的 prompt 里还硬编码了 16 处敏感路径——数据库绝对位置、.env 在哪、
JWT_SECRET 在哪。对一个有 Bash 的角色，那等于把攻击面写进它自己的提示词。

本规则查两件事：
  1. 有 prompt.md 的服务，必须含防御条款（认哨兵串，不认裸的「注入」二字——
     代码里的「注入上下文」是完全无关的意思，用它当判据会全部误判通过）
  2. prompt.md 里不得出现具体的敏感路径
"""
import os
import re

RULE = "C18"
TITLE = "prompt 注入防御"

SENTINELS = (r"安全与边界", r"提示词注入", r"prompt[\s_-]*injection")

# 不该出现在 prompt 里的东西：它们属于配置，写进 prompt 既不能随环境变化，
# 又等于把攻击面告诉读到它的人
SECRET_PATHS = re.compile(
    r"/var/lib/docker/volumes|/opt/[\w-]+/\.env|JWT_SECRET|"
    r"\.credentials\.json|/etc/systemd/system")


def check(ctx):
    names = [n for n in ctx.subdirs("services") if not n.startswith("_")]
    if not names:
        yield ("SKIP", "services/ 下暂无成员", "")
        return

    for name in names:
        p = os.path.join("services", name, "prompt.md")
        if not ctx.exists(p):
            continue          # 不调模型的服务（如 dispatcher）没有 prompt
        body = ctx.read(p)

        if not any(re.search(s, body, re.I) for s in SENTINELS):
            yield ("ERROR", f"{p} 缺注入防御条款",
                   "保留「安全与边界」这个标题（它是本规则的哨兵）。"
                   "别用裸的「注入」二字当判据——代码里的「注入上下文」是"
                   "完全无关的意思，会让毫无防御的 prompt 误判通过")

        for m in SECRET_PATHS.finditer(body):
            line = body[:m.start()].count("\n") + 1
            yield ("ERROR", f"{p}:{line} prompt 里写死了敏感路径「{m.group(0)}」",
                   "那属于配置，放 config.json。写进 prompt 既不能随环境变化，"
                   "又等于把攻击面告诉读到它的人——对有 Bash 权限的角色尤其致命")
