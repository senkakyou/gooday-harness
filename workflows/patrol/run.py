#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""巡检入口。cron 每 5 分钟调起，跑完退出。

设计上和旧 patrol（707 行单文件、目标全写死）的三点不同：

1. **一个巡检项一个文件**，`checks/` 下递归发现——新增巡检不用改本文件（G06）。
2. **目标走配置**，不写死。迁移期指向旧系统，切换后改配置即可。
3. **默认影子模式**：只观察不处置。
   迁移期新旧两个 patrol 同时跑，两个看门狗抢着重启同一个服务会互相打架
   （一个正在重启、另一个判定它没起来又重启一次）。
   影子模式让新的先证明「判断和旧的一致」，再谈接管。

每轮巡检 = 一个 Task，每个发现 = 一个 Event（G07 证据链）。
"""
import importlib.util
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages", "trace"))
sys.path.insert(0, os.path.join(REPO, "packages", "finding"))

from trace import Task                                    # noqa: E402
import finding as fnd                                     # noqa: E402

STATE = os.environ.get("GOODAY_HARNESS_STATE", "/var/lib/gooday-harness")
CHECKS_DIR = os.path.join(HERE, "checks")
CONFIG = os.path.join(HERE, "config.json")
TRACE_ROOT = os.environ.get("GOODAY_HARNESS_STATE", "/var/lib/gooday-harness")


def _trace_alive(task):
    """本轮的 Task 文件到底落盘了没有。落不了就说明证据链是断的。"""
    return os.path.exists(os.path.join(TRACE_ROOT, "tasks", f"{task.id}.json"))


def load_config():
    if not os.path.exists(CONFIG):
        print(f"[patrol] 缺 {CONFIG}，从 config.example.json 拷一份改", file=sys.stderr)
        sys.exit(2)
    with open(CONFIG, encoding="utf-8") as f:
        return {k: v for k, v in json.load(f).items() if not k.startswith("_")}


def load_checks():
    """递归发现巡检项。新增一个 .py 就自动生效，不用改本文件。"""
    out = []
    for fn in sorted(os.listdir(CHECKS_DIR)):
        if not fn.endswith(".py") or fn.startswith("_"):
            continue
        p = os.path.join(CHECKS_DIR, fn)
        spec = importlib.util.spec_from_file_location(fn[:-3], p)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
        except Exception as e:
            out.append((fn, e))          # 加载失败也要报，不能悄悄少跑一项
            continue
        out.append((getattr(mod, "NAME", fn[:-3]), mod))
    return out


def main():
    cfg = load_config()
    shadow = cfg.get("mode", "shadow") != "active"

    with Task("patrol", subject=cfg.get("mode", "shadow"), actor="patrol") as task:
        findings, failed_checks = [], []
        # 处置规则表外置在 ops/dispositions.json：由发现方自己打标，
        # 等于把「什么该人管」的判断权交给发现方，标错了就静默漏掉。
        disp_rules, disp_default, disp_err = fnd.load_table()
        unknown_kinds = set()
        agg = fnd.Aggregator("patrol",
                             window_min=cfg.get("finding_window_min", 60))
        if disp_err:
            task.event("disposition_table_unreadable", "P1", {"error": disp_err})

        for name, mod in load_checks():
            if isinstance(mod, Exception):
                failed_checks.append(name)
                task.event("check_load_failed", "P1",
                           {"check": name, "error": str(mod)})
                continue
            try:
                for f in (mod.run(cfg) or []):
                    f["check"] = name
                    findings.append(f)

                    kind = f"finding:{name}"
                    disp, known = fnd.classify(kind, disp_rules, disp_default)
                    f["_disposition"] = disp
                    if not known:
                        unknown_kinds.add(kind)

                    # 【同指纹在窗口内合并】。实测：334 条 finding 只有 60 个
                    # 不同指纹，重复最多的一条出现 87 次（同一个 P0 每 5 分钟
                    # 报一次直到修掉）。不聚合的话 events/ 自己会变成噪音源，
                    # patrol 反而更瞎（灵犀 2026-09-08）。
                    fresh, n = agg.see(f)
                    if fresh:
                        task.event(kind, f.get("level", "P3"),
                                   dict({k: f.get(k) for k in ("what", "why", "fix")},
                                        disposition=disp))
            except Exception as e:
                # 一项挂掉不能让整轮停摆，但【必须留痕】——
                # 悄悄少跑一项，等于那块永远不会被巡检到
                failed_checks.append(name)
                task.event("check_crashed", "P1", {"check": name, "error": str(e)})

        # ═══ 处置：按【动作性质】分级，不做 shadow/active 二元 ═══════
        #
        # 迁移期 shadow 是对的：旧 patrol 在动手，两个看门狗抢着重启同一服务
        # 是灾难。但**旧的退役之后，shadow 就是净损失** ——
        # 发现 P0 也没人处置，而你还以为有看门狗（灵犀 2026-09-07 指出）。
        #
        # 二元开关的问题是：一开就全开。所以改成按动作分级：
        #   · 幂等、可回滚、影响面单一（重启一个服务、修一个文件属主）
        #     → active 模式下放开
        #   · 删文件、改数据库、下架内容
        #     → **永远只记录不执行**，无论什么模式。这类动作出错没得救，
        #       而看门狗最不该做的就是在错误诊断上自信地动手。
        #
        # 判断依据是动作本身的形状，不是「谁声明的」——
        # 新增检查项的人可能没想过这一层，白名单必须在执行处兜住。
        # 【动词和宾语都要兜住】。原来 chown/chmd 的允许参数写成 None
        # = 任意参数任意路径，`["chown","-R","x:x","/"]` 能过；
        # systemctl restart 也能重启任意 unit（灵犀 2026-09-07 指出）。
        # 宾语必须限定在 config 里【已声明】的对象上 ——
        # 检查项作者能写出什么动作是开放的，能作用于什么对象不该是。
        SAFE_VERBS = {"systemctl": {"restart", "start", "reset-failed"},
                      "chown": None, "chmod": None}
        known_units = {s_.get("unit") for s_ in cfg.get("services", []) if s_.get("unit")}
        known_paths = {c_.get("path") for c_ in cfg.get("credentials", []) if c_.get("path")}

        def _is_reversible(cmd):
            if not cmd:
                return False
            head = os.path.basename(str(cmd[0]))
            if head not in SAFE_VERBS:
                return False
            allowed = SAFE_VERBS[head]
            if allowed is not None and not (len(cmd) > 1 and cmd[1] in allowed):
                return False
            # 宾语校验
            if head == "systemctl":
                return len(cmd) > 2 and cmd[2] in known_units
            return any(str(a) in known_paths for a in cmd[1:])

        # 【退避 + 自愈无效要升级】。原来没有：崩溃循环的服务每 5 分钟重启一次，
        # 每次都是 action_taken P2、退出 0 —— **一天 288 次自愈成功，
        # 长得和「一切正常」一模一样**，正是要杀的那种假绿。
        # 旧 coo-patrol 有 dedup() 和「重启后仍无心跳 → P0」，新的漏了。
        ACT_STATE = os.path.join(STATE, "state", "patrol", "actions.json")
        try:
            with open(ACT_STATE, encoding="utf-8") as _f:
                act_hist = json.load(_f)
        except Exception:
            act_hist = {}

        def _act_key(f_, cmd):
            return f"{f_['check']}::{' '.join(map(str, cmd))}"

        def _backoff_ok(key, now):
            """同一动作的退避：1 次后等 10 分钟，3 次后等 1 小时。"""
            h = act_hist.get(key, {})
            n, last = h.get("count", 0), h.get("last", 0)
            wait = 0 if n == 0 else (600 if n < 3 else 3600)
            return (now - last) >= wait, n

        acted = []
        for f in findings:
            # 【退避只管 auto 类】。notify-only 的发现不进退避账本、
            # 不触发自动处置 —— 退避看的不是「事件在不在流里」，
            # 是「这条标没标可自动处置」。混的是存储，不是处置策略。
            if f.get("_disposition") != fnd.AUTO:
                continue
            act = f.get("action")
            if not act:
                continue
            if not _is_reversible(act):
                # 不可逆动作：任何模式下都不自动执行
                task.event("action_needs_human", "P1",
                           {"check": f["check"], "would_run": act,
                            "why": "动作不在可逆白名单内，永不自动执行"})
                continue
            if shadow:
                task.event("action_suppressed", "P3",
                           {"check": f["check"], "would_run": act})
                continue
            key = _act_key(f, act)
            now = time.time()
            ok_to_act, prior = _backoff_ok(key, now)
            if not ok_to_act:
                task.event("action_backoff", "P2",
                           {"check": f["check"], "would_run": act, "prior_attempts": prior,
                            "why": "同一动作已重复多次，退避中——反复自愈说明没治本"})
                continue
            try:
                subprocess.run(act, capture_output=True, timeout=60, check=True)
                acted.append(act)
                act_hist[key] = {"count": prior + 1, "last": now}
                # 【反复成功比失败更值得警惕】：修好了就不该再修一次
                lvl = "P2" if prior < 2 else "P1"
                task.event("action_taken", lvl,
                           {"check": f["check"], "ran": act, "attempt": prior + 1,
                            "why": ("第 %d 次对同一目标动手——自愈没治本，"
                                    "该查根因了" % (prior + 1)) if prior >= 2 else None})
            except Exception as e:
                act_hist[key] = {"count": prior + 1, "last": now}
                task.event("action_failed", "P1",
                           {"check": f["check"], "ran": act, "error": str(e)})

        # 不在规则表里的 kind 单独报 —— 否则「外置可审」会退化成
        # 「外置但没人维护」：新加的检查项一直按默认 notify-only 走，
        # 而没有任何东西提醒有人去给它定处置策略。
        if unknown_kinds:
            task.event("disposition_unknown_kind", "P2",
                       {"kinds": sorted(unknown_kinds),
                        "why": "不在 ops/dispositions.json 里，已按 notify-only 处理；"
                               "请去表里给它定策略"})
        # 被聚合压掉的如实交代，别让「压了 80 条」看起来像「只有 1 条」
        sup = agg.suppressed()
        if sup:
            task.event("findings_aggregated", "P3",
                       {"fingerprints": len(sup),
                        "total_suppressed": sum(v["count"] - 1 for v in sup.values())})
        agg.flush()

        # 动作历史落盘：退避要跨轮次才有意义
        try:
            os.makedirs(os.path.dirname(ACT_STATE), exist_ok=True)
            cutoff = time.time() - 7 * 86400
            act_hist = {k: v for k, v in act_hist.items() if v.get("last", 0) > cutoff}
            with open(ACT_STATE, "w", encoding="utf-8") as _f:
                json.dump(act_hist, _f, ensure_ascii=False)
        except Exception as e:
            task.event("action_state_write_failed", "P1", {"error": str(e)})

        # 自检：证据链是不是真的写进去了。
        # 实测踩到：/var/lib 属主是 root 而巡检以别的身份跑，trace 全部 PermissionError。
        # trace 的设计是「不抛异常」，于是 patrol 照常跑完、报「一切正常」、退出 0——
        # 而它这一轮什么都没记下。**这正是本项目要消灭的假绿。**
        # 所以巡检必须把「我自己的记录能力」也当成一项来查。
        if not _trace_alive(task):
            findings.append({
                "check": "self", "level": "P1",
                "what": "证据链写不进去，本轮巡检没有留下任何记录",
                "why": f"{TRACE_ROOT} 下写入失败（权限？磁盘满？）。"
                       f"trace 按设计不抛异常，所以巡检看起来一切正常，实际什么都没记",
                "fix": f"确认 {TRACE_ROOT} 对当前身份可写", "action": None})

        worst = min((f.get("level", "P3") for f in findings), default="P3")
        task.event("patrol_summary", "P3", {
            "findings": len(findings), "worst": worst,
            "acted": len(acted), "failed_checks": failed_checks,
            "mode": "shadow" if shadow else "active",
        })

        mode_s = "影子" if shadow else "生产"
        if not findings and not failed_checks:
            print(f"[patrol/{mode_s}] 一切正常")
        else:
            print(f"[patrol/{mode_s}] {len(findings)} 项发现（最高 {worst}）"
                  f"{'，' + str(len(failed_checks)) + ' 项巡检本身失败' if failed_checks else ''}")
            for f in findings:
                print(f"  [{f.get('level')}] {f['check']}: {f.get('what')}")
                print(f"        凭据: {f.get('why')}")

        # 有 P0/P1 时以非零退出，让 cron 日志和外层监控能察觉
        return 1 if worst in ("P0", "P1") or failed_checks else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"[patrol] 致命错误: {e}", file=sys.stderr)
        sys.exit(1)
