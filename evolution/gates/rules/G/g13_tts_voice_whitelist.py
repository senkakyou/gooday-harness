# -*- coding: utf-8 -*-
"""G13 edge-tts 音色必须在探活白名单内。

血泪：三国第 1 回旁白误配 zh-CN-YunxuanNeural（已被微软下线），
64 段里 43 段全部永久返 0 字节。而重试逻辑把「整轮 0 新增」一律当成 IP 限流、
无限长退避——空转近一小时，等一个永远不会来的窗口。

「被限流」和「音色被下线」表现完全一样（都是 NoAudioReceived / 0 字节），
但处理方式相反：限流要等，下线要换。分不清就会死等。
"""
import re

RULE = "G13"
TITLE = "TTS 音色白名单"

# 已探活可用
ALIVE = {
    "zh-CN-YunxiNeural", "zh-CN-YunjianNeural", "zh-CN-YunyangNeural",
    "zh-CN-XiaoxiaoNeural", "zh-CN-XiaoyiNeural", "zh-CN-YunxiaNeural",
}
# 已被微软下线，用了必然全程 0 字节
DEAD = {
    "zh-CN-YunxuanNeural": "云轩",
    "zh-CN-YunyeNeural": "云野",
}

VOICE = re.compile(r"['\"](zh-[A-Z]{2}-\w+Neural)['\"]")


def check(ctx):
    # 不能只扫 workflows/：音色常量一旦抽进 packages/ 或 services/ 就漏检。
    # 但要排除规范与门禁自身——本规则的黑名单里就写着那两个死音色名，
    # 不排除的话它会扫到自己然后报警（今晚第二次踩自指陷阱：
    # 密钥扫描曾把检测器自己的正则当成命中）。
    SELF = ("evolution/gates/", "policies/", "docs/")
    for f in ctx.walk(".py"):
        if ctx.rel(f).replace("\\", "/").startswith(SELF):
            continue
        for i, line in enumerate(ctx.read(f).splitlines(), 1):
            for v in VOICE.findall(line):
                if v in DEAD:
                    yield ("ERROR",
                           f"{ctx.rel(f)}:{i} 使用已下线音色 {v}（{DEAD[v]}）",
                           "该音色永久返 0 字节，等窗口永远等不到——换成白名单里的")
                elif v not in ALIVE:
                    yield ("WARN", f"{ctx.rel(f)}:{i} 音色 {v} 不在探活白名单内",
                           "配音色前先探活：Communicate('探活',voice).save(f) 看 size>0，"
                           "确认可用后加进本规则的 ALIVE")
