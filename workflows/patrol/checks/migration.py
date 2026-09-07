# -*- coding: utf-8 -*-
"""迁移配对：被替代的旧任务，和替代它的新任务，必须恰好有一个在跑。

迁移是两步——【装新的】和【停旧的】——而这两步没有任何东西保证配对。
2026-09-07 同一个根因连续害了两次：

  一、停了旧的、忘了装新的  → 数据库备份出现空档，无人知道
  二、跑了 install 但部署副本是旧的 → 报告成功，装的是三小时前的代码

反过来同样危险：装了新的、忘了停旧的，两套并行跑，
而你以为已经切换完了——直到某天它们开始互相打架。

═══ 迁移收尾后本项改了叙事（2026-09-07）═══════════════════════

原来它查的是「新旧恰好一个在跑」，两半价值不同：

  · 「新旧都在跑」那一半随旧路径消失而**永久静默** —— 迁移已完成，
    再也不会有旧的在跑。留着它只会让人以为还有东西在盯。
  · 「都没在跑」那一半是**永久资产**：它是「这件事现在没人做」的
    唯一探测器，跟迁移完没完成没关系。

所以叙事从「迁移配对」变成**「每个 workflow 都得有主」**：
`# replaces:` 从必需降级为可选（只有还处在迁移中的才需要声明），
而「装了但没人调起」永远是 P0。
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
            # 仍保留：将来再做迁移时它照样有用。但迁移已收尾，
            # 现在没有任何 workflow 声明 replaces，所以这条实际不会触发。
            yield {"level": "P1", "what": f"{name}：新旧两套都在跑",
                   "why": f"crontab 里同时有 workflows/{name}/run.py 和 {old}。"
                          f"迁移没收尾——两套并行迟早互相打架，"
                          f"而你以为已经切换完了",
                   "fix": f"确认新的稳定后，从 crontab 移除 {old}",
                   "action": None}
        elif not new_running and not old_running:
            yield {"level": "P0", "what": f"{name}：装了但没人调起",
                   "why": f"{name} 有 deploy/schedule.cron，但 crontab 里找不到它"
                          + (f"，声明替代的 {old} 也没在跑" if old else "")
                          + "。**这件事现在没有任何人在做**，而目录还在、"
                            "代码还在，看起来一切正常",
                   "fix": "跑 sudo bash /opt/gooday-harness/ops/install.sh 重装托管块；"
                          "装完等一个执行周期，确认日志文件真的出现",
                   "action": None}
