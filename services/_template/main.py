#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""services/<名字> 的入口。

【本文件是模板】。复制后按本服务的实际职责改写，但**下面标了「铁律」的部分不要删**——
每一条都对应一次真实事故，删掉它们这个服务迟早会以同样的方式坏掉。

    cp -r services/_template services/<名字>
"""
import os
import signal
import subprocess
import sys
import time

NAME = os.path.basename(os.path.dirname(os.path.abspath(__file__)))

# 铁律 G01：状态和日志一律在仓库外。别往本目录写任何运行期文件。
STATE_DIR = f"/var/lib/gooday-harness/state/{NAME}"
HEARTBEAT = os.path.join(STATE_DIR, "heartbeat")

POLL_INTERVAL = 3


def log(msg):
    """日志走 stdout，由 systemd 落到 /var/log/gooday-harness/<名>.log。"""
    print(f"[{NAME}] {time.strftime('%F %T')} {msg}", flush=True)


def heartbeat():
    """铁律：每轮循环都写心跳。

    systemd 的 Restart 只管进程崩溃，管不了「活着但卡死」——
    进程卡在一个永不返回的调用里时，systemd 显示的是 active (running)。
    历史上 bot 卡死 8 次，全程绿色，无人发现。巡检靠这个文件的 mtime 判活。
    """
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(HEARTBEAT, "w") as f:
            f.write(str(int(time.time())))
    except Exception as e:
        log(f"心跳写入失败: {e}")


def run_subprocess(cmd, stdin_text="", timeout=300):
    """铁律：子进程必须 start_new_session + 超时 killpg 整组杀。

    subprocess.run(timeout=) 只杀直接子进程，它派生的孙进程会变成孤儿继续吃内存，
    小内存机器会被拖死。start_new_session 让子进程独立成进程组，killpg 才能整组带走。
    """
    proc = subprocess.Popen(
        cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        start_new_session=True, text=True)
    try:
        out, err = proc.communicate(input=stdin_text, timeout=timeout)
        return proc.returncode, out, err
    except subprocess.TimeoutExpired:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        proc.communicate()
        log(f"⚠️ 子进程超时 {timeout}s，已整组杀")
        return -1, "", "timeout"


def do_work():
    """本服务真正干的事。改这里。

    铁律：处理失败必须给出【明确回执】，绝不静默吞掉。
    历史上 8 次超时异常全部表现为「发消息没人理」，用户完全不知道发生了什么。
    """
    raise NotImplementedError("照本服务职责实现；别忘了失败要有回执")


def main():
    log(f"启动")
    while True:
        heartbeat()                      # 铁律：每轮都写，放在最前面
        try:
            do_work()
        except Exception as e:
            # 主循环永不退出：单次失败不该让整个服务躺下
            log(f"本轮异常: {e}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        log(f"致命错误: {e}")
        # 铁律：必须 exit(1) 而非 return。
        # unit 里是 Restart=always，但脚本「正常」退出(return 0)时
        # systemd 会认为它完成了使命，不重启也不告警——服务就静静躺平了。
        sys.exit(1)
