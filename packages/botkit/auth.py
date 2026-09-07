#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""JWT 签发。bot 调 API 发消息时用。

三个容易踩的坑，都写在这里免得每个 bot 各踩一遍：

1. **claims 必须用完整命名空间 URI**
   用短名如 `role` 会直接 401。这是 .NET 的 ClaimTypes 约定，
   看起来啰嗦但不能省。

2. **`tver` 必须与库里 `Users.TokenVersion` 一致**
   不一致直接 401。TokenVersion 是「让已签发 token 全部失效」的开关——
   改密码、踢下线都会动它。所以【每次签发都要现查】，不能缓存。

3. **密钥从环境变量读，绝不写进代码或 prompt**
   有 Bash 权限的角色能读到自己的代码——密钥写在代码里等于送出去。
"""
import base64
import hashlib
import hmac
import json
import os
import sqlite3
import time

ISS = os.environ.get("HARNESS_JWT_ISS", "gooday.ltd")
AUD = os.environ.get("HARNESS_JWT_AUD", "gooday.ltd")
TTL = 600          # 10 分钟。短是刻意的：泄露一次的窗口有限

NS = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims"
NS_MS = "http://schemas.microsoft.com/ws/2008/06/identity/claims"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _secret():
    """密钥来源：环境变量 > .env 文件。绝不硬编码。"""
    s = os.environ.get("JWT_SECRET")
    if s:
        return s
    for p in ("/opt/gooday-harness/.env", os.path.expanduser("~/.env")):
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as f:
            for line in f:
                if line.startswith("JWT_SECRET="):
                    return line.split("=", 1)[1].strip().strip("'\"")
    raise RuntimeError("找不到 JWT_SECRET（环境变量或 .env）")


def _token_version(db_path, uid):
    """现查 TokenVersion。

    【不能缓存】：它是「让已签发 token 全部失效」的开关，
    改密码、踢下线都会动它。缓存了就会在它变更后持续签出无效 token，
    表现是「bot 突然发不出消息」而日志里一切正常——
    旧系统真栽过：最长 30 分钟内全部发送静默失败。
    """
    conn = sqlite3.connect(db_path, timeout=10)
    try:
        r = conn.execute("SELECT TokenVersion FROM Users WHERE Id=?", (uid,)).fetchone()
        return str(r[0]) if r else "1"
    finally:
        conn.close()


def make_token(uid, username, role, db_path):
    """签一个 token。每次调用都现查 TokenVersion。"""
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"},
                                separators=(",", ":")).encode())
    payload = _b64url(json.dumps({
        f"{NS}/nameidentifier": str(uid),
        f"{NS}/name": username,
        f"{NS_MS}/role": role,
        "tver": _token_version(db_path, uid),
        "exp": int(time.time()) + TTL,
        "iss": ISS, "aud": AUD,
    }, separators=(",", ":")).encode())
    sig = _b64url(hmac.new(_secret().encode(), f"{header}.{payload}".encode(),
                           hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def provider(uid, username, role, db_path):
    """给 outbound.send 用的 token_provider。

    force_refresh=True 时重新签——401 之后调用方会这样要一次。
    因为 TokenVersion 是现查的，重签自然就带上了新版本号。
    """
    cache = {"tok": None, "exp": 0}

    def _get(force_refresh=False):
        now = time.time()
        if force_refresh or not cache["tok"] or now > cache["exp"]:
            cache["tok"] = make_token(uid, username, role, db_path)
            cache["exp"] = now + TTL - 60       # 提前 1 分钟换，避开边界
        return cache["tok"]

    return _get
