#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对外发送：白名单 ＋ 重试 ＋ 401 自愈。

三条铁律，每条都对应一次真实事故：

1. **出口白名单**
   bot 能给谁发消息是白名单制。没有它，一个 prompt 注入就能让内部 bot
   把内部信息发给任意外部用户——攻击者只需要注册一个普通账号。

2. **发送必须带重试，401 强刷 token**
   token 版本变更后、定时刷新前，最长 30 分钟内所有发送静默失败。
   对外表现是 bot「不回复」，而日志里一切正常。

3. **分段发送单段失败不许 break**
   要继续发后续段，最后补一条「第 x/y 段失败」。
   否则用户看到的是半截话，还以为说完了。
"""
import json
import os
import time
import urllib.error
import urllib.request

API_BASE = os.environ.get("HARNESS_API_BASE", "https://localhost")

RETRIES = 3
RETRY_GAP = 2

# 服务端 PrivateMessageController 的硬上限：content.Length > 4000 → 400。
# 这个数必须和服务端一致；不一致时长回复会被整条丢掉（2026-09-08 真丢过一份评审）。
MAX_CONTENT = 4000


def ulen(s):
    """按 **UTF-16 码元**数长度 —— 服务端 `string.Length` 数的就是这个。

    Python 的 `len()` 数的是码点，两者对 BMP 外字符（emoji、部分生僻字）差一倍：
    `len("🔴") == 1`，而 C# 里 `"🔴".Length == 2`。

    第一版拿 `len()` 当上限判据，还在文档里写「靠分段前缀预留的 16 字余量兜着」。
    **那个推理是错的**（2026-09-08 灵犀第三轮指出）：误差不是有上界的常数，
    是跟段内 astral 字符**线性相关**——一段里 17 个 🔴 就破。
    而日报的优先级标恰好在用 🔴🟠⚪🔵，**全是 astral**。

    更阴的是破的时候的样子：`send` 里那句「内容 N 字超过上限」用同一个 `len()` 判，
    恰好判为假 → 不分段、不打印、直接吃 400。**真因又一次不进日志。**
    """
    return len(s.encode("utf-16-le")) // 2

# 角色 -> 允许发给谁。"*" = 任意（只该给唯一对外窗口）
# 这张表是【结构性防线】：即使 bot 被注入说服了，它也发不出去。
OUTBOUND_WHITELIST = {}


def configure(whitelist, api_base=None):
    """由各 bot 在启动时注入自己的白名单。"""
    global OUTBOUND_WHITELIST, API_BASE
    OUTBOUND_WHITELIST = whitelist or {}
    if api_base:
        API_BASE = api_base


def allowed(sender_id, receiver_id):
    """能不能发。白名单里没写 = 不能发（默认拒绝，不是默认允许）。"""
    rule = OUTBOUND_WHITELIST.get(sender_id)
    if rule is None:
        return False
    if rule == "*":
        return True
    return receiver_id in rule


def send(sender_id, receiver_id, content, *, token_provider, tag="bot",
         retries=RETRIES, _presplit=False):
    """发一条消息。**超过 MAX_CONTENT 时自动分段**，调用方不需要知道上限。

    token_provider(force_refresh: bool) -> str
    401 时用 force_refresh=True 再要一次——TokenVersion 变更后能自愈。

    为什么保证放在这里，而不是"要求调用方记得调 split()"：
    2026-09-08 丢那份评审时，`send_segments` 就在下面几十行，
    只是没有任何人调用它。**正确的用法必须是最省事的用法**——
    要求人记得的结构，就是在等下一次有人忘。
    `_presplit` 只给 send_segments 用，防止「切完的段再进来又切一次」的递归。
    """
    if not allowed(sender_id, receiver_id):
        # 【拦下来还要喊一声】。静默拦截等于给攻击者一个安静的探测通道，
        # 也让正当的配置错误变得极难排查。
        print(f"[{tag}] ⛔ 出口白名单拦截：{sender_id} → {receiver_id}", flush=True)
        return False, "出口白名单不允许"

    if not _presplit and ulen(content) > MAX_CONTENT:
        segs = split(content)
        print(f"[{tag}] 内容 {ulen(content)} 码元超过上限 {MAX_CONTENT}，"
              f"自动分 {len(segs)} 段发送", flush=True)
        ok = send_segments(sender_id, receiver_id, segs,
                           token_provider=token_provider, tag=tag, retries=retries)
        return ok, "" if ok else "分段发送有失败段"

    data = json.dumps({"content": content}).encode()
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                f"{API_BASE}/api/messages/{receiver_id}", data=data,
                headers={"Content-Type": "application/json",
                         "Authorization": f"Bearer {token_provider(False)}"},
                method="POST")
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE      # 本机自签，仅限 localhost
            with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
                if r.status < 300:
                    return True, ""
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print(f"[{tag}] 401，强刷 token 重试（第 {attempt} 次）", flush=True)
                token_provider(True)
            elif 400 <= e.code < 500:
                # 【4xx 不重试】（401 除外，那是能自愈的）。
                # 请求本身就是坏的，重试三次是三次必然失败，
                # 而日志里三行一模一样的报错会让人以为是网络抖动。
                # 2026-09-08：4000 字上限的 400 被这样重试了三次，
                # 真因（内容超长）一个字都没打印出来。
                body = ""
                try:
                    body = e.read()[:200].decode(errors="replace")
                except Exception:
                    pass
                print(f"[{tag}] ⛔ 发送 HTTP {e.code}，请求本身有问题，不重试：{body}",
                      flush=True)
                if ulen(content) > MAX_CONTENT:
                    print(f"[{tag}]    内容 {ulen(content)} 码元（{len(content)} 字），超过上限 "
                          f"{MAX_CONTENT} —— 该走 split()/send_segments()", flush=True)
                return False, f"HTTP {e.code}: {body}"
            else:
                print(f"[{tag}] 发送 HTTP {e.code}（第 {attempt} 次）", flush=True)
        except Exception as e:
            print(f"[{tag}] 发送异常 {e}（第 {attempt} 次）", flush=True)
        if attempt < retries:
            time.sleep(RETRY_GAP)

    print(f"[{tag}] ⚠️ 发送最终失败 → {receiver_id}", flush=True)
    return False, f"重试 {retries} 次仍失败"


def split(content, limit=MAX_CONTENT):
    """把长文切成 ≤limit 的段。优先在空行切，其次换行，最后才硬切。

    2026-09-08 换来这个函数的事故：灵犀写了一份长评审回给站长，
    API 返回 400「消息内容无效」（`content.Length > 4000` 判掉），
    `send` 又把它当可重试错误重试了 3 次 —— 三次都必然失败。
    结果是**整份评审彻底消失**，日志里只有三行 `发送 HTTP 400`。

    `send_segments` 当时就存在，但【没有任何人调用它】：
    runner 直接把整段回复塞给 send。又一个「能力写好了但没接上」。
    """
    if ulen(content) <= limit:
        return [content]
    # 留出「（i/n）\n」前缀的位置。不留就会切出恰好等于上限的段，
    # 加上前缀后又超一点点 —— 那种差几个字符的 400 最难查。
    limit -= 16
    segs, rest = [], content
    while ulen(rest) > limit:
        # 【按码元定窗口，不按码点】。码元数 ≥ 码点数，所以 limit 是安全上界，
        # 再往回收到真正放得下为止 —— 一段里全是 emoji 时窗口会收掉将近一半。
        i = min(len(rest), limit)
        while i > 1 and ulen(rest[:i]) > limit:
            i -= max(1, (ulen(rest[:i]) - limit) // 2)
        window = rest[:i]
        # 找最靠后的安全切点：空行 > 换行 > 硬切
        cut = window.rfind("\n\n")
        if cut < i // 2:
            cut = window.rfind("\n")
        if cut < i // 2:
            cut = i
        segs.append(rest[:cut].rstrip())
        rest = rest[cut:].lstrip("\n")
    if rest:
        segs.append(rest)
    n = len(segs)
    return [f"（{i}/{n}）\n{s}" if n > 1 else s for i, s in enumerate(segs, 1)]


def send_each(content, send_one, tag="bot"):
    """按上限分段 ＋ 逐段发 ＋ **失败补报**，把这三件事只写一次。

    `send_one(text) -> bool` 由调用方给：谁有 token、走哪条路，各家不同，
    但「怎么分段、失败了怎么说」必须只有一份（G03）。

    2026-09-08 灵犀评审指出：三条铁律里的第 3 条——「单段失败不 break，
    **最后补一条『第 x/y 段失败』**」——在 daily-report / finance-report /
    coo-patrol 三处全都只做到一半：它们自己搓了循环，失败只体现在返回值里，
    **收件人那边看到的还是半截话，而且不知道是半截。**
    coo-patrol 更松，只返回最后一段的结果，前面段失败调用方完全看不见。

    「借了 split() 没借 send_segments()」还是半个能力。这个函数就是那另一半。
    """
    segs = split(content) if ulen(content) > MAX_CONTENT else [content]
    if len(segs) > 1:
        print(f"[{tag}] 内容 {ulen(content)} 码元超过上限 {MAX_CONTENT}，"
              f"分 {len(segs)} 段发送", flush=True)
    return run_segments(segs, send_one, tag=tag)


def run_segments(segments, send_one, tag="bot"):
    """逐段发 ＋ 失败补报。**补报文案只有这一处**。

    2026-09-08 灵犀第三轮指出：`send_each` 和 `send_segments` 各写了一遍补报，
    措辞还不一样（「内容不完整」vs「内容可能不完整」）——
    我刚引用完 G03 单一真源，转手就造了第二份。现在两边都走这里。
    """
    failed = []
    for i, seg in enumerate(segments, 1):
        try:
            ok = bool(send_one(seg))
        except Exception as e:
            print(f"[{tag}] 第 {i}/{len(segments)} 段异常：{e}", flush=True)
            ok = False
        if not ok:
            failed.append(i)
    if failed:
        # 【补报也要发出去】。不发的话收件人看到的是一段完整的话，
        # 完全不知道后面还有——比明说「缺了几段」危险得多。
        note = (f"⚠️ 第 {'、'.join(map(str, failed))}/{len(segments)} 段发送失败，"
                f"内容不完整")
        print(f"[{tag}] {note}", flush=True)
        try:
            send_one(note)
        except Exception:
            pass
    return not failed


def send_segments(sender_id, receiver_id, segments, **kw):
    """分段发送。单段失败【不 break】，继续发后续段并在最后说明。

    段已经切好了（由 send 内部或调用方切），所以这里不再切一次。
    循环与补报都走 run_segments —— 补报文案只该有一处（G03）。
    """
    tag = kw.get("tag", "bot")
    return run_segments(
        segments,
        lambda seg: send(sender_id, receiver_id, seg, _presplit=True, **kw)[0],
        tag=tag)
