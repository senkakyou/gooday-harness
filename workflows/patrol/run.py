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

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages", "trace"))

from trace import Task                                    # noqa: E402

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
                    task.event(f"finding:{name}", f.get("level", "P3"),
                               {k: f.get(k) for k in ("what", "why", "fix")})
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
        SAFE_VERBS = {"systemctl": {"restart", "start", "reset-failed"},
                      "chown": None, "chmod": None}
        def _is_reversible(cmd):
            if not cmd:
                return False
            head = os.path.basename(str(cmd[0]))
            if head not in SAFE_VERBS:
                return False
            allowed = SAFE_VERBS[head]
            return allowed is None or (len(cmd) > 1 and cmd[1] in allowed)

        acted = []
        for f in findings:
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
            try:
                subprocess.run(act, capture_output=True, timeout=60, check=True)
                acted.append(act)
                task.event("action_taken", "P2", {"check": f["check"], "ran": act})
            except Exception as e:
                task.event("action_failed", "P1",
                           {"check": f["check"], "ran": act, "error": str(e)})

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
