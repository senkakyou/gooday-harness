# -*- coding: utf-8 -*-
"""迁移配对：被替代的旧任务，和替代它的新任务，必须恰好有一个在跑。

迁移是两步——【装新的】和【停旧的】——而这两步没有任何东西保证配对。
2026-09-07 同一个根因连续害了两次：

  一、停了旧的、忘了装新的  → 数据库备份出现空档，无人知道
  二、跑了 install 但部署副本是旧的 → 报告成功，装的是三小时前的代码

反过来同样危险：装了新的、忘了停旧的，两套并行跑，
而你以为已经切换完了——直到某天它们开始互相打架。

所以每个 workflow 在 deploy/schedule.cron 里用 `# replaces: <旧路径>` 声明
它替代了谁，本项检查「新旧恰好一个在跑」：
  两个都在  → P1（并行，迁移没收尾）
  两个都没  → P0（空档，这件事现在没人做）
"""
import os
import re
import subprocess

NAME = "migration"


def _crontabs():
    """收集所有 crontab。返回 (内容, 读全了没有)。

    ⚠️ 【读不全就不能下结论】。以非 root 身份跑时 `crontab -l` 只能读到
    自己那份，root 的读不到——据此判断「新旧都没在跑」会得出 P0 级别的
    错误结论。2026-09-07 本项目实测踩到：patrol 明明在 root crontab 里跑着，
    却被报成「没人做」。

    这正是本文件要防的那类错误的镜像：不是「以为做了其实没做」，
    而是「以为没做其实做了」。两者都源于拿不完整的数据下结论。
    """
    bodies, complete = [], True
    for who in ("root", "agent"):
        cmd = ["crontab", "-u", who, "-l"] if os.geteuid() == 0 else \
              (["crontab", "-l"] if who == os.environ.get("USER", "") or
               who == _whoami() else None)
        if cmd is None:
            complete = False
            continue
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if r.returncode == 0:
                bodies.append(r.stdout)
            elif "no crontab" not in (r.stderr or "").lower():
                complete = False
        except Exception:
            complete = False
    return "\n".join(bodies), complete


def _whoami():
    try:
        import pwd
        return pwd.getpwuid(os.geteuid()).pw_name
    except Exception:
        return ""


def run(cfg):
    repo = cfg.get("repo", "/opt/gooday-harness")
    wf_dir = os.path.join(repo, "workflows")
    if not os.path.isdir(wf_dir):
        yield {"level": "P2", "what": "查不了迁移配对",
               "why": f"{wf_dir} 不存在——无法读取各 workflow 的 replaces 声明",
               "fix": "确认 repo 路径配置正确", "action": None}
        return

    blob, complete = _crontabs()
    if not complete:
        # 读不全就【只报查不了，不下判断】——拿不完整的数据判 P0
        # 会制造和它要防的问题一样严重的误导
        yield {"level": "P2", "what": "迁移配对查不了（crontab 读不全）",
               "why": f"当前身份 {_whoami()} 读不到全部 crontab（需要 root）。"
                      f"【这不等于没问题】——只是这一项没查成",
               "fix": "本项在 cron 以 root 跑时自动生效", "action": None}
        return

    for name in sorted(os.listdir(wf_dir)):
        if name.startswith("_"):
            continue
        sched = os.path.join(wf_dir, name, "deploy", "schedule.cron")
        if not os.path.isfile(sched):
            continue
        with open(sched, encoding="utf-8") as f:
            head = f.read()
        m = re.search(r"^#\s*replaces:\s*(\S+)", head, re.M)
        if not m:
            continue                      # 没声明替代关系的（如新建的）跳过
        old = m.group(1)

        new_running = f"workflows/{name}/run.py" in blob
        old_running = old in blob

        if new_running and old_running:
            yield {"level": "P1", "what": f"{name}：新旧两套都在跑",
                   "why": f"crontab 里同时有 workflows/{name}/run.py 和 {old}。"
                          f"迁移没收尾——两套并行迟早互相打架，"
                          f"而你以为已经切换完了",
                   "fix": f"确认新的稳定后，从 crontab 移除 {old}",
                   "action": None}
        elif not new_running and not old_running:
            yield {"level": "P0", "what": f"{name}：新旧都没在跑",
                   "why": f"crontab 里既没有 workflows/{name}/run.py，"
                          f"也没有 {old}——【这件事现在没人做】。"
                          f"典型成因：停了旧的但忘了装新的",
                   "fix": f"跑 sudo bash {repo}/ops/install.sh",
                   "action": None}
