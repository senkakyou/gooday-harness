# -*- coding: utf-8 -*-
"""G21 客户端与服务端的限值必须对齐。

真实事故（2026-09-08）：灵犀写了一份长评审要回给站长，服务端
`PrivateMessageController` 判 `content.Length > 4000` 直接 400，
而客户端 `packages/botkit/outbound.py` **根本不知道有这个上限**——
它把 400 当可重试错误重试 3 次，三次必然失败，然后整份评审消失。

日志里只有三行一模一样的 `发送 HTTP 400`，**真因一个字都没打印**。

这条规则查的是：**客户端有没有声明这个上限，且和服务端的数一致。**
一致性没法靠人记得——服务端改 4000 为别的数时，没有任何东西会提醒客户端。

不查「有没有调用 split()」：那要做调用图分析，用 grep 做只会误判。
查限值对齐是**能被机械判定**的那部分，剩下的靠 outbound.send 的 4xx 早退兜底。
"""
import re

RULE = "G21"
TITLE = "客户端与服务端限值对齐"

SERVER = "services/api/src/Controllers/PrivateMessageController.cs"
CLIENT = "packages/botkit/outbound.py"

# 服务端形如：content.Length > 4000
SERVER_PAT = re.compile(r"[Cc]ontent\.Length\s*>\s*(\d+)")
# 客户端形如：MAX_CONTENT = 4000
CLIENT_PAT = re.compile(r"^MAX_CONTENT\s*=\s*(\d+)", re.M)


def check(ctx):
    if not ctx.exists(SERVER):
        yield ("SKIP", f"{SERVER} 不存在，没有可对齐的服务端限值", "")
        return
    if not ctx.exists(CLIENT):
        yield ("SKIP", f"{CLIENT} 不存在，没有客户端要对齐", "")
        return

    m = SERVER_PAT.search(ctx.read(SERVER))
    if not m:
        # 【查不成要报 ERROR，不能 SKIP】——见 policies 元规则。
        # 服务端改了写法而本规则没跟上时，静默放行等于这条规范消失。
        yield ("ERROR", f"{SERVER} 里找不到 content.Length 上限判定",
               "要么服务端换了写法（本规则要跟着改），要么上限被删了。"
               "无论哪种，都不能当成「对齐了」放行")
        return
    server_limit = int(m.group(1))

    c = CLIENT_PAT.search(ctx.read(CLIENT))
    if not c:
        yield ("ERROR", f"{CLIENT} 没有声明 MAX_CONTENT",
               f"服务端上限是 {server_limit} 字，客户端不知道 —— "
               "超长内容会拿到 400 然后整条丢失（2026-09-08 丢过一份评审）")
        return
    client_limit = int(c.group(1))

    if client_limit != server_limit:
        yield ("ERROR",
               f"限值不一致：服务端 {server_limit}，{CLIENT} 写的是 {client_limit}",
               "客户端比服务端大 = 超长内容仍会被丢；比服务端小 = 白白多切段。"
               "改服务端时必须同步改这里")
