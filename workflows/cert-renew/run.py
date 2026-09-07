#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TLS 证书续期。cron 每天调起。

换来这个脚本的事故：源证书由 certbot 签发但**从无定时续期**，
月中静默过期 —— nginx 443 和 xray 555 共用同一张证书，一起爆。
证书过期是最典型的「安静地烂掉」：没有任何东西会报错，
直到某天所有人的浏览器同时开始报警。

从旧 cert-renew-agent.sh 重新设计。保留：
- **webroot 验证**（nginx 已配 /.well-known/acme-challenge），不抢 80 口
- `certbot renew` 只在 <30 天时真续，否则空跑；每日跑是标准做法
- 续完 **reload nginx**（graceful，无停机；nginx 直读 live 软链）

补两样旧脚本没有的：
- **续期前后读一次实际到期日**，据此判断这次到底有没有续成
  （旧脚本只看 certbot 退出码，而 certbot 空跑也返回 0——
   于是「续期失败」和「还没到该续的时候」长得一模一样）
- **到期临近仍未续成时报 P0**
"""
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages", "trace"))

from trace import Task                                    # noqa: E402

CONFIG = os.path.join(HERE, "config.json")


def days_left(host, port, sni):
    """读实际生效的证书还有多少天到期。这是唯一可信的判据——
    certbot 说什么不算，浏览器看到的才算。"""
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with socket.create_connection((host, port), timeout=10) as s:
            with ctx.wrap_socket(s, server_hostname=sni) as ss:
                cert = ss.getpeercert()
        if not cert:                       # verify_mode=NONE 时可能拿不到解析结果
            out = subprocess.run(
                ["openssl", "s_client", "-connect", f"{host}:{port}",
                 "-servername", sni], input="", capture_output=True,
                text=True, timeout=15).stdout
            m = re.search(r"NotAfter\s*:\s*(.+)", out)
            if not m:
                return None
            exp = time.mktime(time.strptime(m.group(1).strip(), "%b %d %H:%M:%S %Y %Z"))
        else:
            exp = ssl.cert_time_to_seconds(cert["notAfter"])
        return (exp - time.time()) / 86400
    except Exception:
        return None


def main():
    if not os.path.exists(CONFIG):
        print(f"[cert-renew] 缺 {CONFIG}", file=sys.stderr)
        return 2
    with open(CONFIG, encoding="utf-8") as f:
        cfg = {k: v for k, v in json.load(f).items() if not k.startswith("_")}

    warn_days = cfg.get("warn_days", 7)
    problems = []

    with Task("cert-renew", actor="cert-renew") as task:
        before = {c["name"]: days_left("127.0.0.1", c["port"], c["sni"])
                  for c in cfg.get("certs", [])}
        task.event("before", "P3", {k: (round(v, 1) if v else None)
                                    for k, v in before.items()})

        # 续期（<30 天才真续，否则空跑）
        r = subprocess.run(cfg["renew_cmd"], shell=True, capture_output=True,
                           text=True, timeout=600)
        task.event("certbot", "P3" if r.returncode == 0 else "P1",
                   {"rc": r.returncode, "out": (r.stdout + r.stderr)[-800:]})
        if r.returncode != 0:
            problems.append(f"certbot 退出码 {r.returncode}")

        # reload 让新证书生效
        rl = subprocess.run(cfg["reload_cmd"], shell=True, capture_output=True,
                            text=True, timeout=120)
        task.event("reload", "P3" if rl.returncode == 0 else "P1",
                   {"rc": rl.returncode, "out": (rl.stdout + rl.stderr)[-400:]})
        if rl.returncode != 0:
            problems.append(f"reload 退出码 {rl.returncode}")

        # 【关键】读实际到期日，而不是信 certbot 的退出码。
        # certbot 空跑也返回 0——「续期失败」和「还没到该续的时候」
        # 在退出码上长得一模一样，只有实际到期日能分开它们。
        after = {c["name"]: days_left("127.0.0.1", c["port"], c["sni"])
                 for c in cfg.get("certs", [])}
        task.event("after", "P3", {k: (round(v, 1) if v else None)
                                   for k, v in after.items()})

        for name, d in after.items():
            if d is None:
                problems.append(f"{name} 读不出证书")
                task.event("cert_unreadable", "P1", {"cert": name})
                print(f"[cert-renew] ⚠️ {name} 读不出证书")
                continue
            print(f"[cert-renew] {name} 还有 {d:.0f} 天到期")
            if d < warn_days:
                problems.append(f"{name} 仅剩 {d:.0f} 天且未续成")
                task.event("cert_expiring", "P0",
                           {"cert": name, "days_left": round(d, 1),
                            "threshold": warn_days})
                print(f"[cert-renew] ❌ {name} 仅剩 {d:.0f} 天，续期没起作用")

        task.event("summary", "P3", {"problems": problems})

    return 1 if problems else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"[cert-renew] 致命错误: {e}", file=sys.stderr)
        sys.exit(1)
