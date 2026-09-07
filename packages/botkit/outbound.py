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
         retries=RETRIES):
    """发一条消息。返回 (ok, err)。

    token_provider(force_refresh: bool) -> str
    401 时用 force_refresh=True 再要一次——TokenVersion 变更后能自愈。
    """
    if not allowed(sender_id, receiver_id):
        # 【拦下来还要喊一声】。静默拦截等于给攻击者一个安静的探测通道，
        # 也让正当的配置错误变得极难排查。
        print(f"[{tag}] ⛔ 出口白名单拦截：{sender_id} → {receiver_id}", flush=True)
        return False, "出口白名单不允许"

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
            else:
                print(f"[{tag}] 发送 HTTP {e.code}（第 {attempt} 次）", flush=True)
        except Exception as e:
            print(f"[{tag}] 发送异常 {e}（第 {attempt} 次）", flush=True)
        if attempt < retries:
            time.sleep(RETRY_GAP)

    print(f"[{tag}] ⚠️ 发送最终失败 → {receiver_id}", flush=True)
    return False, f"重试 {retries} 次仍失败"


def send_segments(sender_id, receiver_id, segments, **kw):
    """分段发送。单段失败【不 break】，继续发后续段并在最后说明。"""
    failed = []
    for i, seg in enumerate(segments, 1):
        ok, _ = send(sender_id, receiver_id, seg, **kw)
        if not ok:
            failed.append(i)
    if failed:
        send(sender_id, receiver_id,
             f"⚠️ 第 {'、'.join(map(str, failed))}/{len(segments)} 段发送失败，"
             f"内容可能不完整", **kw)
    return not failed
