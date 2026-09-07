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

        # 处置：影子模式只记录，不动手
        acted = []
        for f in findings:
            act = f.get("action")
            if not act:
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
