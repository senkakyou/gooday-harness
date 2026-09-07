#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""收件处理：合并 ＋ 幂等认领 ＋ 失败必回执。

三条铁律：

1. **同一发送者的多条消息合并成一次模型调用**
   逐条处理会让用户排队等 N × 数分钟，体感等同死机。

2. **per-sender try/except，失败必给回执**
   历史上 8 次超时异常全部表现为「发消息没人理」——用户完全不知道
   发生了什么。标完已读就静默吞掉是最坏的处理方式：
   消息没了、人没收到、日志里也看不出。

3. **幂等认领**
   处理到一半被 kill 时，重启后要能知道「这批消息我正在处理」，
   而不是从头再来（重复回复）或直接丢掉（永远不回）。
"""
import json
import os
import time

STATE = os.environ.get("GOODAY_HARNESS_STATE", "/var/lib/gooday-harness")


def _pending_path(bot):
    return os.path.join(STATE, "state", bot, "pending.json")


def read_pending(bot):
    try:
        with open(_pending_path(bot), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _write_pending(bot, data):
    p = _pending_path(bot)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = f"{p}.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, p)          # 原子替换，防写一半被杀留下坏文件


def claim(bot, key, **meta):
    """认领一批消息。重启后可据此知道「上次处理到哪」。"""
    d = read_pending(bot)
    d[str(key)] = {"at": time.strftime("%F %T"), "pid": os.getpid(), **meta}
    _write_pending(bot, d)


def resolve(bot, key):
    d = read_pending(bot)
    if d.pop(str(key), None) is not None:
        _write_pending(bot, d)


def stale_claims(bot, older_than_sec=1800):
    """认领了但久未完成的——重启后要么续做要么明确放弃，不能装作没有。"""
    out = []
    for k, v in read_pending(bot).items():
        try:
            age = time.time() - time.mktime(time.strptime(v["at"], "%F %T"))
        except Exception:
            continue
        if age > older_than_sec:
            out.append((k, v, age))
    return out


def group_by_sender(rows, sender_key="SenderId"):
    """按发送者分组。铁律 1：同一个人的多条合并成一次调用。"""
    out = {}
    for r in rows:
        out.setdefault(r[sender_key], []).append(r)
    return out


def process(bot, groups, handler, on_error, *, task=None):
    """逐个发送者处理。

    handler(sender_id, msgs) -> None
    on_error(sender_id, exc) -> None   【必须真的给发送者回执】

    铁律 2：一个发送者出错不能拖垮整轮，而且【必须有回执】。
    这里强制走 on_error，就是为了让「静默吞掉」写不出来。
    """
    ok, failed = 0, 0
    for sender_id, msgs in groups.items():
        key = f"{sender_id}:{msgs[-1].get('Id', '')}"
        claim(bot, key, sender=sender_id, count=len(msgs))
        try:
            handler(sender_id, msgs)
            ok += 1
            if task:
                task.event("handled", "P3", {"sender": sender_id, "count": len(msgs)})
        except Exception as e:
            failed += 1
            if task:
                task.event("handle_failed", "P1",
                           {"sender": sender_id, "error": str(e)})
            try:
                on_error(sender_id, e)
            except Exception as e2:
                # 连回执都发不出去——这是最坏的情况，必须喊出来
                print(f"[{bot}] ⚠️ 给 {sender_id} 发回执也失败了: {e2}", flush=True)
        finally:
            resolve(bot, key)
    return ok, failed
