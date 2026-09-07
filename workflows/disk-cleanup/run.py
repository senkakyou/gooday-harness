#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""磁盘回收。cron 每天调起，跑完退出。

**只清可再生的垃圾。** 每一项都要能回答「删了之后怎么变回来」——
答不上来的就不该在这个列表里。

绝不碰：docker 卷（含线上数据库）、运行中的容器与镜像、备份、源码、
浏览器运行时。这些删了要么丢数据，要么下次跑起来才发现少东西。

从旧 disk-cleanup.sh 重新设计。保留它的清理项与「绝不碰」清单，
补两样它没有的：**清理量留痕**（每次回收了多少，可用于判断是否真在起作用）
和**低水位告警**（清完仍然吃紧时要有人知道）。
"""
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages", "trace"))

from trace import Task                                    # noqa: E402

CONFIG = os.path.join(HERE, "config.json")


def free_bytes(path="/"):
    st = os.statvfs(path)
    return st.f_bavail * st.f_frsize


def _run(cmd, timeout=300):
    """跑一条清理命令。失败不中断整轮——一项清不掉不该让其余都不做。"""
    try:
        r = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True,
                           text=True, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except Exception as e:
        return -1, f"{type(e).__name__}: {e}"


# 每一项都注明「删了怎么变回来」——答不上来的不该在这
ACTIONS = [
    ("docker 构建缓存", "docker builder prune -f", "下次 build 会重建"),
    ("docker 悬空镜像", "docker image prune -f", "仅 dangling，不用 -a，"
                                                 "保留基础镜像加速下次构建"),
    ("journald 旧日志", "journalctl --vacuum-size=200M", "日志本就是滚动的"),
    ("apt 包缓存", "apt-get clean", "下次 apt 会重下"),
    ("pip 中断残留", "rm -rf /tmp/pip-unpack-* /tmp/pip-build-*",
     "pip install 中断留下的，可能几 GB"),
    ("pip 下载缓存", "pip cache purge", "重装时 pypi 重下"),
]


def main():
    cfg = {}
    if os.path.exists(CONFIG):
        with open(CONFIG, encoding="utf-8") as f:
            cfg = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    low_gb = cfg.get("low_water_gb", 5)

    before = free_bytes()
    with Task("disk-cleanup", actor="disk-cleanup") as task:
        task.event("before", "P3", {"free_gb": round(before / 2**30, 2)})

        failed = []
        for name, cmd, _regen in ACTIONS:
            rc, out = _run(cmd)
            reclaimed = ""
            m = re.search(r"reclaimed[^\d]*([\d.]+\s*\w+)", out, re.I) or \
                re.search(r"freed[^\d]*([\d.]+\s*\w+)", out, re.I)
            if m:
                reclaimed = m.group(1)
            if rc != 0:
                failed.append(name)
            task.event(f"cleaned:{name}", "P3",
                       {"rc": rc, "reclaimed": reclaimed, "out": out[-300:]})

        after = free_bytes()
        gained = (after - before) / 2**30
        task.event("after", "P3", {"free_gb": round(after / 2**30, 2),
                                   "gained_gb": round(gained, 2),
                                   "failed": failed})

        print(f"[disk-cleanup] 回收 {gained:.2f} GB，"
              f"现可用 {after/2**30:.1f} GB"
              + (f"，{len(failed)} 项失败: {failed}" if failed else ""))

        # 清完仍吃紧要有人知道——「清理跑了」不等于「空间够了」
        if after / 2**30 < low_gb:
            task.event("low_disk", "P1",
                       {"free_gb": round(after / 2**30, 2), "threshold_gb": low_gb})
            print(f"[disk-cleanup] ⚠️ 清理后仍只剩 {after/2**30:.1f} GB"
                  f"（阈值 {low_gb} GB）——可再生的垃圾已清完，"
                  f"占地的是真东西，需要人来判断删什么")
            return 1
        return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"[disk-cleanup] 致命错误: {e}", file=sys.stderr)
        sys.exit(1)
