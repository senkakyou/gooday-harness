# -*- coding: utf-8 -*-
"""TLS 证书到期。

证书过期是最典型的「安静地烂掉」：没有任何东西会报错，
直到某天所有人的浏览器同时开始报警。旧系统真栽过——
源证书从无定时续期，月中静默过期，nginx 443 与 xray 555 共用同一张，一起爆。

**续期和监控必须是两条腿**：cert-renew 负责续，本项目负责喊。
续期挂了监控还在，监控挂了续期还在——任一单点失效不会同时失去两者。

判据用【实际生效的证书】，走 TLS 握手读浏览器真正看到的那张。
证书文件里写什么不算，nginx 有没有 reload、读的是不是 live 软链，
只有握手结果知道。
"""
import re
import socket
import ssl
import subprocess
import time

NAME = "certs"


def _days_left(port, sni):
    """返回剩余天数；None = 读不出（不是「没问题」）。"""
    try:
        out = subprocess.run(
            ["openssl", "s_client", "-connect", f"127.0.0.1:{port}",
             "-servername", sni],
            input="", capture_output=True, text=True, timeout=15).stdout
        m = re.search(r"NotAfter\s*:\s*(.+)", out)
        if m:
            exp = time.mktime(time.strptime(m.group(1).strip(),
                                            "%b %d %H:%M:%S %Y %Z"))
            return (exp - time.time()) / 86400
    except Exception:
        pass
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with socket.create_connection(("127.0.0.1", port), timeout=10) as s:
            with ctx.wrap_socket(s, server_hostname=sni) as ss:
                c = ss.getpeercert()
        if c and "notAfter" in c:
            return (ssl.cert_time_to_seconds(c["notAfter"]) - time.time()) / 86400
    except Exception:
        pass
    return None


def run(cfg):
    for c in cfg.get("certs", []):
        name, port = c["name"], c["port"]
        d = _days_left(port, c.get("sni", name))
        warn = c.get("warn_days", 7)

        if d is None:
            yield {"level": "P1", "what": f"{name}:{port} 读不出证书",
                   "why": f"TLS 握手拿不到证书——端口没监听？服务挂了？"
                          f"「读不出」和「没问题」是两回事，不能当通过",
                   "fix": f"确认 {port} 端口在监听且 TLS 正常", "action": None}
        elif d < 0:
            yield {"level": "P0", "what": f"{name} 证书【已过期】{-d:.0f} 天",
                   "why": f"实际握手读到的到期日已过。所有访问者的浏览器都在报警",
                   "fix": "立刻手动续期并 reload", "action": None}
        elif d < warn:
            yield {"level": "P0", "what": f"{name} 证书 {d:.0f} 天后到期",
                   "why": f"低于阈值 {warn} 天，且自动续期显然没起作用"
                          f"（certbot 应在 <30 天时就续掉）",
                   "fix": "查 cert-renew 日志；certbot 空跑也返回 0，"
                          "别只看退出码", "action": None}
