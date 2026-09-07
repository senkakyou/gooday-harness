#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""trace 的自测。零依赖，直接跑：

    python3 packages/trace/test_trace.py

覆盖的是【会真的坏】的路径，不是覆盖率数字：
成功、失败留痕、异常不被吞、写不进去时不连累调用方、原子写。
"""
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

TMP = tempfile.mkdtemp(prefix="trace-test-")
os.environ["GOODAY_HARNESS_STATE"] = TMP
import trace as T                                    # noqa: E402
T.ROOT, T.TASK_DIR = TMP, os.path.join(TMP, "tasks")
T.EVENT_DIR, T.CKPT_DIR = os.path.join(TMP, "events"), os.path.join(TMP, "checkpoints")
T.FAILURE_MARK = os.path.join(TMP, ".trace-failure")

ok, fail = 0, 0


def check(name, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  ✅ {name}")
    else:
        fail += 1
        print(f"  ❌ {name}  {detail}")


def tasks():
    d = T.TASK_DIR
    return [json.load(open(os.path.join(d, f))) for f in sorted(os.listdir(d))] \
        if os.path.isdir(d) else []


def events():
    d = T.EVENT_DIR
    out = []
    if os.path.isdir(d):
        for f in sorted(os.listdir(d)):
            out += [json.loads(l) for l in open(os.path.join(d, f)) if l.strip()]
    return out


print("\n=== 1. 正常完成 ===")
with T.Task("demo", subject="s-1") as t:
    t.event("midway", level="P2", payload={"n": 1})
ts = tasks()
check("Task 落盘", len(ts) == 1, ts)
check("status=ok", ts and ts[0]["status"] == "ok")
check("有 finished 时间", ts and "finished" in ts[0])
evs = events()
check("事件含 started/midway/finished",
      {"task_started", "midway", "task_finished"} <= {e["type"] for e in evs},
      [e["type"] for e in evs])
check("级别按传入记录", any(e["type"] == "midway" and e["level"] == "P2" for e in evs))

print("\n=== 2. 失败必须留痕，且异常不被吞 ===")
raised = False
try:
    with T.Task("will-fail", subject="s-2"):
        raise ValueError("故意炸")
except ValueError:
    raised = True
check("异常原样抛出（没被吞）", raised)
f = [x for x in tasks() if x["kind"] == "will-fail"]
check("失败 Task 落盘 status=failed", f and f[0]["status"] == "failed")
check("带上了异常原因", f and "故意炸" in f[0].get("error", ""))
check("带上了栈", f and f[0].get("traceback"))
check("失败事件是 P1", any(e["type"] == "task_failed" and e["level"] == "P1"
                            for e in events()))

print("\n=== 3. checkpoint ===")
src = os.path.join(TMP, "src")
os.makedirs(src, exist_ok=True)
open(os.path.join(src, "a.txt"), "w").write("hello")
with T.Task("ckpt") as t:
    d = t.checkpoint("before", [os.path.join(src, "a.txt")])
check("回滚点文件已复制", os.path.exists(os.path.join(d, "a.txt")))
check("回滚点写了事件", any(e["type"] == "checkpoint_created" for e in events()))

print("\n=== 4. 写不进去时：不抛、不静默 ===")
# 把根目录换成一个不可写的位置，模拟磁盘满/权限错
T.TASK_DIR = "/proc/nonexistent-cannot-write/tasks"
T.FAILURE_MARK = os.path.join(TMP, ".trace-failure")
survived = True
try:
    with T.Task("degrade") as t:
        t.event("x")
except Exception as e:
    survived = False
    print("     调用方被连累:", e)
check("调用方未被连累（不抛）", survived)
check("留下了失败标记（不静默）", os.path.exists(T.FAILURE_MARK),
      "标记应在 " + T.FAILURE_MARK)

print("\n=== 5. 原子写：不留半截文件 ===")
T.TASK_DIR = os.path.join(TMP, "tasks")
with T.Task("atomic"):
    pass
leftovers = [f for f in os.listdir(T.TASK_DIR) if ".tmp." in f]
check("没有残留 .tmp 文件", not leftovers, leftovers)
check("每个 Task 文件都是合法 JSON", all(isinstance(x, dict) for x in tasks()))

shutil.rmtree(TMP, ignore_errors=True)
print(f"\n{'─'*46}\n通过 {ok} · 失败 {fail}")
sys.exit(1 if fail else 0)
