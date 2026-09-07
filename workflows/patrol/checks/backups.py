# -*- coding: utf-8 -*-
"""备份新鲜度与失败标记。

备份体系最危险的状态**不是没备份，是以为有备份**。
「配置了备份」和「备份在跑」是两件事——出事那天才发现最新快照是三周前的，
那时候什么都晚了。

所以这项查两样：
  1. 失败标记在不在（db-snapshot 校验不过时会落）
  2. 最新快照有多老（cron 静默失败时文件就不再更新，但目录还在，看起来很正常）
"""
import os
import time

NAME = "backups"


def run(cfg):
    for b in cfg.get("backups", []):
        name, d = b["name"], b["dir"]
        limit_h = b.get("max_age_hours", 3)

        # 失败标记：db-snapshot 校验不过时落在备份根目录
        mark = os.path.join(os.path.dirname(d.rstrip("/")), ".snapshot-failure")
        for m in (mark, os.path.join(d, ".snapshot-failure")):
            if os.path.exists(m) and os.path.getsize(m) > 0:
                try:
                    last = open(m, encoding="utf-8").read().strip().splitlines()[-1]
                except Exception:
                    last = "（标记内容读不出）"
                yield {"level": "P0", "what": f"{name} 备份失败标记存在",
                       "why": f"{m} 最后一条：{last}",
                       "fix": "查 db-snapshot 日志；标记会在下次成功后自动清除",
                       "action": None}
                break

        if not os.path.isdir(d):
            yield {"level": "P0", "what": f"{name} 备份目录不存在",
                   "why": f"{d} 不存在——备份体系根本没在跑",
                   "fix": "确认 db-snapshot 的 cron 已装且真的执行过",
                   "action": None}
            continue

        files = [os.path.join(d, f) for f in os.listdir(d) if not f.startswith(".")]
        files = [f for f in files if os.path.isfile(f)]
        if not files:
            yield {"level": "P0", "what": f"{name} 备份目录是空的",
                   "why": f"{d} 下没有任何快照。目录建好了但没人往里写——"
                          f"这比没有目录更危险，因为它看起来是配置好的",
                   "fix": "手动跑一次 db-snapshot 看报什么错", "action": None}
            continue

        age_h = (time.time() - max(os.path.getmtime(f) for f in files)) / 3600
        if age_h > limit_h:
            yield {"level": "P0",
                   "what": f"{name} 最新快照已 {age_h:.1f} 小时未更新",
                   "why": f"{d} 下最新文件 {age_h:.1f} 小时前，阈值 {limit_h} 小时。"
                          f"cron 静默失败时文件就停止更新，而目录还在、看起来很正常",
                   "fix": "查 cron 是否真的执行（日志文件有没有新内容）",
                   "action": None}
