# -*- coding: utf-8 -*-
"""G18 密钥必须被声明，且声明里不能有真值。

旧系统的问题（spec 004）：`.env` 里混着真密钥和普通配置。
后果不只是不整洁——**配置因此进不了版本库**，
于是「当前生效的配置是什么」失去单一真源，只能上服务器看。

本规则管三件事：
  1. `.env.example` 必须存在——它声明「这个系统需要哪些密钥」。
     没有它，新机器部署时会缺键，而且**不知道缺什么**。
  2. 声明里不能有真值——它是要进版本库的。
  3. 新增服务需要新密钥时必须同步更新声明，
     否则部署到新机器就是「起不来，且不知道为什么」。

密钥泄露本身交给 gitleaks（pre-commit）＋ TruffleHog（CI），
不在这里造轮子——见 policies「什么该外包」。
本规则只管【声明的完整性】，那是现成工具不知道的项目约定。
"""
import os
import re

RULE = "G18"
TITLE = "密钥声明"

EXAMPLE = ".env.example"

# 看起来像真值的形态：足够长、且不是常见占位符
PLACEHOLDER = re.compile(
    r"^\s*$|replace_with|your_|<.*>|xxx+|changeme|placeholder|todo|example",
    re.I)
# 已知的真密钥形态，出现即立刻红
REAL_SECRET = re.compile(r"sk-ant-|ghp_|github_pat_|AKIA[0-9A-Z]{16}|"
                         r"-----BEGIN [A-Z ]*PRIVATE KEY", re.I)


def check(ctx):
    if not ctx.exists(EXAMPLE):
        yield ("ERROR", f"{EXAMPLE} 不存在",
               "它声明系统需要哪些密钥。没有它，新机器部署时会缺键"
               "且不知道缺什么")
        return

    body = ctx.read(EXAMPLE)
    for i, line in enumerate(body.splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        val = val.strip().strip("'\"")

        if REAL_SECRET.search(val):
            yield ("ERROR", f"{EXAMPLE}:{i} {key.strip()} 疑似填了真密钥",
                   "这个文件进版本库。值必须是占位符或留空")
        elif val and not PLACEHOLDER.match(val) and len(val) >= 16:
            yield ("ERROR", f"{EXAMPLE}:{i} {key.strip()} 的值不像占位符"
                            f"（{len(val)} 字符）",
                   "这个文件进版本库。用 replace_with_xxx 之类的占位符，或留空")

    # 真 .env 绝不能被跟踪
    if ctx.git_available():
        tracked = ctx.tracked()
        for f in tracked:
            base = os.path.basename(f)
            if base == ".env" or (base.startswith(".env.") and base != ".env.example"):
                yield ("ERROR", f"真密钥文件进了版本库：{f}",
                       "立刻从索引移除并【轮换所有涉及的密钥】——"
                       "进过版本库的密钥要当成已泄露处理")

    # 服务模板引用的 EnvironmentFile 路径要一致，否则各服务读不同的文件
    paths = set()
    for f in ctx.walk(".service", under="services"):
        for m in re.finditer(r"EnvironmentFile=-?(\S+)", ctx.read(f)):
            paths.add(m.group(1))
    if len(paths) > 1:
        yield ("WARN", f"服务模板引用了 {len(paths)} 个不同的 EnvironmentFile：{paths}",
               "路径不一致时，各服务会读到不同的密钥文件，排查起来极其痛苦")
