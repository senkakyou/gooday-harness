#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""调大模型。所有 bot 共用的那一层。

本文件是 5 个 bot 的共同底座，也是本项目最多血泪教训汇集的地方。
每一段带「铁律」的代码后面都写了换来它的那次失败——**删之前先看那段**。

四条铁律：

1. **Popen + start_new_session + killpg 整组杀**
   `subprocess.run(timeout=)` 只杀直接子进程，它派生的孙进程会变孤儿继续
   吃内存。2G 机器会被拖死。

2. **显式传 --model**
   默认模型一旦被平台下线，全线调用报错，表现是「bot 能收消息但回不了」。
   只靠环境变量传播实测不可靠。

3. **并发闸门**
   同时跑的模型调用数受限（默认 3）。不控的话，几个 bot 同时被触发就会
   把 2G 机器打爆。**闸门自己坏掉时宁可放行**——辅助设施不该阻断主流程。

4. **区分「基础设施坏了」和「模型说了不该说的」**
   前者要给用户明确回执并上报，后者是业务问题。混在一起时，
   凭据失效会表现成「AI 今天有点笨」，没人会去查凭据。
"""
import os
import signal
import sqlite3
import subprocess
import sys
import time

STATE = os.environ.get("GOODAY_HARNESS_STATE", "/var/lib/gooday-harness")
SLOTS_DB = os.path.join(STATE, "state", "model-slots.db")

DEFAULT_MAX_CONCURRENCY = 3
MEM_FLOOR_MB = 400            # 可用内存低于此值视同满载（2G 机器的细闸）
SLOT_RETRY_SEC = 5
SLOT_WAIT_MAX = 15 * 60       # 排队最长 15 分钟，超过放弃本次调用

# 基础设施类错误：绝不能把原文当回复发给用户
_INFRA_PAT = ("failed to authenticate", "oauth session expired", "not logged in",
              "invalid api key", "unauthorized", "please run /login",
              "credit balance", "rate limit")

INFRA_REPLY = ("⚠️ 我这边暂时调不动模型（登录凭据或额度问题），这条没能处理。"
               "已上报，请稍后重试。")


def log(tag, msg):
    print(f"[{tag}] {time.strftime('%F %T')} {msg}", flush=True)


# ────────────────────────── 并发闸门 ──────────────────────────

def _slots_conn():
    os.makedirs(os.path.dirname(SLOTS_DB), exist_ok=True)
    conn = sqlite3.connect(SLOTS_DB, timeout=10)
    conn.execute("CREATE TABLE IF NOT EXISTS slots("
                 "id INTEGER PRIMARY KEY AUTOINCREMENT, holder TEXT, "
                 "acquired_at REAL, timeout_at REAL)")
    conn.execute("CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT)")
    return conn


def _pid_alive(holder):
    try:
        pid = int(str(holder).rsplit(":", 1)[-1])
        os.kill(pid, 0)
        return True
    except Exception:
        return False


def _mem_available_mb():
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) / 1024
    except Exception:
        pass
    return 10 ** 6            # 读不到就当充足，别因为读不到内存而阻断


def _max_concurrency(conn):
    try:
        r = conn.execute("SELECT v FROM settings WHERE k='max_concurrency'").fetchone()
        return int(r[0]) if r else DEFAULT_MAX_CONCURRENCY
    except Exception:
        return DEFAULT_MAX_CONCURRENCY


def _acquire(tag, lease):
    """单事务原子取槽。成功返回 holder，满载返回 None。

    ⚠️ 闸门自己出故障时【返回 holder（放行）】而不是 None（阻断）。
    信号量是辅助设施，它坏了不该让整个系统停摆——
    宁可冒一次超载的风险，也不要让一个附属组件变成新的单点。
    """
    holder = f"{tag}:{os.getpid()}"
    try:
        conn = _slots_conn()
    except Exception as e:
        log(tag, f"并发槽位库不可用，降级直接执行: {e}")
        return holder
    try:
        now = time.time()
        conn.execute("BEGIN IMMEDIATE")
        # 清僵尸：租约超时，或持有者进程已死（被 kill -9 时不会释放）
        for sid, h, t_at in conn.execute(
                "SELECT id, holder, timeout_at FROM slots").fetchall():
            if (t_at and t_at < now) or not _pid_alive(h):
                conn.execute("DELETE FROM slots WHERE id=?", (sid,))
        # 内存细闸：可用内存过低视同满载
        if _mem_available_mb() < MEM_FLOOR_MB:
            conn.execute("ROLLBACK")
            return None
        if conn.execute("SELECT COUNT(*) FROM slots").fetchone()[0] < _max_concurrency(conn):
            conn.execute("INSERT INTO slots(holder, acquired_at, timeout_at) "
                         "VALUES(?,?,?)", (holder, now, now + lease))
            conn.execute("COMMIT")
            return holder
        conn.execute("COMMIT")
        return None
    except Exception as e:
        try:
            conn.execute("ROLLBACK")
        except Exception:
            pass
        log(tag, f"取槽异常，降级直接执行: {e}")
        return holder
    finally:
        conn.close()


def _release(holder):
    try:
        conn = _slots_conn()
        conn.execute("DELETE FROM slots WHERE holder=?", (holder,))
        conn.commit()
        conn.close()
    except Exception:
        pass          # 释放失败无所谓：僵尸清理会兜底


# ────────────────────────── 错误分类 ──────────────────────────

def is_infra_error(text, rc=None):
    """是不是基础设施问题（凭据/额度/未登录），而不是模型的业务输出。

    分不清的后果：凭据失效会表现成「AI 今天有点笨」，
    没有人会想到去查凭据——旧系统真的因此瞎了三周。
    """
    low = (text or "").lower()
    return (rc not in (0, None) or not text) and any(k in low for k in _INFRA_PAT)


# ────────────────────────── 主入口 ──────────────────────────

def call(prompt, system, *, tag="bot", model=None, timeout=300,
         extra_args=None, stdin_json=None):
    """调模型。返回 (text, ok, err)。

    ok=False 且 is_infra_error(err) 为真时，调用方【必须给用户明确回执】，
    不能静默失败——历史上 8 次超时异常全部表现为「发消息没人理」。
    """
    model = model or os.environ.get("HARNESS_MODEL", "opus")
    holder, waited = None, 0
    while holder is None:
        holder = _acquire(tag, lease=timeout + 60)
        if holder:
            break
        if waited >= SLOT_WAIT_MAX:
            return "", False, f"排队超过 {SLOT_WAIT_MAX//60} 分钟仍拿不到并发槽位"
        time.sleep(SLOT_RETRY_SEC)
        waited += SLOT_RETRY_SEC

    try:
        cmd = ["claude", "-p", "--model", model]      # 铁律 2：显式传
        if system:
            cmd += ["--system-prompt", system]
        if extra_args:
            cmd += list(extra_args)

        # 铁律 1：start_new_session 让子进程独立成进程组，killpg 才能整组带走
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, start_new_session=True,
                                text=True)
        try:
            out, err = proc.communicate(
                input=stdin_json if stdin_json is not None else prompt,
                timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            proc.communicate()
            return "", False, f"模型调用超时 {timeout}s，已整组终止"

        if proc.returncode != 0 or not out.strip():
            return "", False, (err or "").strip()[:500] or f"退出码 {proc.returncode}"
        return out, True, ""
    finally:
        _release(holder)
