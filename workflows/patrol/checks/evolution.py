# -*- coding: utf-8 -*-
"""进化闭环是否还在转、转得对不对。

CI 只能证明闭环**能跑一次**。它证明不了三个月后还在跑——
而「配置了但早就不转了」正是本项目反复栽的那类坑：
结构在、但没在起作用，且没有任何东西会说。

这项查四样，每样对应一种「看起来正常其实已经死了」的形态：

  1. **闭环多久没转了** —— cron 静默失败时目录还在、文件还在，非常正常的样子
  2. **连续失败** —— 在转，但每轮都失败；比不转更隐蔽
  3. **转而不学** —— 有 Decision 却长期没有新 experience，说明经验沉淀那环空了
  4. **回滚事件** —— promote 后实测变差是 P0 级信号，不能只躺在文件里没人看

第 4 项尤其重要：回滚**成功**说明防线起作用了，但它同时意味着
「隔离副本上过了、真身上却变差」真实发生过——那是要人去看的。
"""
import json
import os
import time

NAME = "evolution"

STATE = os.environ.get("GOODAY_HARNESS_STATE", "/var/lib/gooday-harness")


def _newest(d):
    """目录里最新文件的 mtime。区分「目录不存在」和「读不动」——
    os.path.exists 在权限不足时也返回 False，会把「没权限」误报成「没有」。"""
    if not os.path.isdir(d):
        parent = os.path.dirname(d.rstrip("/"))
        if os.path.isdir(parent) and not os.access(parent, os.R_OK):
            return None, "unreadable"
        return None, "missing"
    try:
        fs = [os.path.join(d, f) for f in os.listdir(d) if not f.startswith(".")]
    except PermissionError:
        return None, "unreadable"
    if not fs:
        return None, "empty"
    try:
        return max(os.path.getmtime(f) for f in fs), "ok"
    except OSError:
        return None, "unreadable"


def _recent_decisions(d, n=20):
    if not os.path.isdir(d):
        return []
    try:
        fs = sorted((os.path.join(d, f) for f in os.listdir(d) if f.endswith(".json")),
                    key=os.path.getmtime, reverse=True)[:n]
    except OSError:
        return []
    out = []
    for p in fs:
        try:
            with open(p, encoding="utf-8") as f:
                out.append((p, json.load(f)))
        except Exception:
            continue
    return out


def run(cfg):
    # 【判「键在不在」，不判真值】：`{"evolution": {}}` 是「配了，用默认值」，
    # 不是「没配」。用 if not cfg.get(...) 会把空配置段当成未启用，
    # 于是配置摆在那里、检查却一项没跑，还只报个没人管的 P3——
    # 结构在、但没在起作用，且没有任何东西会说。
    if "evolution" not in cfg:
        # 没配就是没启用。这里【不能默默返回】——「没配置」和「配了但没跑」
        # 长得一样，而后者是事故。至少说一声。
        yield {"level": "P3", "what": "进化闭环巡检未配置",
               "why": "config.json 里没有 evolution 段，本项无从检查",
               "fix": "在 config.json 加 evolution 段（见 config.example.json）",
               "action": None}
        return

    ec = cfg["evolution"] or {}
    max_age_h = ec.get("max_age_hours", 26)     # 日跑一次，留 2 小时余量
    dec_dir = os.path.join(STATE, "decisions")
    exp_dir = os.path.join(STATE, "experience")

    # ① 多久没转了
    mt, st = _newest(dec_dir)
    if st == "unreadable":
        yield {"level": "P1", "what": "进化留痕目录读不动",
               "why": f"{dec_dir} 权限不足——【检查没跑成，不等于没问题】",
               "fix": "确认巡检身份对 $GOODAY_HARNESS_STATE 有读权限",
               "action": None}
    elif st in ("missing", "empty"):
        yield {"level": "P1", "what": "进化闭环从未产出过决策",
               "why": f"{dec_dir} {'不存在' if st == 'missing' else '是空的'}"
                      "——闭环装了但一次都没真正跑过",
               "fix": "手动跑一次 workflows/evaluate，确认 cron 真的在执行",
               "action": None}
    else:
        age_h = (time.time() - mt) / 3600
        if age_h > max_age_h:
            yield {"level": "P1", "what": f"进化闭环 {age_h:.0f} 小时没转了",
                   "why": f"最新决策是 {age_h:.0f} 小时前，超过阈值 {max_age_h}h。"
                          "目录还在、文件还在，看起来一切正常——这正是危险之处",
                   "fix": "查 cron 是否还在、日志有没有报错",
                   "action": None}

    recent = _recent_decisions(dec_dir)

    # ② 连续失败：在转，但每轮都白转
    bad = {"failed", "rejected", "rolled_back", "needs_human"}
    tail = [d for _, d in recent[:5]]
    if len(tail) >= 5 and all(d.get("status") in bad for d in tail):
        kinds = {}
        for d in tail:
            kinds[d.get("status")] = kinds.get(d.get("status"), 0) + 1
        yield {"level": "P2", "what": "进化闭环连续 5 轮没有promote",
               "why": f"最近 5 次决策全是 {kinds}——闭环在转但没产出改进，"
                      "可能是 improver 覆盖不到当前这类失败",
               "fix": "看 experience/ 里最近的经验类型，确认 improver 有对应策略",
               "action": None}

    # ③ 回滚事件：防线起作用了，但它意味着真身上确实变差过
    rb = [(p, d) for p, d in recent if d.get("status") == "rolled_back"]
    day_ago = time.time() - 86400
    for p, d in rb:
        try:
            if os.path.getmtime(p) < day_ago:
                continue
        except OSError:
            continue
        yield {"level": "P0", "what": f"进化闭环发生回滚：{d.get('loop')}",
               "why": f"promote 后实测变差已自动回滚。目标={d.get('target')}；"
                      f"结果={d.get('result')}。回滚成功说明防线有效，"
                      "但「隔离副本上过了、真身上却变差」真实发生过，要人看",
               "fix": f"读 {p}，核对副本与真身的环境差异",
               "action": None}

    # ④ Decision 卡在 experimenting = 记录在说谎
    #
    # 引擎里 rollback 抛异常时，紧跟其后的 dec.update(status=...) 和
    # _write(dpath, dec) 都不执行，Decision 就永远停在 experimenting ——
    # 而那一刻生产已经被 promote 改过、可能也已回滚。
    # 「decision 不说谎」本该是引擎的不变式，但 loop.py 是冻结的；
    # 在动它之前，先用一条加法规则把这个状态兜住（灵犀第四轮建议）。
    stuck_min = ec.get("stuck_decision_minutes", 30)
    for path, d in recent:
        if d.get("status") != "experimenting":
            continue
        try:
            age = (time.time() - os.path.getmtime(path)) / 60
        except OSError:
            continue
        if age > stuck_min:
            yield {"level": "P0",
                   "what": f"Decision 卡在 experimenting {age:.0f} 分钟：{d.get('loop')}",
                   "why": f"目标={d.get('target')}。一轮闭环不该跑这么久 —— "
                          "多半是 promote/rollback 中途抛异常，引擎没走到写状态那一步。"
                          "**此刻生产可能已被改过，而记录说还在实验中**",
                   "fix": f"读 {path} 和同时段的 trace 事件（rollback_incomplete / "
                          "cycle_crashed），确认真身状态；必要时按 checkpoint 手工回滚",
                   "action": None}

    # ⑤ 业务闭环必须真的在转 —— canary 绿不代表业务闭环在跑。
    #    canary 只证明「Harness 这套机器还活着」，它每天都会 promoted；
    #    如果只看整体有没有决策，业务闭环停了一个月也看不出来。
    #    所以按闭环名分别查（2026-09-07 接入 gooday-assets 时补的）。
    for name in ec.get("business_loops", ["gooday-assets"]):
        hits = [d for _, d in recent if d.get("loop") == name]
        if not hits:
            yield {"level": "P2", "what": f"业务闭环 {name} 近期没有任何决策",
                   "why": f"最近 20 条决策里没有 {name} 的。canary 照常 promoted "
                          "会让整体看起来很正常——但业务闭环可能已经停了",
                   "fix": f"手动跑 python3 workflows/evolve/run.py 看 {name} 报什么",
                   "action": None}

    # ⑥ 转而不学：有决策却长期没有新经验
    em, est = _newest(exp_dir)
    if est == "ok" and mt:
        if (mt - em) / 3600 > 48:
            yield {"level": "P2", "what": "进化闭环有决策但经验长期不更新",
                   "why": f"最新决策比最新经验新 {(mt - em) / 3600:.0f} 小时——"
                          "Learn 那一环可能已经空转（学不到东西却没人知道）",
                   "fix": "查 learner 是否覆盖得到当前的失败类型",
                   "action": None}
