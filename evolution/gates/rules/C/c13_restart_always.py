# -*- coding: utf-8 -*-
"""C13 systemd 必须 Restart=always，且崩溃保护要放对段。

on-failure 时脚本「正常」退出（return 0）会让服务静静躺平——
不重启、也不告警。配套：脚本致命错误必须 sys.exit(1)。

另查 StartLimitIntervalSec/Burst 的段位：它们属于 [Unit]，
写进 [Service] 时 systemd 直接忽略并只留一句 warning——
崩溃保护看起来配了，实际没生效（2026-09-07 实测踩到）。

来源：ai-company-kit。接入决策见 docs/specs/005-policy-layers.md。
"""
import re

RULE = "C13"
TITLE = "systemd 重启策略"


def check(ctx):
    units = list(ctx.walk(".service", under="services"))
    if not units:
        yield ("SKIP", "services/ 下暂无 unit 模板", "")
        return
    for u in units:
        body = ctx.read(u)
        rel = ctx.rel(u)
        if not re.search(r"^\s*Restart\s*=\s*always", body, re.M):
            yield ("ERROR", f"{rel} 不是 Restart=always",
                   "on-failure 时脚本 return 0 退出会让服务静静躺平，不重启也不告警")
        # StartLimit* 必须在 [Unit] 段
        for key in ("StartLimitIntervalSec", "StartLimitBurst"):
            # 【必须查全部出现，不能只看第一处】。两个段里都写了时，
            # re.search 会在 [Unit] 里那处通过，而 [Service] 里那处照样被
            # systemd 忽略——2026-09-07 测试本规则时发现的假阴性。
            for m in re.finditer(rf"^\s*{key}\s*=", body, re.M):
                secs = re.findall(r"^\[(\w+)\]", body[:m.start()], re.M)
                if secs and secs[-1] != "Unit":
                    line_no = body[:m.start()].count("\n") + 1
                    yield ("ERROR",
                           f"{rel}:{line_no} {key} 写在 [{secs[-1]}] 段",
                           "它属于 [Unit]。放错段时 systemd 直接忽略，"
                           "崩溃保护看起来配了但实际没生效")
