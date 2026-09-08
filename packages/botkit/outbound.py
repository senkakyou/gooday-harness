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

    if not _presplit and len(content) > MAX_CONTENT:
        segs = split(content)
        print(f"[{tag}] 内容 {len(content)} 字超过上限 {MAX_CONTENT}，"
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
                if len(content) > MAX_CONTENT:
                    print(f"[{tag}]    内容 {len(content)} 字，超过上限 "
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
    if len(content) <= limit:
        return [content]
    # 留出「（i/n）\n」前缀的位置。不留就会切出恰好等于上限的段，
    # 加上前缀后又超一点点 —— 那种差几个字符的 400 最难查。
    limit -= 16
    segs, rest = [], content
    while len(rest) > limit:
        window = rest[:limit]
        # 找最靠后的安全切点：空行 > 换行 > 硬切
        cut = window.rfind("\n\n")
        if cut < limit // 2:
            cut = window.rfind("\n")
        if cut < limit // 2:
            cut = limit
        segs.append(rest[:cut].rstrip())
        rest = rest[cut:].lstrip("\n")
    if rest:
        segs.append(rest)
    n = len(segs)
    return [f"（{i}/{n}）\n{s}" if n > 1 else s for i, s in enumerate(segs, 1)]


def send_segments(sender_id, receiver_id, segments, **kw):
    """分段发送。单段失败【不 break】，继续发后续段并在最后说明。"""
    failed = []
    for i, seg in enumerate(segments, 1):
        ok, _ = send(sender_id, receiver_id, seg, _presplit=True, **kw)
        if not ok:
            failed.append(i)
    if failed:
        send(sender_id, receiver_id,
             f"⚠️ 第 {'、'.join(map(str, failed))}/{len(segments)} 段发送失败，"
             f"内容可能不完整", _presplit=True, **kw)
    return not failed
