#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""订单主链路端到端真跑 —— 建单 → 开工 → 各道闸门 → 恢复 → 清理。

**静态检查全绿 ≠ 系统能跑**（AGENTS.md 三条不可协商之一）。
check.py 查的是「东西在不在」，本文件查的是「这条链路真的走得通、
而且该拦的地方真的拦得住」。

    python3 evolution/experiments/order-mainline/e2e.py

跑完自己清理：删掉造出来的订单和它的工作记录。
【不测的部分要说出来】：交付物生成 → 出讲解片 → 放行通知客户 这一段
要真调模型、真渲染视频、真给客户发消息，一轮十几分钟且会打扰真人，
本脚本只验证「没有交付物时 release 必须被拦下」这个方向。
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

REPO = "/opt/gooday-harness"
sys.path.insert(0, os.path.join(REPO, "packages", "botkit"))
import auth                                              # noqa: E402

API = "http://127.0.0.1:8081"
DB = "/var/lib/docker/volumes/gooday_gooday_data/_data/gooday.db"
# 【不能直接写 /tmp/固定名】：备份由 root 建，而 /tmp 有粘滞位，
# agent 删不掉别人属主的文件——第一次跑完清理失败，第二次跑就撞上残留直接崩。
# mkdtemp 建的目录属主是 agent、没有粘滞位，里面的 root 文件删得掉。
_TMPDIR = tempfile.mkdtemp(prefix="gooday-e2e-")
SCRATCH = os.path.join(_TMPDIR, "tokens.db")

OWNER, RUYI = 1, 23

ok_all = True
made = []          # 造出来的订单 id，最后清掉


def show(label, cond, extra=""):
    global ok_all
    ok_all &= bool(cond)
    print(f"  {'✅' if cond else '❌'} {label}" + (f"  —— {extra}" if extra else ""))


def sql(q):
    r = subprocess.run(["sudo", "-n", "sqlite3", DB, q],
                       capture_output=True, text=True, timeout=30)
    return r.stdout.strip() if r.returncode == 0 else None


def req(path, tok=None, method="GET", body=None):
    """返回 (status, json)。【HTTPError 也要把 body 读出来】——
    闸门拦下时的原因就在 body 里，只看状态码等于放弃了最有用的信息。"""
    h = {}
    data = None
    if tok:
        h["Authorization"] = "Bearer " + tok
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


def mint_tokens():
    """签 token 要读 Users.TokenVersion，而 agent 读不到 docker 卷里的库。
    用 sqlite3 .backup 出一份可读副本——【不是 cp】，cp 一个 WAL 库
    可能拿到一个空壳（本次重构的回滚演练实测过）。"""
    subprocess.run(["sudo", "-n", "sqlite3", DB, f".backup '{SCRATCH}'"],
                   check=True, timeout=60)
    # 【不要 chmod】：备份是 root 建的，agent 改不了权限（会 EPERM），
    # 而 sqlite3 建出来本来就是 0644，读得到。第一版加了这行，
    # 于是整个脚本在第 0 步就崩了——多做一步不需要的事，多一个失败点。
    return (auth.make_token(OWNER, "admin", "admin", SCRATCH),
            auth.make_token(RUYI, "如意", "staff", SCRATCH))


NEED = ("扫描指定目录下所有 .cs 源码文件，统计总行数并按文件降序排行，"
        "支持导出 CSV，做成命令行工具，要能排除 bin 和 obj 目录。")


def main():
    print("=== 0. 准备 ===")
    owner_tok, ruyi_tok = mint_tokens()
    show("签出 token", bool(owner_tok and ruyi_tok))

    msg_before = int(sql("SELECT COUNT(*) FROM PrivateMessages WHERE ReceiverId=1") or 0)

    print("=== 1. 公开需求表单建单（匿名，未注册访客唯一入口）===")
    st, r = req("/api/tickets/intake", method="POST", body={
        "name": "e2e测试客户", "contact": "wechat e2e_test",
        "title": "C# 源码行数统计命令行工具", "description": NEED})
    show("匿名建单成功", st == 200, f"HTTP {st} {r.get('message', '')}")
    tno = r.get("ticketNo")
    st2, detail = req(f"/api/tickets?pageSize=5", owner_tok)
    tid = next((t["id"] for t in detail.get("list", []) if t["ticketNo"] == tno), None)
    if tid:
        made.append(tid)
    show("订单初始状态是 NEW",
         next((t["status"] for t in detail.get("list", []) if t["id"] == tid), None) == "NEW")
    show("金额初始为空（如意全程不谈钱）",
         next((t["amount"] for t in detail.get("list", []) if t["id"] == tid), "x") is None)

    print("=== 2. 需求太短必须被拒 ===")
    st, r = req("/api/tickets/intake", method="POST", body={
        "name": "x", "contact": "y", "title": "z", "description": "太短了"})
    show("30 字以下的需求被拒", st == 400, f"HTTP {st} {r.get('message', '')}")

    print("=== 3. 建单必须惊动大海 ===")
    time.sleep(1)
    msg_after = int(sql("SELECT COUNT(*) FROM PrivateMessages WHERE ReceiverId=1") or 0)
    show("大海收到了新订单私信", msg_after > msg_before, f"{msg_before} → {msg_after}")
    body = sql(f"SELECT Content FROM PrivateMessages WHERE ReceiverId=1 ORDER BY Id DESC LIMIT 1") or ""
    show("私信里带着需求原文（不是摘要）", NEED[:20] in body)
    show("私信里【没有】价格字样", not any(w in body for w in ("预算", "报价", "¥")))

    print("=== 3.5 建单必须关联客户档案（否则这张单永远交付不了）===")
    # 这一条是补的：第一版 intake.py 恒传 clientId=None，
    # 单子建得出来、通知也发得出去，**但走到放行那一步会被上架端点拒绝**——
    # 一个只在链路末端才暴露的洞。没有判据盯着，它能一直躺着。
    st, r2 = req("/api/tickets", owner_tok, "POST", {
        "title": "带账号的客户下的单", "description": NEED,
        "clientName": "e2e有账号客户", "clientContact": "wechat e2e_test2",
        "clientId": None, "clientUserId": 7})
    tid2 = r2.get("id")
    if tid2:
        made.append(tid2)
    _, d2 = req(f"/api/tickets/{tid2}", owner_tok)
    show("带 clientUserId 建单 → ClientId 非空", d2.get("clientId") is not None,
         f"clientId={d2.get('clientId')}")
    show("换算回去就是那个账号", d2.get("clientUserId") == 7, f"clientUserId={d2.get('clientUserId')}")
    n_cli = sql("SELECT COUNT(*) FROM Clients WHERE UserId=7")
    show("客户档案被自动建出来了", n_cli == "1", f"Clients(UserId=7)={n_cli}")
    st, r3 = req("/api/tickets", owner_tok, "POST", {
        "title": "同一个人的第二单", "description": NEED,
        "clientName": "e2e有账号客户", "clientContact": "wechat e2e_test2",
        "clientId": None, "clientUserId": 7})
    if r3.get("id"):
        made.append(r3["id"])
    n_cli2 = sql("SELECT COUNT(*) FROM Clients WHERE UserId=7")
    show("同一个人再下单不会重复建档案", n_cli2 == "1", f"Clients(UserId=7)={n_cli2}")

    print("=== 4. 开工闸：只有大海能推 ===")
    st, r = req(f"/api/tickets/{tid}/transition", ruyi_tok, "POST", {"event": "start"})
    show("如意（staff）推 start → 403", st == 403, f"HTTP {st} {r.get('message', '')}")

    print("=== 4.5 判据字段也只有大海能改（灵犀评审 ②）===")
    # 锁住动作是不够的：release 判 ClientId、close 判 Amount，
    # 而 PUT 只有 [Authorize(Roles="admin,staff")]——灵犀是 admin、如意是 staff。
    # 注入改掉 ClientId → 大海照常点放行 → 交付物进别人账号。
    # 闸门没被推开，是它判的那个数被换掉了。
    st, r = req(f"/api/tickets/{tid}", ruyi_tok, "PUT", {"clientId": 99})
    show("如意改 ClientId → 403", st == 403, f"HTTP {st} {r.get('message','')[:40]}")
    st, r = req(f"/api/tickets/{tid}", ruyi_tok, "PUT", {"amount": 1})
    show("如意改 Amount → 403", st == 403, f"HTTP {st}")
    st, r = req(f"/api/tickets/{tid}", ruyi_tok, "PUT", {"description": NEED + "（如意补充的细节）"})
    show("但如意仍能改需求正文（她的本职）", st == 200, f"HTTP {st} {r.get('changed')}")
    _, cur = req(f"/api/tickets/{tid}", owner_tok)
    show("ClientId 没有被改动", cur.get("clientId") is None, str(cur.get("clientId")))

    print("=== 5. 非法迁移要 409，且要说清此刻能做什么 ===")
    st, r = req(f"/api/tickets/{tid}/transition", owner_tok, "POST", {"event": "close"})
    show("NEW 直接 close → 409", st == 409, f"HTTP {st} {r.get('message', '')}")
    show("409 里带了可用动作列表", bool(r.get("available")), str(r.get("available")))

    st, r = req(f"/api/tickets/{tid}/transition", owner_tok, "POST", {"event": "巫术"})
    show("不存在的动作 → 409 且提示可用动作", st == 409, r.get("message", "")[:60])

    print("=== 6. 大海填金额 + 开工 ===")
    st, r = req(f"/api/tickets/{tid}", owner_tok, "PUT", {"amount": 800})
    show("填金额成功", st == 200, str(r.get("changed")))
    st, r = req(f"/api/tickets/{tid}", owner_tok, "PUT", {"status": "CLOSED"})
    _, cur = req(f"/api/tickets/{tid}", owner_tok)
    show("PUT 改不了状态（状态只能走 transition）", cur["status"] == "NEW", cur["status"])

    st, r = req(f"/api/tickets/{tid}/transition", owner_tok, "POST", {"event": "start"})
    show("大海 start → IN_PROGRESS", st == 200 and r.get("to") == "IN_PROGRESS",
         f"HTTP {st} {r.get('message', r)}")

    print("=== 7. 交付闸：没有交付物不许放行 ===")
    st, r = req(f"/api/tickets/{tid}/transition", owner_tok, "POST", {"event": "release"})
    show("没有交付物时 release 被拦", st == 400, r.get("message", "")[:70])

    print("=== 8. BLOCKED：必须写清卡在哪，恢复后要清干净 ===")
    st, r = req(f"/api/tickets/{tid}/transition", owner_tok, "POST", {"event": "block"})
    show("不写原因就 block → 400", st == 400, r.get("message", "")[:50])

    st, r = req(f"/api/tickets/{tid}/transition", owner_tok, "POST",
                {"event": "block", "reason": "灵犀三轮没过，需求本身有歧义"})
    _, cur = req(f"/api/tickets/{tid}", owner_tok)
    show("带原因 block → BLOCKED", cur["status"] == "BLOCKED", cur["status"])
    show("BlockedReason 落库了", bool(cur.get("blockedReason")), cur.get("blockedReason"))

    st, r = req(f"/api/tickets/{tid}/transition", owner_tok, "POST", {"event": "unblock"})
    _, cur = req(f"/api/tickets/{tid}", owner_tok)
    show("unblock → 回到 IN_PROGRESS", cur["status"] == "IN_PROGRESS", cur["status"])
    show("BlockedReason 被清空（否则看板上永远挂着红）",
         cur.get("blockedReason") in (None, ""), repr(cur.get("blockedReason")))

    print("=== 9. 结单必须先经过 DELIVERED ===")
    st, r = req(f"/api/tickets/{tid}/transition", owner_tok, "POST", {"event": "close"})
    show("IN_PROGRESS 直接 close → 409（必须先 DELIVERED）", st == 409,
         r.get("message", "")[:60])
    # ⚠️ 【「结单要求金额非空」这道闸本文件没有覆盖】。
    #    要覆盖它得先把订单推到 DELIVERED，而那需要一件三样齐的真交付物
    #    （生成 + 打包 + 出讲解片 + 上架），一轮十几分钟并且会动真实的工具库。
    #    第一版这一节的标题写的是「结单闸：金额非空」，而断言的其实是上面这条——
    #    **名不副实的测试比缺测试更坏**，它会让人以为那道闸验过了。
    #    所以这里只诚实标注：该闸的代码在 TicketsController.Transition 的
    #    `evt == "close" && t.Amount == null` 分支，尚未有自动化覆盖。

    print("=== 10. 工作记录 ===")
    st, r = req(f"/api/tickets/{tid}/log", owner_tok)
    kinds = [l["kind"] for l in r.get("list", [])]
    show("有建单记录", "created" in kinds, str(kinds))
    show("有迁移记录", "transition" in kinds)
    show("迁移记录写了 from → to",
         any("→" in l["text"] for l in r.get("list", []) if l["kind"] == "transition"))

    print("=== 11. 取消 + 幂等 ===")
    st, _ = req(f"/api/tickets/{tid}/transition", owner_tok, "POST",
                {"event": "block", "reason": "准备取消"})
    st, r = req(f"/api/tickets/{tid}/transition", owner_tok, "POST", {"event": "cancel"})
    _, cur = req(f"/api/tickets/{tid}", owner_tok)
    show("BLOCKED → cancel → CANCELLED", cur["status"] == "CANCELLED", cur["status"])
    st, r = req(f"/api/tickets/{tid}/transition", owner_tok, "POST", {"event": "cancel"})
    show("终态后再 cancel → 409（不会重复迁移）", st == 409, r.get("message", "")[:50])

    print("=== 12. 清理 ===")
    for i in made:
        st, _ = req(f"/api/tickets/{i}", owner_tok, "DELETE")
        show(f"删掉测试订单 #{i}", st == 200)
    left = sql("SELECT COUNT(*) FROM Tickets WHERE ClientContact LIKE 'wechat e2e_test%'")
    show("库里没留下测试订单", left == "0", f"残留 {left}")
    subprocess.run(["sudo", "-n", "sqlite3", DB,
                    "DELETE FROM Clients WHERE Contact LIKE 'wechat e2e_test%'"], timeout=30)
    left_c = sql("SELECT COUNT(*) FROM Clients WHERE Contact LIKE 'wechat e2e_test%'")
    show("库里没留下测试客户档案", left_c == "0", f"残留 {left_c}")
    shutil.rmtree(_TMPDIR, ignore_errors=True)
    show("临时 token 库已清理", not os.path.exists(SCRATCH))

    print("\n" + ("判定: ✅ 全部通过" if ok_all else "判定: ❌ 有未通过"))
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
