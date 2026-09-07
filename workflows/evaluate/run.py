#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""跑所有评价器。cron 每天调起一次。

为什么要有这个 workflow：
评价器只负责【怎么打分】，不该各自去管【什么时候跑】——
那样每加一个评价器就要加一条 cron，迟早有人忘。

而如果没有任何东西自动跑它们，评价器就是又一个「存在但不生效」的东西，
和「注入条款写进文档三个月没进 prompt」是同一个形状（policies G17）。

每轮 = 一个 Task，每个评价器的结果 = 一个 Event。
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages", "trace"))

from trace import Task                                    # noqa: E402

EVALUATORS = os.path.join(REPO, "evolution", "evaluators")


def main():
    if not os.path.isdir(EVALUATORS):
        print("[evaluate] 没有 evolution/evaluators 目录", file=sys.stderr)
        return 2

    with Task("evaluate", actor="evaluate") as task:
        ran, failed = [], []
        for name in sorted(os.listdir(EVALUATORS)):
            if name.startswith("_"):
                continue
            script = os.path.join(EVALUATORS, name, "evaluate.py")
            if not os.path.isfile(script):
                # 评价器没有执行体也要报——目录建了但没实现，等于没有
                failed.append(name)
                task.event("evaluator_missing_script", "P1", {"evaluator": name})
                continue
            try:
                r = subprocess.run([sys.executable, script], cwd=os.path.dirname(script),
                                   capture_output=True, text=True, timeout=300)
                out = (r.stdout or "").strip()
                # 退出码非 0 = 判了 warn/fail，不是"跑失败"——两者要分清
                task.event(f"evaluated:{name}", "P2" if r.returncode else "P3",
                           {"exit": r.returncode, "output": out[-800:]})
                ran.append(name)
                print(out or f"[evaluate] {name} 无输出")
            except Exception as e:
                failed.append(name)
                task.event("evaluator_crashed", "P1",
                           {"evaluator": name, "error": str(e)})
                print(f"[evaluate] {name} 崩了: {e}", file=sys.stderr)

        task.event("evaluate_summary", "P3", {"ran": ran, "failed": failed})
        print(f"[evaluate] 跑了 {len(ran)} 个评价器"
              + (f"，{len(failed)} 个失败: {failed}" if failed else ""))

        # 【一个都没有 ≠ 一切正常】。2026-09-07 归档掉唯一那个已结案的评价器
        # 之后，本工作流每天照跑一次、什么也不评、退出码 0 ——
        # 「配置了但没在起作用」正是本项目反复栽的那类坑，
        # 而它此刻长得和「评价器全部通过」一模一样。
        if not ran and not failed:
            task.event("no_evaluators", "P2",
                       {"why": "evolution/evaluators/ 下没有任何成员，本工作流在空转"})
            print("[evaluate] ⚠️ 一个评价器都没有 —— 本工作流在空转。"
                  "第二层循环缺了「怎么打分」这一环",
                  file=sys.stderr)
            return 1
        return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"[evaluate] 致命错误: {e}", file=sys.stderr)
        sys.exit(1)
