#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P1 交付链路端到端：建工单 → 收款 → 上架（分两次凑齐三样）→ 通知 → 结单闸门。

【必须走真实接口跑一遍】。这条链路上有四个判定（收款、三样、归属、通知幂等），
任何一个只在代码里"看起来对"，实际表现都是客户拿不到东西或者账对不上。
跑完自己清理：删工具、删文件、删工单、删财务记录。
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, "/opt/gooday-harness/packages")
from botkit.auth import make_token

S = "/tmp/claude-1001/-opt-gooday/6292e867-86ef-4895-94fa-698eb6e4832e/scratchpad"
API = "http://127.0.0.1:8081"
CLIENT = 7                      # test 用户当客户
DIR = "private/GD-TEST-DELIVER"
TOK = make_token(1, "admin", "admin", S + "/post.db")
CTOK = make_token(CLIENT, "test", "member", S + "/post.db")

ok_all = True


def req(path, tok=TOK, method="GET", body=None):
    h = {"Authorization": "Bearer " + tok}
    data = None
    if body is not None:
        h["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    r = urllib.request.Request(API + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw.decode("utf-8", "ignore")[:200]}


def show(label, cond, extra=""):
    global ok_all
    ok_all &= bool(cond)
    print(f"  {'✅' if cond else '❌'} {label}{('  ' + str(extra)) if extra else ''}")


def main():
    print("=== 准备：工单 + 收款 ===")
    st, t = req("/api/tickets", method="POST", body={
        "Title": "交付链路自检工单", "Description": "P1 端到端测试用，测完即删",
        "ClientName": "test", "ClientContact": "test", "ContactType": "wechat",
        "ClientId": CLIENT, "Budget": "0", "Priority": "low",
        "DevRequestId": None, "Source": "admin", "AdminNote": "自检", "DueAt": None})
    show(f"建工单 → {st} {t.get('ticketNo')}", st == 200)
    tid, tno = t["id"], t["ticketNo"]

    st, f = req("/api/finance", method="POST", body={
        "Type": "income", "Amount": 1, "Category": "定制开发", "Title": "自检收款",
        "Note": None, "TicketId": tid, "ClientId": None, "PaymentStatus": "received",
        "PaymentMethod": "wechat", "AccountPeriod": None, "ReceivedAt": None})
    show(f"记一笔已收款 → {st}", st == 200)
    fid = (f.get("id") or (f.get("record") or {}).get("id"))

    # 结单前面还有一道既有闸门：必须有关联项目、项目必须有子任务且都已完成
    # （项八，防空壳交付）。不补上这两样，我的交付判据根本轮不到执行——
    # 第一版就是这么"验"的，看到的全是别的闸门在说话
    st, pj = req("/api/projects", method="POST", body={
        "Title": "自检项目", "Description": "P1 端到端测试用", "TicketId": tid,
        "ClientId": None, "AssigneeId": None, "Budget": None, "QuotedPrice": None,
        "AdminNote": "自检"})
    show(f"建关联项目 → {st}", st == 200)
    pid = pj.get("id") or (pj.get("project") or {}).get("id")
    st, tk = req(f"/api/projects/{pid}/tasks", method="POST", body={
        "Title": "自检子任务", "Description": None, "SortOrder": 1})
    show(f"建子任务 → {st}", st == 200)
    tkid = tk.get("id") or (tk.get("task") or {}).get("id")
    st, _ = req(f"/api/projects/{pid}/tasks/{tkid}", method="PUT", body={"Status": "done"})
    show(f"子任务置完成 → {st}", st == 200)

    print("=== 交付前：结单必须被拦 ===")
    for s in ("analyst_complete", "in_progress", "delivering"):
        st, r = req(f"/api/tickets/{tid}", method="PUT", body={"Status": s})
        if st != 200:
            print(f"     （推进到 {s} → {st} {r.get('message','')}）")
    st, r = req(f"/api/tickets/{tid}", method="PUT", body={"Status": "done"})
    show(f"没交付物就结单 → {st}", st == 400 and "交付不达标" in str(r.get("message")),
         r.get("message"))

    print("=== 第一次上架：只有在线版和下载包 ===")
    st, d1 = req("/api/admin/tools/deliver", method="POST", body={
        "TicketId": tid, "Name": "自检交付物", "Description": "P1 端到端测试用",
        "OnlineUrl": f"/uploads/{DIR}/交付物.html",
        "DownloadFileName": f"{DIR}/交付包.zip"})
    show(f"上架 → {st} complete={d1.get('complete')} missing={d1.get('missing')}",
         st == 200 and d1.get("complete") is False and any("视频" in m for m in d1.get("missing", [])))
    show("缺视频时不通知客户", d1.get("notified") is False)
    slug = d1.get("slug")

    st, r = req(f"/api/tickets/{tid}", method="PUT", body={"Status": "done"})
    show(f"三样不全就结单 → {st}", st == 400 and "视频" in str(r.get("message")), r.get("message"))

    print("=== 第二次上架：补上视频 ===")
    st, d2 = req("/api/admin/tools/deliver", method="POST", body={
        "TicketId": tid, "VideoUrl": f"/uploads/{DIR}/讲解.mp4", "VideoDuration": 48})
    show(f"补视频 → {st} complete={d2.get('complete')}", st == 200 and d2.get("complete") is True)
    show("三样齐了自动通知客户", d2.get("notified") is True)

    st, d3 = req("/api/admin/tools/deliver", method="POST", body={"TicketId": tid})
    show("再调一次不重复通知（幂等）", d3.get("notified") is False and d3.get("complete") is True)

    print("=== 客户那边真收到了吗 ===")
    st, msgs = req("/api/messages/23", CTOK)        # 与如意的会话
    body = json.dumps(msgs, ensure_ascii=False)
    show("如意给客户发了交付私信", f"[交付单#{d2.get('toolId')}]" in body)
    show("私信里说清了默认只有他可见", "只有你看得见" in body)
    st, ns = req("/api/notifications", CTOK)
    show("站内通知也有", "交付" in json.dumps(ns, ensure_ascii=False))

    print("=== 客户看得到、别人看不到 ===")
    st, mine = req("/api/tools", CTOK)
    show("客户的工具一览里有它", any(x["slug"] == slug for x in mine))
    st, anon = req("/api/tools", None) if False else req("/api/tools", make_token(8, "豆豆", "member", S + "/post.db"))
    show("另一个用户看不到", not any(x["slug"] == slug for x in anon))

    print("=== 三样齐了，结单放行 ===")
    st, r = req(f"/api/tickets/{tid}", method="PUT", body={"Status": "done"})
    show(f"结单 → {st}", st == 200, r.get("message", ""))

    print("=== 清理 ===")
    st, tools = req("/api/admin/tools")
    tool = [x for x in tools if x["slug"] == slug]
    if tool:
        req(f"/api/admin/tools/{tool[0]['id']}", method="DELETE")
        print("  删工具")
    for name in ("交付物.html", "讲解.mp4", "交付包.zip"):
        req("/api/admin/files/" + urllib.parse.quote(f"{DIR}/{name}"), method="DELETE")
    if fid:
        req(f"/api/finance/{fid}", method="DELETE")
        print("  删财务记录")
    # 测试私信要删干净：留在客户信箱里是垃圾，也会让下一轮的幂等判定被骗。
    # 【只删自己造的那一条，绝不清空会话】——那条会话里有几十条真实历史，
    # "清空"当清理手段，一次手滑就没了
    st, msgs = req("/api/messages/23", CTOK)
    for m in (msgs if isinstance(msgs, list) else msgs.get("items", [])):
        if f"[交付单#{d2.get('toolId')}]" in (m.get("content") or ""):
            req(f"/api/messages/{m['id']}", CTOK, "DELETE")
            print("  删测试私信", m["id"])
    req(f"/api/projects/{pid}/tasks/{tkid}", method="DELETE")
    req(f"/api/projects/{pid}", method="DELETE")
    req(f"/api/tickets/{tid}", method="DELETE")
    print("  删项目、子任务、工单")

    print("\n判定:", "✅ 全部通过" if ok_all else "❌ 有不通过项")
    sys.exit(0 if ok_all else 1)


main()
