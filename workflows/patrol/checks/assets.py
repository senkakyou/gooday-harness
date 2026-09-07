# -*- coding: utf-8 -*-
"""内容资产完整性：已发布的东西，文件还在不在。

站长的原话是「切完工具和论坛东西不丢就行」。那这件事就不该靠人记得去查——
它该是一项每 5 分钟自动跑的巡检。

查的是【数据库说存在、磁盘上却没有】这种不一致：
  · 已发布且在线的工具 → 它的 OnlineUrl 指向的文件
  · 可下载的工具 → 下载文件
  · 论坛帖子引用的图片

为什么这类丢失特别危险：**页面照常列出来，点进去才 404**。
数据库看起来完好、后台管理里一切正常，只有真实用户会撞见。
而这台机器上真实用户很少——可能几周都没人发现。
"""
import os
import re
import sqlite3

NAME = "assets"


def run(cfg):
    for a in cfg.get("assets", []):
        name, db, root = a["name"], a["db"], a["webroot"]

        if not os.access(os.path.dirname(db), os.R_OK | os.X_OK):
            yield {"level": "P2", "what": f"{name} 资产查不了（权限不足）",
                   "why": f"{os.path.dirname(db)} 对当前身份不可读。"
                          f"【这不等于没问题】——只是这一项没查成",
                   "fix": "巡检以 root 跑时自动生效", "action": None}
            continue
        if not os.path.exists(db):
            yield {"level": "P0", "what": f"{name} 数据库不存在",
                   "why": db, "fix": "确认路径", "action": None}
            continue

        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=10)
        try:
            missing = []
            # 1) 已发布且在线的工具
            for label, sql in a.get("queries", []):
                try:
                    for row in conn.execute(sql):
                        url = (row[1] or "").strip()
                        if not url or url.startswith("http"):
                            continue          # 外链不归我们管
                        p = os.path.join(root, url.lstrip("/"))
                        if not os.path.exists(p):
                            missing.append(f"{label}「{row[0]}」→ {url}")
                except Exception as e:
                    yield {"level": "P1", "what": f"{name}/{label} 查询失败",
                           "why": f"{type(e).__name__}: {e}（表结构变了？）",
                           "fix": "核对 SQL 与实际表结构", "action": None}

            if missing:
                yield {"level": "P0",
                       "what": f"{name} 有 {len(missing)} 项已发布内容的文件丢了",
                       "why": "数据库说存在、磁盘上没有。"
                              "【页面照常列出来，点进去才 404】——"
                              "后台看起来一切正常，只有真实用户会撞见。"
                              "前 3 项：" + "；".join(missing[:3]),
                       "fix": "从备份恢复文件，或把对应记录下架",
                       "action": None}
        finally:
            conn.close()
