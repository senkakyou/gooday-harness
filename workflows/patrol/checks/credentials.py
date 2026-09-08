# -*- coding: utf-8 -*-
"""大模型凭据可用性。

换来这项的事故（2026-08 至 09）：root 侧 OAuth 凭据失效，
6 个 bot 全都「活着」却连续多天一句话答不出——
心跳、systemd 状态、服务列表全绿，没有任何告警。

而旧 patrol 【有】这项检查，却仍然连续三周报「一切正常」：
它对 FileNotFoundError 是静默 `continue`——
**「文件根本不存在」和「这台机器上没有这份」被当成了同一件事。**
它专门要抓的那个场景，恰恰是它看不见的。

所以本项目的三条：
  1. required 的凭据缺失 = P0，不是跳过
  2. 读不出来（权限/损坏）也要报，不能当没事
  3. 属主漂移要查——root 跑的进程重写文件会把属主改掉，
     把其他身份锁在外面，而现象同样是「全绿但用不了」
"""
import json
import os
import pwd
import time

NAME = "credentials"

OVERDUE_HOURS = 2      # 正常使用下每次调用都会把 expiresAt 续到几小时后


def run(cfg):
    # 事件文件写不动 = 证据链当天整条丢失，而系统看起来一切正常
    w = _events_writable()
    if w is False:
        import time as _t
        f = _t.strftime("%Y-%m-%d") + ".jsonl"
        yield {"level": "P0", "what": f"当天事件文件 {f} 当前身份写不动",
               "why": "当天第一个写的人决定文件权限，而 root cron 与 agent cron 都在写。"
                      "写不动 = 这一整天的证据链丢失，**而系统看起来一切正常**",
               "fix": "sudo chmod 664 <事件文件>；根治已在 packages/trace 里"
                      "（新建时即放开同组写），但已存在的旧文件要手工改一次",
               "action": None}

    for c in cfg.get("credentials", []):
        who, path = c["who"], c["path"]
        required = c.get("required", False)

        if not os.path.exists(path):
            if required:
                yield {"level": "P0", "what": f"{who} 的大模型凭据不存在",
                       "why": f"{path} 不存在。以 {who} 身份的模型调用【全部】在静默失败——"
                              f"现象是「活着但答不出话」，心跳和 systemd 全绿",
                       "fix": f"以 {who} 身份跑 claude 登录，再重启相关服务",
                       "action": None}
            # 非 required 的缺失才可以不报——但这必须是配置里明说的，不是代码默认
            continue

        # 属主漂移：root 重写过这个文件，把原属主锁在外面
        want = c.get("owner")
        if want:
            try:
                actual = pwd.getpwuid(os.stat(path).st_uid).pw_name
                if actual != want:
                    yield {"level": "P1",
                           "what": f"{who} 的凭据属主漂移：{actual}（应为 {want}）",
                           "why": f"{path} 属主变了。以 {want} 身份跑的进程会读不到它，"
                                  f"而现象同样是「全绿但用不了」",
                           "fix": f"chown {want} {path}",
                           "action": ["chown", f"{want}:{want}", path]}
            except Exception as e:
                yield {"level": "P2", "what": f"{who} 凭据属主查不了",
                       "why": f"{type(e).__name__}: {e}", "fix": "确认巡检身份权限",
                       "action": None}

        # 过期判定
        try:
            with open(path) as f:
                exp = float(json.load(f)["claudeAiOauth"]["expiresAt"]) / 1000.0
        except Exception as e:
            # 【不能静默】——读不出来本身就是故障信号，旧 patrol 就是在这类分支上瞎了
            yield {"level": "P1", "what": f"{who} 的凭据读不出",
                   "why": f"{path}：{type(e).__name__}: {e}。"
                          f"同步/续期链路可能已断",
                   "fix": "检查文件是否损坏或格式变更", "action": None}
            continue

        overdue_h = (time.time() - exp) / 3600
        if overdue_h > OVERDUE_HOURS:
            yield {"level": "P0",
                   "what": f"{who} 的凭据已过期 {overdue_h:.1f} 小时且未见刷新",
                   "why": f"expiresAt 落在过去 {overdue_h:.1f} 小时。"
                          f"正常使用下每次调用都会把它续到几小时后——"
                          f"说明很久没有一次成功调用了",
                   "fix": f"以 {who} 身份重新登录，再重启相关服务",
                   "action": None}


def _events_writable():
    """当天事件文件当前身份写不写得动。

    2026-09-08 实测：当天第一个写的人决定文件权限，而写它的身份不止一个
    （root cron 与 agent cron 都在写）。root 先建就是 0644，
    agent 侧一整天全部 PermissionError —— **每天 0 点复发一次**。
    trace 会响亮降级（标记文件 + stderr），但没有任何东西在主动查它。
    """
    import time as _t
    d = os.path.join(os.environ.get("GOODAY_HARNESS_STATE",
                                    "/var/lib/gooday-harness"), "events")
    f = os.path.join(d, _t.strftime("%Y-%m-%d") + ".jsonl")
    if not os.path.exists(f):
        return None                       # 今天还没人写过，无从判断
    return os.access(f, os.W_OK)
