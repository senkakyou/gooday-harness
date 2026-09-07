# -*- coding: utf-8 -*-
"""bot 收件箱是否在正常消化 —— 两个方向都要查。

2026-09-07 事故：灵犀对站长一句「你好」连回了 14 条。
根因是 `unread()` 从不标已读（迁移期的影子模式保护活过了它该在的时期），
每轮轮询都把同一条当新消息重答。

**事故全程：心跳绿的、服务 active、patrol 全绿、日志无异常。**
是站长自己发现「聊天不对劲」的。单测也挡不住——代码「能跑」，
只是跑出来的行为是错的。这类故障只有在运行期数据上才看得见。

所以查两个方向，它们是同一个轴的两端：

  · **不消化**：未读堆着不减 → bot 卡死/挂了，用户发了没人理
  · **消化了却没认领**：未读没减、回复却在涨 → 无限重答，用户被刷屏

第二种更隐蔽：所有健康指标都正常，bot 看起来非常勤奋。
"""
import os
import sqlite3
import time

NAME = "bot_inbox"

DB = "/var/lib/docker/volumes/gooday_gooday_data/_data/gooday.db"


def _q(sql, args=()):
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)
    try:
        return conn.execute(sql, args).fetchall()
    finally:
        conn.close()


def run(cfg):
    bots = cfg.get("bot_inbox")
    # 判「键在不在」不判真值：`{}` 是「配了，用默认」，不是「没配」。
    if bots is None:
        yield {"level": "P3", "what": "bot 收件箱巡检未配置",
               "why": "config.json 没有 bot_inbox 段，本项无从检查",
               "fix": "加 bot_inbox 段（见 config.example.json）", "action": None}
        return
    bots = bots or {}
    max_unread_min = bots.get("max_unread_minutes", 15)
    dup_window_min = bots.get("dup_window_minutes", 10)
    dup_limit = bots.get("dup_limit", 3)
    ids = bots.get("bot_ids") or [20, 21, 22, 23, 24]

    # 读不了要说清楚是「没查成」，不是「没问题」
    parent = os.path.dirname(DB)
    if not os.path.isdir(parent) or not os.access(parent, os.R_OK):
        yield {"level": "P2", "what": "bot 收件箱查不了（权限不足）",
               "why": f"{parent} 对当前身份不可读。【这不等于没问题】——只是这一项没查成",
               "fix": "以 root 跑巡检（cron 里就是 root）", "action": None}
        return

    for bid in ids:
        try:
            rows = _q("SELECT Id, SenderId, CreatedAt FROM PrivateMessages "
                      "WHERE ReceiverId=? AND IsRead=0 ORDER BY Id", (bid,))
        except Exception as e:
            yield {"level": "P2", "what": f"bot {bid} 收件箱查不了",
                   "why": f"{e}。【这不等于没问题】", "fix": "看库是否被锁", "action": None}
            continue

        # ① 未读堆积：发了没人理
        if rows:
            oldest = rows[0][2] or ""
            try:
                t = time.mktime(time.strptime(oldest[:19], "%Y-%m-%d %H:%M:%S"))
                age = (time.time() - t) / 60
            except Exception:
                age = None
            if age is not None and age > max_unread_min:
                yield {"level": "P1",
                       "what": f"bot {bid} 有 {len(rows)} 条未读，最老的 {age:.0f} 分钟没处理",
                       "why": "超过阈值。要么 bot 卡死、要么模型调用一直失败——"
                              "用户发了消息没人理，而服务状态和心跳都是正常的",
                       "fix": f"看 /var/log/gooday-harness/ 里该 bot 的日志；"
                              f"systemctl status 看进程是不是卡在 claude 调用上",
                       "action": None}

        # ② 重复应答：未读没消化，回复却在涨 —— 这就是 9/07 那次的形态
        since = time.strftime("%Y-%m-%d %H:%M:%S",
                              time.localtime(time.time() - dup_window_min * 60))
        try:
            dup = _q("SELECT ReceiverId, COUNT(*) FROM PrivateMessages "
                     "WHERE SenderId=? AND CreatedAt > ? "
                     "GROUP BY ReceiverId HAVING COUNT(*) >= ?",
                     (bid, since, dup_limit))
        except Exception:
            dup = []
        for receiver, n in dup:
            # 有未读同时又在猛发 = 高度可疑：它在反复答同一条
            suspicious = bool(rows)
            yield {"level": "P0" if suspicious else "P2",
                   "what": f"bot {bid} 在 {dup_window_min} 分钟内向 {receiver} 发了 {n} 条",
                   "why": ("同时收件箱里还有未读没消化 —— 高度疑似【重复应答同一条】，"
                           "用户正在被刷屏。2026-09-07 灵犀就是这样对一句「你好」回了 14 条"
                           if suspicious else
                           "短时间内发送量偏高，确认是正常长回复分段还是重复"),
                   "fix": ("立刻停服务止血，或直接 UPDATE PrivateMessages SET IsRead=1 "
                           f"WHERE ReceiverId={bid} AND IsRead=0；再查 mark_read 有没有生效"
                           if suspicious else "看该时段的对话内容确认"),
                   "action": None}
