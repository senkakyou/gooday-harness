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
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _srclib import code_only                                        # noqa: E402

RULE = "G21"
TITLE = "客户端与服务端限值对齐"

SERVER = "services/api/src/Controllers/PrivateMessageController.cs"
CLIENT = "packages/botkit/outbound.py"

# 服务端形如：content.Length > 4000
SERVER_PAT = re.compile(r"[Cc]ontent\.Length\s*>\s*(\d+)")
# 客户端形如：MAX_CONTENT = 4000
CLIENT_PAT = re.compile(r"^MAX_CONTENT\s*=\s*(\d+)", re.M)

# 谁在往 /api/messages/ POST。这是本规则的【作用域】——
# 第一版只盯 packages/botkit/outbound.py 一个文件，而实际有四处在直发：
# daily-report / finance-report / coo-patrol 各自手搓了发送函数，
# 全都不认识 4000 这个数，产的还都是长文本（日报、财报、巡检报告）。
# 吃掉那份评审的 bug 在三个地方原样活着，而规则报绿。
# 【窟窿不在调用图，在作用域】——2026-09-08 灵犀评审指出。
# 谁在产生一条私信。两条路都要认：
#   · 走接口   POST /api/messages/...
#   · 【绕开接口直接写库】 INSERT INTO PrivateMessages —— dev-requests 就是这么干的，
#     它连服务端那道 4000 判定都碰不到，G21 第一版完全看不见它。
SENDER_PAT = re.compile(r"/api/messages/|INSERT\s+INTO\s+PrivateMessages", re.I)
SCAN_DIRS = ("packages", "workflows", "services")
# 认可的兜底方式：自己声明上限，或者复用 botkit 的分段能力。
#
# 【故意不认「import 了 outbound」这么松的形态】：coo-patrol 就 import 了它，
# 却只借 allowed() 做白名单，split() 的坑照踩 —— **半个能力不算兜底**。
# 必须点名用到 split / send_each / MAX_CONTENT 之一才算数。
BORROWS_PAT = re.compile(
    r"\bMAX_CONTENT\b"
    r"|\b(?:outbound|_ob)\.(?:split|send_each|send_segments)\b"
    r"|\bfrom\s+outbound\s+import\b[^\n]*\b(?:split|send_each|send_segments)\b")


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

    # ── 作用域检查：每一个往 /api/messages/ POST 的文件都要认识这个上限 ──
    for path in _py_files(ctx):
        # 【剥注释再判】。本轮最刺眼的一处：g04/g17 都堵了这个洞，
        # 唯独当事人 g21 自己在用原始文本 —— 于是
        #     # TODO: 之后复用 outbound 的 MAX_CONTENT，先这样
        # 这么一行注释就能让本规则报绿，而 bug 原样在。
        # 【只剥注释，不剥字符串】：`/api/messages/` 恰恰长在 f-string 里，
        # 剥了字符串本规则就永远发现不了发送方——那是更糟的假绿。
        src = code_only(ctx.read(path))
        if not SENDER_PAT.search(src):
            continue
        if BORROWS_PAT.search(src):
            continue
        how = ("直接写 PrivateMessages 表" if "INSERT" in src.upper()
               else "直发 /api/messages/")
        yield ("ERROR", f"{path} {how}，但不认识 {server_limit} 字上限",
               f"超过 {server_limit} 字的内容会被服务端判 400 整条丢掉。"
               "复用 packages/botkit/outbound 的 MAX_CONTENT 与 split()，"
               "别在这里复制第二份数字")

    # 前端输入框也在作用域里 —— 上一版只扫 .py，作用域窄在【语言维度】上
    # （2026-09-08 灵犀第三轮指出）。
    for item in check_frontend(ctx, server_limit):
        yield item


HUB = "services/api/src/Hubs/ChatHub.cs"
WEB = "services/web/src"
MAXLEN_PAT = re.compile(r"maxLength=\{(\d+)\}")


def check_frontend(ctx, rest_limit):
    """前端输入框的 maxLength 也要对齐它【真正说话的那个端点】。

    2026-09-08 灵犀第三轮指出前端不在作用域里，属实——但她的结论要改一处：
    她说「同一个服务端上限现在有 1000/500/4000 三个数」。实测不是：

      · `ChatBox.jsx` 走的是 **SignalR**（`ChatHub.SendMessage`），
        而 `ChatHub.cs:40` 自己判 `content.Length > 500` ——
        它的 `maxLength={500}` **是对齐的，不是第三个数**。
      · 真正没对齐的只有 `Messages.jsx`：私信走 REST，服务端 4000，它写 1000。

    所以判据必须按【端点】分，不能按「有几个数字」分。
    识别方式是文件里 import 了谁：`api/messages` → REST；`signalr` → Hub。

    【已知盲点，写下来不假装没有】（灵犀 2026-09-08 第四轮指出）：
    靠 import 认端点，就依赖 import 存在。裸 `fetch('/api/messages')`、
    axios 直连、或者把发送封装进一个没有可识别 import 的组件，都会被漏判。
    所以下面额外认一条兜底：文件里直接出现 `/api/messages` 字面量也算 REST。
    再绕过去的写法本规则确实看不见 —— 这是按 import 分类的代价，
    比按数字分准，但不是没有代价。
    """
    import os
    root = ctx.path(WEB)
    if not os.path.isdir(root):
        return
    hub_limit = None
    if ctx.exists(HUB):
        m = SERVER_PAT.search(ctx.read(HUB))
        if m:
            hub_limit = int(m.group(1))

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [x for x in dirnames if x != "node_modules"]
        for fn in filenames:
            if not fn.endswith((".jsx", ".js")):
                continue
            rel = os.path.relpath(os.path.join(dirpath, fn), ctx.path("."))
            src = ctx.read(rel)
            # 只看「消息输入框」那一类：maxLength 小于 100 的是昵称、验证码之类
            limits = [int(x) for x in MAXLEN_PAT.findall(src) if int(x) >= 100]
            if not limits:
                continue
            if "api/messages" in src or "/api/messages" in src:
                who, cap = "私信 REST 接口", rest_limit
            elif "signalr" in src.lower():
                if hub_limit is None:
                    continue
                who, cap = "ChatHub", hub_limit
            else:
                continue
            for n in limits:
                if n > cap:
                    yield ("ERROR", f"{rel} 的 maxLength={n} 超过{who}上限 {cap}",
                           "前端放行、服务端拒收 —— 用户打完了才发现发不出去")
                elif n < cap:
                    yield ("WARN", f"{rel} 的 maxLength={n} 严于{who}上限 {cap}",
                           "不丢消息，但用户打到上限就静默打不动：没提示、没字数计数。"
                           "要么对齐，要么给个可见的计数器")


def _py_files(ctx):
    import os
    for d in SCAN_DIRS:
        root = ctx.path(d)
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [x for x in dirnames
                           if x not in ("node_modules", "__pycache__", "obj", "bin")]
            for fn in filenames:
                if fn.endswith(".py"):
                    yield os.path.relpath(os.path.join(dirpath, fn), ctx.path("."))
