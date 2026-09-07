#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""调度器 · 事件驱动的工单状态机。

**它不调模型。** 这是刻意的架构决策，不是省事：

  让调度经过一个会调模型的 bot，会引入三个新故障源——
  单点故障（它死了全公司停摆）、每次流转多一轮模型调用（延迟＋成本）、
  以及又多一层「消息已读即凭证消失」。

  所以：**调度逻辑经过调度中心，数据通道不经过聊天**。
  纯规则、秒级响应、不会「想不明白」。需要判断力的环节
  （审批、终审、异常分析）才交给会调模型的角色。

从旧 lingxi-dispatcher.py（580 行）重新设计，完整保留两条硬知识：

1. **状态机迁移表**（照抄，不改语义）
2. **防诈尸**：状态机拥有的事件遇非法迁移一律消费，绝不留 new
"""
import json
import os
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages", "trace"))

from trace import Task                                    # noqa: E402

NAME = "dispatcher"
STATE_DIR = f"/var/lib/gooday-harness/state/{NAME}"
HEARTBEAT = os.path.join(STATE_DIR, "heartbeat")
CONFIG = os.path.join(HERE, "config.json")

TERMINAL = {"done", "refunded", "cancelled"}

# 状态机迁移表：(当前主状态, 事件类型) -> 目标主状态
TRANSITIONS = {
    ("pending",           "analysis_done"):     "analyst_complete",
    ("analyst_complete",  "client_confirmed"):  "confirmed",
    ("confirmed",         "payment_confirmed"): "in_progress",
    ("in_progress",       "dev_done"):          "delivering",
    ("in_progress",       "dev_failed"):        "failed",
    # reviewing 为外部化终审预留：当前终审内嵌在开发进程里，dev_done 直连 delivering。
    # 保留一个不激活的状态是刻意的——【改状态机比加状态贵得多】。
    ("reviewing",         "review_passed"):     "delivering",
    ("reviewing",         "review_failed"):     "failed",
    ("delivering",        "client_accepted"):   "done",
    ("delivering",        "client_rejected"):   "customer_rejected",
    ("customer_rejected", "rework_approved"):   "in_progress",
    ("failed",            "refund_approved"):   "refunding",
    ("customer_rejected", "refund_approved"):   "refunding",
    ("refunding",         "refund_recorded"):   "refunded",
}

# 【必须从 TRANSITIONS 自动派生，绝不手维护白名单】——手维护必漏项。
#
# 换来这条的事故：旧版有 4 个迁移事件不在手写白名单里，非法时既不产生决策
# 也不标 processed，永久留成 new。平时看不出来，直到工单状态回退
# （人工重置、或巡检自动重派失败单——这是常态操作），旧事件迁移又变合法，
# 被当新事件「诈尸」重放，把正在跑的单打成 failed。
# 已产出真实交付物的单子就这样被打回。
_TRANSITION_EVENTS = {et for (_st, et) in TRANSITIONS}

# 越权类：未到该阶段就发来的事件，要告警（有人在乱发）
ESCALATE_ON_ILLEGAL = {"dev_done", "payment_confirmed", "refund_recorded"}


def log(msg):
    print(f"[{NAME}] {time.strftime('%F %T')} {msg}", flush=True)


def heartbeat():
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(HEARTBEAT, "w") as f:
            f.write(str(int(time.time())))
    except Exception as e:
        log(f"心跳写入失败: {e}")


def decide(ticket, event):
    """对一个事件做决策。返回 (action, target_or_none)。

    三类处理（这是防诈尸的核心，改之前先看 _TRANSITION_EVENTS 的注释）：
      transition —— 合法迁移，执行
      illegal    —— 白名单越权事件，告警 ＋ 消费
      stale      —— 其余迁移事件对当前状态非法，【仅消费不告警】
      None       —— 非状态机事件，不碰，留给各自的消费者
    """
    st, et = ticket["Status"], event["EventType"]
    if st in TERMINAL:
        # 终态之后来的迁移事件也要消费掉，否则同样会诈尸
        return ("stale", None) if et in _TRANSITION_EVENTS else (None, None)
    key = (st, et)
    if key in TRANSITIONS:
        return ("transition", TRANSITIONS[key])
    if et in _TRANSITION_EVENTS:
        return ("illegal" if et in ESCALATE_ON_ILLEGAL else "stale", None)
    return (None, None)


def run_once(cfg, task):
    """扫一轮未处理事件。只读模式下只算不写。"""
    readonly = cfg.get("mode", "shadow") != "active"
    conn = sqlite3.connect(cfg["db"], timeout=10)
    conn.row_factory = sqlite3.Row
    stats = {"transition": 0, "illegal": 0, "stale": 0, "skipped": 0}
    try:
        events = conn.execute(
            "SELECT * FROM TicketEvents WHERE Status='new' ORDER BY Id LIMIT ?",
            (cfg.get("batch", 50),)).fetchall()
        for ev in events:
            t = conn.execute("SELECT Id, Status FROM Tickets WHERE Id=?",
                             (ev["TicketId"],)).fetchone()
            if not t:
                stats["skipped"] += 1
                continue
            action, target = decide(dict(t), dict(ev))
            if action is None:
                stats["skipped"] += 1
                continue
            stats[action] += 1

            level = "P1" if action == "illegal" else "P3"
            task.event(f"decide:{action}", level, {
                "ticket": t["Id"], "from": t["Status"],
                "event": ev["EventType"], "to": target,
                "applied": not readonly})

            if readonly:
                continue
            if action == "transition":
                conn.execute("UPDATE Tickets SET Status=?, UpdatedAt=? WHERE Id=?",
                             (target, time.strftime("%FT%H:%M:%SZ"), t["Id"]))
            # 三类都要标 processed——【绝不留 new】，这是防诈尸的关键
            conn.execute("UPDATE TicketEvents SET Status='processed', ProcessedAt=? "
                         "WHERE Id=?", (time.strftime("%FT%H:%M:%SZ"), ev["Id"]))
            conn.commit()
        return stats
    finally:
        conn.close()


def main():
    if not os.path.exists(CONFIG):
        log(f"缺 {CONFIG}，从 config.example.json 拷一份改")
        return 2
    with open(CONFIG, encoding="utf-8") as f:
        cfg = {k: v for k, v in json.load(f).items() if not k.startswith("_")}

    mode = "影子" if cfg.get("mode", "shadow") != "active" else "生产"
    log(f"启动，模式={mode}，状态机 {len(TRANSITIONS)} 条迁移规则")

    while True:
        heartbeat()
        try:
            with Task("dispatch-scan", subject=mode, actor=NAME) as task:
                stats = run_once(cfg, task)
                task.event("scan_done", "P3", stats)
                if any(v for k, v in stats.items() if k != "skipped"):
                    log(f"[{mode}] {stats}")
        except Exception as e:
            log(f"主循环异常: {e}")          # 主循环永不退出
        time.sleep(cfg.get("poll_sec", 15))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        log(f"致命错误: {e}")
        sys.exit(1)
