# -*- coding: utf-8 -*-
"""G08 部署必须验证生效，不能只验证写入。

换来这条的发现（2026-09-07）：install.sh 往 /etc/nginx/conf.d/ 写配置，
`install` 命令返回 0、脚本打印成功——但这台机器【宿主机根本没装 nginx】
（systemctl 显示 inactive），nginx 跑在容器里、配置来自 bind mount。
于是配置写进去了、脚本全绿、实际零效果。

**比冲突更难发现**：冲突至少会报错，而"写到一个没人读的位置"什么都不报。

同一形态在本项目反复出现：
  · drop-in 装上了但安装脚本没记 —— 重装即丢，全绿
  · 凭据失效 —— 心跳、systemd、服务列表全绿，三周无人发现
  · 注入条款写进文档三个月 —— 没进任何 prompt，没人能发现

通则：**「我把东西放到了那里」不等于「那里的东西起作用了」。**
部署的每一类动作，都必须有一个能证明它生效的检查跟在后面。
"""
import re

RULE = "G08"
TITLE = "部署验证生效"

INSTALL = "ops/install.sh"

# 部署动作 -> 能证明它生效的验证手段（任一命中即算有验证）
NEEDS_PROOF = {
    "systemd 单元": (
        r"\$SD/|/etc/systemd/system",
        [r"systemctl\s+daemon-reload", r"systemctl\s+(is-active|restart|enable)"],
    ),
    "crontab": (
        r"\bcrontab\s+[\"']?\$",
        [r"crontab\s+-l"],
    ),
    "nginx 配置": (
        r"nginx",
        [r"nginx\s+-t", r"没有任何 nginx 在读", r"不生效"],
    ),
}


def check(ctx):
    src = ctx.read(INSTALL)
    if not src:
        yield ("ERROR", f"{INSTALL} 不存在", "没有安装入口，无从谈验证")
        return

    for what, (action_pat, proofs) in NEEDS_PROOF.items():
        if not re.search(action_pat, src):
            continue                      # 本项目没做这类部署，不要求
        if not any(re.search(p, src) for p in proofs):
            yield ("ERROR", f"{INSTALL} 部署了{what}，但没有任何验证它生效的步骤",
                   "写入成功 ≠ 生效。加一个能证明它起作用的检查，"
                   "或明确打印「当前不生效」——最怕的是全绿而实际没用")

    # 不许在没验证的情况下宣布成功：出现「✅」就必须有配套的验证命令
    if "✅" in src and not re.search(r"nginx\s+-t|systemctl|crontab\s+-l|\[\[\s+-f", src):
        yield ("WARN", f"{INSTALL} 打印了成功标记但看不到验证动作",
               "成功标记要跟在验证后面，否则它只是在报告「我执行了」")

    # 收尾提示里必须给出人工复验清单——自动验证覆盖不到的部分要交代
    if not re.search(r"必须|期望|确认", src):
        yield ("WARN", f"{INSTALL} 没有收尾复验提示",
               "自动验证盖不住的部分（如 cron 要等一个周期才知道是否真跑），"
               "必须写清楚让人去验什么")
