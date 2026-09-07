# -*- coding: utf-8 -*-
"""数据库健康：能不能打开、完整性、以及有没有卡在锁上。

数据库是全系统单点。它坏掉时前端可能只是「有点慢」或「偶尔报错」，
不会有任何东西直说「数据库有问题」——所以必须主动探。

注意本项只读不写：巡检绝不能因为「检查」而给一个已经吃紧的库再加负担。
"""
import os
import sqlite3
import time

NAME = "db_health"


def run(cfg):
    for d in cfg.get("databases", []):
        name, path = d["name"], d["path"]

        # 【必须区分「不存在」和「看不见」】。父目录不可读时 os.path.exists
        # 也返回 False——以非 root 身份跑时会把「权限不足」误报成「文件没了」，
        # 那是 P0 级别的误导。今天已经在别处栽过同一形态两次。
        if not os.path.exists(path):
            parent = os.path.dirname(path)
            readable = os.access(parent, os.R_OK | os.X_OK)
            if not readable:
                yield {"level": "P2", "what": f"{name} 数据库查不了（权限不足）",
                       "why": f"{parent} 对当前身份不可读，无法判断 {path} 的状态。"
                              f"【这不等于没问题】——只是这一项没查成",
                       "fix": "以能读该路径的身份跑巡检（cron 用 root）",
                       "action": None}
            else:
                yield {"level": "P0", "what": f"{name} 数据库文件不存在",
                       "why": f"{path} 不存在（父目录可读，确认是真的没有）",
                       "fix": "确认路径与挂载", "action": None}
            continue

        t0 = time.time()
        try:
            conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        except Exception as e:
            yield {"level": "P0", "what": f"{name} 数据库打不开",
                   "why": f"{type(e).__name__}: {e}（超时多半是被写锁占住）",
                   "fix": "查是谁长时间持有写锁", "action": None}
            continue

        try:
            # quick_check 比 integrity_check 轻得多，适合高频巡检
            chk = conn.execute("PRAGMA quick_check;").fetchone()[0]
            if chk != "ok":
                yield {"level": "P0", "what": f"{name} 数据库完整性异常",
                       "why": f"quick_check: {chk}",
                       "fix": "立刻从最近的好快照恢复", "action": None}

            tbl = d.get("sanity_table")
            if tbl:
                n = conn.execute(f"SELECT COUNT(*) FROM {tbl};").fetchone()[0]
                if n < d.get("sanity_min_rows", 1):
                    yield {"level": "P0",
                           "what": f"{name} 关键表 {tbl} 只有 {n} 行",
                           "why": "文件在、能打开，但数据没了——"
                                  "这比打不开更危险，因为一切看起来正常",
                           "fix": "立刻停写并从快照核对", "action": None}

            elapsed = time.time() - t0
            slow = d.get("slow_query_sec", 3)
            if elapsed > slow:
                yield {"level": "P1", "what": f"{name} 数据库响应慢（{elapsed:.1f}s）",
                       "why": f"只读探测就花了 {elapsed:.1f}s，阈值 {slow}s——"
                              f"多半有长事务或锁竞争",
                       "fix": "查是否有长时间未提交的写事务", "action": None}
        except Exception as e:
            yield {"level": "P1", "what": f"{name} 健康检查本身失败",
                   "why": f"{type(e).__name__}: {e}",
                   "fix": "查库结构是否变更", "action": None}
        finally:
            conn.close()
