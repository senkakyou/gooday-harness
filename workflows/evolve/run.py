#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把注册的进化闭环各跑一轮。cron 每天调起。

为什么要有这个 workflow：
闭环引擎（packages/evolve）只负责【怎么转】，不该各自去管【什么时候转】——
那样每接一个闭环就要加一条 cron，迟早有人忘。

而如果没有任何东西自动跑它们，`packages/evolve` 就是又一个
「存在但不生效」的东西——和「注入条款写进文档三个月没进 prompt」
是同一个形状（policies G17）。这正是本项目要消灭的形态。

闭环从 `evolution/loops/*/` 递归发现，每个成员导出 `build()` 返回一个 Loop。
**接新闭环 = 丢一个目录进去，不改本文件**（G06 扩展点契约）。
"""
import importlib.util
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages", "trace"))
sys.path.insert(0, os.path.join(REPO, "packages", "evolve"))

from trace import Task                                    # noqa: E402

LOOPS_DIR = os.path.join(REPO, "evolution", "loops")


def load_loops():
    """发现 evolution/loops/*/loop_def.py，返回 [(name, build)]。"""
    out = []
    if not os.path.isdir(LOOPS_DIR):
        return out
    for name in sorted(os.listdir(LOOPS_DIR)):
        if name.startswith((".", "_")):
            continue
        p = os.path.join(LOOPS_DIR, name, "loop_def.py")
        if not os.path.isfile(p):
            continue
        try:
            spec = importlib.util.spec_from_file_location(f"loop_{name}", p)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
        except Exception as e:
            out.append((name, e))            # 加载失败也要登记，不能静默漏掉
            continue
        out.append((name, getattr(mod, "build", None)))
    return out


def main():
    loops = load_loops()
    if not loops:
        # 【一个都没有 ≠ 一切正常】。没有注册闭环时说清楚，
        # 否则「装了但没接任何闭环」会表现成每天安静地成功。
        print("[evolve] evolution/loops/ 下没有任何闭环——"
              "闭环引擎装了但没有接任何东西", file=sys.stderr)
        return 2

    with Task("evolve", actor="evolve") as task:
        ran, failed = [], []
        for name, build in loops:
            if isinstance(build, Exception):
                failed.append(name)
                task.event("loop_load_failed", "P1",
                           {"loop": name, "error": str(build)})
                print(f"[evolve] {name} 加载失败: {build}", file=sys.stderr)
                continue
            if build is None:
                failed.append(name)
                task.event("loop_contract_violation", "P1",
                           {"loop": name, "why": "loop_def.py 没有 build()"})
                print(f"[evolve] {name} 缺 build()", file=sys.stderr)
                continue
            try:
                outcome = build().cycle(task=task)
                ran.append(name)
                # promote/no_change_needed 是好结果；其余都值得看一眼。
                # rolled_back 单独提到 P0——它意味着真身上确实变差过。
                lvl = ("P3" if outcome.ok else
                       "P0" if outcome.status == "rolled_back" else "P2")
                task.event(f"loop:{name}", lvl,
                           {"phase": outcome.phase, "status": outcome.status,
                            "detail": outcome.detail})
                print(f"[evolve] {name}: {outcome.phase}:{outcome.status}")
            except Exception as e:
                failed.append(name)
                task.event("loop_crashed", "P1",
                           {"loop": name, "error": str(e),
                            "traceback": traceback.format_exc()[-1200:]})
                print(f"[evolve] {name} 崩了: {e}", file=sys.stderr)

        task.event("evolve_summary", "P3", {"ran": ran, "failed": failed})
        print(f"[evolve] 跑了 {len(ran)} 个闭环"
              + (f"，{len(failed)} 个失败: {failed}" if failed else ""))
        return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"[evolve] 致命错误: {e}", file=sys.stderr)
        sys.exit(1)
