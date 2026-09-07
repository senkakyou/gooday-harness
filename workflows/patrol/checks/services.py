# -*- coding: utf-8 -*-
"""进程死活 + 「活着但卡死」。

这两件事【不是一回事】，必须分开查：
  · systemd 只知道进程在不在，不知道它有没有在干活。
  · 历史上 bot 卡死 8 次，全程 `active (running)`，心跳文件却几十分钟没动，
    没有任何人发现。

所以有心跳文件的服务，两项都查。
"""
import os
import subprocess
import time

NAME = "services"


def _is_active(unit):
    """返回 True/False/None。None = 查不了（不是「没问题」）。"""
    try:
        r = subprocess.run(["systemctl", "is-active", unit],
                           capture_output=True, text=True, timeout=10)
        return r.stdout.strip() == "active"
    except Exception:
        return None


def run(cfg):
    for svc in cfg.get("services", []):
        unit = svc["unit"]

        # ① 进程在不在
        active = _is_active(unit)
        if active is None:
            yield {"level": "P2", "what": f"{unit} 状态查不了",
                   "why": "systemctl 调用失败（不在本机？无权限？）",
                   "fix": "确认巡检跑在正确的机器与身份下",
                   "action": None}
            continue
        if not active:
            yield {"level": "P1", "what": f"{unit} 没在跑",
                   "why": "systemctl is-active 返回非 active",
                   "fix": f"systemctl restart {unit}",
                   "action": ["systemctl", "restart", unit]}
            continue

        # ② 活着，但有没有在干活
        hb = svc.get("heartbeat")
        if not hb:
            continue
        if not os.path.exists(hb):
            yield {"level": "P1", "what": f"{unit} 心跳文件不存在",
                   "why": f"{hb} 不存在——服务显示 active 但从未写过心跳",
                   "fix": "确认服务代码里每轮循环都写心跳",
                   "action": None}
            continue

        silent_min = (time.time() - os.path.getmtime(hb)) / 60
        limit = svc.get("max_silent_min", 15)
        if silent_min > limit:
            yield {"level": "P1",
                   "what": f"{unit} 活着但卡死（心跳停 {silent_min:.0f} 分钟）",
                   "why": f"{hb} 已 {silent_min:.0f} 分钟未更新，阈值 {limit} 分钟；"
                          f"而 systemd 显示 active——这正是 systemd 看不见的那种故障",
                   "fix": f"systemctl restart {unit}",
                   "action": ["systemctl", "restart", unit]}
