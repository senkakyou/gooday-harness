#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""trace —— 写 Task / Event / Checkpoint 的最小库。

policies G07 要求任何自动行为留下六样痕。本库负责其中三样：

    Task        这次要干什么           /var/lib/gooday-harness/tasks/
    Event       过程中发生了什么        /var/lib/gooday-harness/events/
    Checkpoint  改之前的可回滚点        /var/lib/gooday-harness/checkpoints/

另外三样：Evidence 与 Evaluation 由 evolution/evaluators/ 写，
Decision 由人写进 docs/decisions/。

═══ 一个必须讲清楚的设计矛盾 ═══════════════════════════════════════

追踪库写失败时该怎么办？

  抛异常 → 打断调用方的业务逻辑。「记录失败」不该让「干活失败」。
  静默吞 → 违反本项目最核心的原则，而且是最坏的那种违反：
           你会以为有证据，实际什么都没有——凭据失效三周无人发现就是这个形状。

本库的取舍：**不抛异常，但绝不静默。**

  1. 失败时往 stderr 打一行（systemd 会落进 /var/log/gooday-harness/）
  2. 同时在 tasks/ 旁写一个 .trace-failure 标记文件
  3. 巡检看到标记就告警

也就是说：**失败是可见的，但不会连累业务**。
选这条路是因为「记录」是旁路，不是主干；但旁路坏了必须有人知道。

═══ 用法 ═══════════════════════════════════════════════════════════

    from trace import Task

    with Task("deliver-ticket", subject="GD-20260907-003") as t:
        t.event("analysis_done", level="P3")
        ...
        t.event("delivered", level="P2", payload={"files": 3})
    # 正常结束自动记 status=ok；抛异常则自动记 status=failed 并带上异常信息
"""
import json
import os
import shutil
import socket
import sys
import time
import traceback
import uuid

ROOT = os.environ.get("GOODAY_HARNESS_STATE", "/var/lib/gooday-harness")
TASK_DIR = os.path.join(ROOT, "tasks")
EVENT_DIR = os.path.join(ROOT, "events")
CKPT_DIR = os.path.join(ROOT, "checkpoints")
FAILURE_MARK = os.path.join(ROOT, ".trace-failure")

LEVELS = ("P0", "P1", "P2", "P3")


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _degrade(what, exc):
    """写不进去时：喊一声 + 留标记，但不抛。见文件头的设计矛盾说明。"""
    msg = f"[trace] ⚠️ {what} 写入失败: {type(exc).__name__}: {exc}"
    print(msg, file=sys.stderr, flush=True)
    try:
        os.makedirs(ROOT, exist_ok=True)
        with open(FAILURE_MARK, "a", encoding="utf-8") as f:
            f.write(f"{_now()} {msg}\n")
    except Exception:
        pass          # 标记都写不了，只剩 stderr 那一行了


def _write_atomic(path, text):
    """原子写：先写 .tmp 再 rename。防进程被杀时留下半截 JSON。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


class Task:
    """一次可追溯的行为。用 with 语句包住要追踪的工作。"""

    def __init__(self, kind, subject="", actor="", **meta):
        self.id = f"{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}-{uuid.uuid4().hex[:8]}"
        self.kind = kind
        self.subject = subject
        self.actor = actor or os.environ.get("GOODAY_ACTOR", os.path.basename(sys.argv[0]))
        self.meta = meta
        self.started = _now()
        self.status = "running"
        self._events = 0

    # ── Task ────────────────────────────────────────────────────
    def _save(self, **extra):
        rec = {
            "id": self.id, "kind": self.kind, "subject": self.subject,
            "actor": self.actor, "host": socket.gethostname(),
            "started": self.started, "status": self.status,
            "events": self._events, "meta": self.meta,
        }
        rec.update(extra)
        try:
            _write_atomic(os.path.join(TASK_DIR, f"{self.id}.json"),
                          json.dumps(rec, ensure_ascii=False, indent=2))
        except Exception as e:
            _degrade("Task", e)

    # ── Event ───────────────────────────────────────────────────
    def event(self, type_, level="P3", payload=None):
        """记一条事件。level 见 policies 的四级分级（P0 紧急 … P3 流水账）。"""
        if level not in LEVELS:
            level = "P3"
        self._events += 1
        rec = {"at": _now(), "task": self.id, "type": type_,
               "level": level, "actor": self.actor, "payload": payload or {}}
        try:
            # 事件量大，按天追加 JSONL；单条 JSON 一行，坏一行不影响其余
            os.makedirs(EVENT_DIR, exist_ok=True)
            day = rec["at"][:10]
            path = os.path.join(EVENT_DIR, f"{day}.jsonl")
            # 【当天第一个写的人决定这个文件的权限，而写它的身份不止一个】。
            #
            # 2026-09-08 实测：root cron 在 00:38 先建了当天文件（0644），
            # 于是 agent 侧的工作流一整天都 PermissionError ——
            # **每天 0 点复发一次**，而且是那种「系统看起来一切正常」的形态。
            # （这次是 trace 自己响亮降级 + 门禁 G07 抓到的，不是人发现的。）
            #
            # 所以新建时就放开同组写；root 与 agent 都在能写这个目录的位置上。
            new = not os.path.exists(path)
            with open(path, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            if new:
                try:
                    os.chmod(path, 0o664)
                except OSError:
                    pass          # 改不动权限不该让写事件本身失败
        except Exception as e:
            _degrade("Event", e)
        return rec

    # ── Checkpoint ──────────────────────────────────────────────
    def checkpoint(self, name, paths):
        """把 paths 复制到回滚点。返回回滚点目录。

        ⚠️ 数据库文件不要直接丢进来——WAL 模式下直接复制会丢最近写入（policies G14）。
        先 `PRAGMA wal_checkpoint(FULL);` 再传路径。
        """
        d = os.path.join(CKPT_DIR, f"{self.id}-{name}")
        try:
            os.makedirs(d, exist_ok=True)
            for p in ([paths] if isinstance(paths, str) else paths):
                if os.path.isdir(p):
                    shutil.copytree(p, os.path.join(d, os.path.basename(p)),
                                    dirs_exist_ok=True)
                elif os.path.exists(p):
                    shutil.copy2(p, d)
            self.event("checkpoint_created", "P3", {"dir": d})
        except Exception as e:
            _degrade("Checkpoint", e)
        return d

    # ── with 语句 ───────────────────────────────────────────────
    def __enter__(self):
        self._save()
        self.event("task_started", "P3", {"kind": self.kind, "subject": self.subject})
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.status = "ok"
            self._save(finished=_now())
            self.event("task_finished", "P3")
        else:
            # 失败必须留痕，而且要带原因——「失败了但不知道为什么」等于没记
            self.status = "failed"
            self._save(finished=_now(),
                       error=f"{exc_type.__name__}: {exc}",
                       traceback="".join(traceback.format_exception(exc_type, exc, tb))[-2000:])
            self.event("task_failed", "P1", {"error": f"{exc_type.__name__}: {exc}"})
        return False        # 不吞异常，原样往上抛
