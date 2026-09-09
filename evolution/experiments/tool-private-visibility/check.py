#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""私有交付物的越权测试。

三个身份分别去打同一个私有工具：所有者、另一个登录用户、匿名。
【必须逐条实测】——可见性这种东西，代码看起来对和真的对是两回事，
而漏一条的表现是"本该只有客户看到的交付物别人也能下"，且不会有任何报警。
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, "/opt/gooday-harness/packages")
from botkit.auth import make_token

S = "/tmp/claude-1001/-opt-gooday/6292e867-86ef-4895-94fa-698eb6e4832e/scratchpad"
DB = S + "/post.db"
API = "http://127.0.0.1:8081"
OWNER, OTHER = 7, 8          # test / 豆豆
SLUG = "private-delivery-selftest"

TOK = {
    "所有者": make_token(OWNER, "test", "member", DB),
    "另一用户": make_token(OTHER, "豆豆", "member", DB),
    "匿名": None,
    "站长": make_token(1, "admin", "admin", DB),
}


def req(path, tok=None, method="GET", body=None, headers=None):
    h = dict(headers or {})
    if tok:
        h["Authorization"] = "Bearer " + tok
    if body is not None:
        h["Content-Type"] = "application/json"
        body = json.dumps(body).encode()
    r = urllib.request.Request(API + path, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def in_list(tok):
    st, body, _ = req("/api/tools", tok)
    tools = json.loads(body)
    return any(t["slug"] == SLUG for t in tools), len(tools)


def show(label, ok, detail=""):
    print(f"  {'✅' if ok else '❌'} {label}{('  ' + detail) if detail else ''}")
    return ok


def main():
    allok = True
    print("=== 私有状态 ===")
    for who in ("所有者", "另一用户", "匿名", "站长"):
        listed, n = in_list(TOK[who])
        want = who in ("所有者", "站长")
        allok &= show(f"{who} 的工具一览里{'有' if listed else '没有'}这件（共 {n} 个）",
                      listed == want)

    for who in ("另一用户", "匿名"):
        st, _, _ = req(f"/api/tools/{SLUG}", TOK[who])
        allok &= show(f"{who} 取详情 → {st}（要 404，不能是 403：403 等于承认它存在）", st == 404)
        st, _, _ = req(f"/api/tools/{SLUG}/online", TOK[who])
        allok &= show(f"{who} 取在线版 → {st}（要 404）", st == 404)
        st, _, _ = req(f"/api/tools/{SLUG}/video", TOK[who])
        allok &= show(f"{who} 取视频 → {st}（要 404）", st == 404)
        st, _, _ = req(f"/api/tools/{SLUG}/download", TOK[who])
        allok &= show(f"{who} 下载 → {st}（要 404）", st == 404)

    st, body, _ = req(f"/api/tools/{SLUG}", TOK["所有者"])
    d = json.loads(body) if st == 200 else {}
    allok &= show(f"所有者取详情 → {st}", st == 200)
    allok &= show(f"详情里 onlineUrl={d.get('onlineUrl')}（必须是鉴权接口，不能暴露真实路径）",
                  d.get("onlineUrl") == f"/api/tools/{SLUG}/online")
    allok &= show(f"详情里 videoUrl={d.get('videoUrl')}",
                  d.get("videoUrl") == f"/api/tools/{SLUG}/video")
    allok &= show(f"详情里 isMine={d.get('isMine')} visibility={d.get('visibility')}",
                  d.get("isMine") is True and d.get("visibility") == "private")

    st, b, h = req(f"/api/tools/{SLUG}/online", TOK["所有者"])
    allok &= show(f"所有者取在线版 → {st} {h.get('Content-Type')}",
                  st == 200 and "text/html" in (h.get("Content-Type") or ""))
    st, b, h = req(f"/api/tools/{SLUG}/video", TOK["所有者"],
                   headers={"Range": "bytes=0-1023"})
    allok &= show(f"所有者取视频（带 Range）→ {st} {len(b)} 字节（要 206，否则进度条拖不动）",
                  st == 206 and len(b) == 1024)
    st, b, h = req(f"/api/tools/{SLUG}/download", TOK["所有者"])
    allok &= show(f"所有者下载 → {st} {len(b)} 字节", st == 200 and len(b) > 0)

    print("=== 静态直链（私有的命门）===")
    for p in ("/uploads/private/GD-TEST-0909-abc123/交付物.html",
              "/uploads/private/GD-TEST-0909-abc123/讲解.mp4",
              "/uploads/private/GD-TEST-0909-abc123/交付包.zip"):
        st, _, _ = req(urllib.parse.quote(p))
        allok &= show(f"匿名直接取 {p.split('/')[-1]} → {st}（要 404）", st == 404)

    print("=== 切成公开之后 ===")
    st, b, _ = req(f"/api/tools/{SLUG}/visibility", TOK["所有者"], "PUT", {"visibility": "public"})
    allok &= show(f"所有者点公开 → {st} {b.decode()[:40]}", st == 200)
    listed, _ = in_list(None)
    allok &= show("匿名的工具一览里现在能看到它了", listed)
    st, b, _ = req(f"/api/tools/{SLUG}", None)
    allok &= show(f"匿名取详情 → {st}", st == 200)
    # 【公开之后文件仍在 private/ 目录里】，静态层照样拦死，所以详情给的必须还是
    # 鉴权接口地址（此时它对所有人放行）。第一版按可见性判，切公开后返回真实路径，
    # 结果是"公开之后反而谁都打不开"——这条就是为它加的
    dpub = json.loads(b) if st == 200 else {}
    allok &= show(f"公开后 onlineUrl={dpub.get('onlineUrl')}（仍须是鉴权接口）",
                  dpub.get("onlineUrl") == f"/api/tools/{SLUG}/online")
    st, bb, h = req(f"/api/tools/{SLUG}/online", None)
    allok &= show(f"匿名按它取在线版 → {st} {len(bb)} 字节", st == 200 and len(bb) > 0)
    st, bb, h = req(f"/api/tools/{SLUG}/video", None, headers={"Range": "bytes=0-99"})
    allok &= show(f"匿名按它取视频 → {st}（要 206）", st == 206)

    print("=== 别人改不动我的可见性 ===")
    st, _, _ = req(f"/api/tools/{SLUG}/visibility", TOK["另一用户"], "PUT", {"visibility": "private"})
    allok &= show(f"另一用户试图改 → {st}（要 404）", st == 404)
    st, _, _ = req("/api/tools/pinyin-learn/visibility", TOK["所有者"], "PUT", {"visibility": "private"})
    allok &= show(f"客户试图改站方工具 → {st}（要 404）", st == 404)

    st, b, _ = req(f"/api/tools/{SLUG}/visibility", TOK["所有者"], "PUT", {"visibility": "private"})
    allok &= show(f"改回私有 → {st}", st == 200)
    listed, _ = in_list(None)
    allok &= show("匿名又看不到了", not listed)

    print("\n判定:", "✅ 全部通过" if allok else "❌ 有不通过项")
    sys.exit(0 if allok else 1)


main()
