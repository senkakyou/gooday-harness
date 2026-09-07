#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""workflows/<名字> 的入口。由 cron 按 deploy/schedule.cron 调起。

【本文件是模板】。和 services/ 的区别：workflow 是**跑完就退出**的批处理，
不是常驻进程。所以它不写心跳，但必须能【幂等续跑】。

    cp -r workflows/_template workflows/<名字>
"""
import json
import os
import sys
import time

NAME = os.path.basename(os.path.dirname(os.path.abspath(__file__)))

# 铁律 G01：状态在 /var/lib，产物在 /srv，都不在仓库内
STATE_DIR = f"/var/lib/gooday-harness/state/{NAME}"
MEDIA_DIR = f"/srv/gooday-harness/media/{NAME}"
PROGRESS = os.path.join(STATE_DIR, "progress.json")


def log(msg):
    print(f"[{NAME}] {time.strftime('%F %T')} {msg}", flush=True)


def load_progress():
    """铁律：进度落盘，中断后能续跑。

    批处理最容易犯的错是「从头再来」——重跑一次就重复产出一次，
    或者把已完成的覆盖掉。进度必须是持久化的，不是内存里的循环变量。
    """
    try:
        with open(PROGRESS) as f:
            return json.load(f)
    except Exception:
        return {"done": []}


def save_progress(p):
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = PROGRESS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(p, f, ensure_ascii=False)
    os.replace(tmp, PROGRESS)      # 原子替换，防写一半被打断留下坏文件


def items_to_do(progress):
    """本产线这一轮要处理什么。改这里。"""
    raise NotImplementedError


def process(item):
    """处理一项。产物写 MEDIA_DIR，不写进仓库。改这里。"""
    raise NotImplementedError


def is_infrastructure_dead(err):
    """铁律：必须能区分「该等」和「该换」。

    外部依赖失败时，「被限流」和「服务/资源已下线」表现可以完全一样
    （都是返回空、都是报同一个错），但处理方式相反：限流要退避重试，
    下线要换一个——**等一个永远不会来的窗口是最贵的失败方式**。

    真实事故：某个 TTS 音色被下线，43 段永久返 0 字节，
    而重试逻辑把「整轮 0 新增」一律当成限流、无限长退避，空转近一小时。
    对策：连续 N 轮 0 产出时，主动探活一个已知可用的资源——
    它能出结果 = 端点正常 = 是我方配置死了，应当报错退出而非继续等。
    """
    raise NotImplementedError("按本产线的外部依赖实现探活")


def main():
    os.makedirs(MEDIA_DIR, exist_ok=True)
    progress = load_progress()
    done = set(progress.get("done", []))

    todo = [i for i in items_to_do(progress) if i not in done]
    if not todo:
        log("本轮无待处理项")
        return 0

    ok = 0
    for item in todo:
        try:
            process(item)
            done.add(item)
            progress["done"] = sorted(done)
            save_progress(progress)      # 每完成一项就落盘，不攒到最后
            ok += 1
        except Exception as e:
            log(f"处理 {item} 失败: {e}")

    log(f"本轮完成 {ok}/{len(todo)}")
    # 全军覆没时以非零退出，让 cron 日志和巡检能发现
    return 0 if ok else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log(f"致命错误: {e}")
        sys.exit(1)
