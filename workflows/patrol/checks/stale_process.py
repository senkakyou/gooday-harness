# -*- coding: utf-8 -*-
"""常驻服务的进程是不是比它的代码还旧 —— 「改了但没生效」探测。

改完常驻 service 的代码不会自动生效，必须 restart。
但**忘记 restart 之后一切看起来都正常**：服务 active、心跳新鲜、
日志无异常、门禁全绿 —— 只有行为还是老的。

CLAUDE.md 早就记过这条教训（原话）：
「claude 多次提交后说需重启，但灵犀接手时进程跑的还是十几小时前的旧代码
 ——复验前先用 ps -o lstart 对比文件 mtime，确认真重启了再实测，
 否则验的是旧代码（这次差点栽三回）」。

记下来了，但**没有任何东西在自动查它**。2026-09-07 又撞上：
botkit 的重复应答修完、推完、部署副本也拉了，五个 bot 跑的仍是三小时前的进程。
教训写进文档而没有检查器 = 愿望，不是规范（policies 开篇第一句）。

判据：进程启动时间 < 它依赖的代码文件的最后修改时间 → 跑的是旧版本。
"""
import os
import subprocess
import time

NAME = "stale_process"

# 服务 -> 它依赖的代码路径（相对仓库根）。多个 bot 共用 packages/botkit，
# 所以公共库一改，所有 bot 都得重启——这正是容易漏的地方。
REPO = "/opt/gooday-harness"


def _newest_mtime(paths):
    newest, where = 0, None
    for rel in paths:
        p = os.path.join(REPO, rel)
        if os.path.isfile(p):
            m = os.path.getmtime(p)
            if m > newest:
                newest, where = m, rel
        elif os.path.isdir(p):
            for dp, dns, fns in os.walk(p):
                dns[:] = [d for d in dns if d not in ("__pycache__", ".git")]
                for fn in fns:
                    # 【只认真正影响运行行为的文件】。
                    # 改 README 或 config.example.json 里的说明文字不需要重启服务，
                    # 而把它们算进来就会天天喊「跑的是旧代码」——
                    # 狼来了几次之后，真出事那次也没人看（我自己第一版就这样：
                    # 只改了 _mode 的说明文字，六个服务全报 P1）。
                    if not fn.endswith((".py", ".sh")) and fn != "config.json":
                        continue
                    f = os.path.join(dp, fn)
                    try:
                        m = os.path.getmtime(f)
                    except OSError:
                        continue
                    if m > newest:
                        newest, where = m, os.path.relpath(f, REPO)
    return newest, where


def _start_time(unit):
    """服务主进程的启动时间（epoch）。取不到返回 None —— 【不当成没问题】。"""
    try:
        r = subprocess.run(
            ["systemctl", "show", "-p", "ExecMainStartTimestampMonotonic",
             "--value", unit],
            capture_output=True, text=True, timeout=10)
        v = (r.stdout or "").strip()
        if not v or v == "0":
            return None
        # monotonic 微秒 → 换算成 epoch
        with open("/proc/uptime") as f:
            up = float(f.read().split()[0])
        return time.time() - up + int(v) / 1e6
    except Exception:
        return None


def run(cfg):
    units = cfg.get("stale_process")
    # 判「键在不在」不判真值：{} 是「配了，用默认」，不是「没配」。
    if units is None:
        yield {"level": "P3", "what": "旧进程巡检未配置",
               "why": "config.json 没有 stale_process 段，本项无从检查",
               "fix": "加 stale_process 段（见 config.example.json）", "action": None}
        return

    grace = (units or {}).get("grace_minutes", 10)     # 刚改完还没来得及重启，别立刻吵
    for item in (units or {}).get("units", []):
        unit, deps = item.get("unit"), item.get("deps", [])
        if not unit or not deps:
            continue
        started = _start_time(unit)
        if started is None:
            yield {"level": "P2", "what": f"{unit} 的启动时间取不到",
                   "why": "systemctl show 没返回 ExecMainStartTimestamp。"
                          "【这不等于没问题】——只是这一项没查成",
                   "fix": f"手动 systemctl status {unit} 看进程状态", "action": None}
            continue

        newest, where = _newest_mtime(deps)
        if not newest:
            continue
        lag_min = (newest - started) / 60
        if lag_min > grace:
            yield {"level": "P1",
                   "what": f"{unit} 跑的是旧代码（比 {where} 旧 {lag_min:.0f} 分钟）",
                   "why": f"进程启动于 {time.strftime('%F %T', time.localtime(started))}，"
                          f"而 {where} 改于 {time.strftime('%F %T', time.localtime(newest))}。"
                          "改完常驻 service 不 restart 就不生效，而【一切看起来都正常】："
                          "服务 active、心跳新鲜、日志无异常，只有行为还是老的",
                   "fix": f"systemctl restart {unit}，然后用 ps -o lstart 确认真的重启了再复验",
                   "action": None}
