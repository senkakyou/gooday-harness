#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""deliver 的便宜那层回归：选题和拼 prompt。**不调模型、不出片、不碰生产。**

为什么只测这两件：整条链路跑一次要十分钟、要真调模型、要在生产建单，
做成自动回归太贵。而 2026-09-09 那轮评审抓到的两个 P0 恰恰都在这两件里——

  · 模型从来没看到过需求原文（列表接口不返回 Description，
    直接用列表里的 ticket 去生成，模型只看见标题，而且它照样做得出东西来）；
  · 选题用黑名单，把 failed / customer_rejected 漏进来了——
    那是正在议退款或返工的单，机器却会生成一版并通知客户"做好了🎉"。

跑：python3 workflows/deliver/selftest.py   （约 3 秒）
"""
import importlib.util
import json
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "workflows", "tool-video"))
sys.path.insert(0, "/opt/gooday-harness/packages")

import publish as tv                                              # noqa: E402

# 【按路径显式加载，不用 import run】：两个 workflow 的入口都叫 run.py，
# 谁在 sys.path 前面就 import 到谁——第一次跑这个自检时拿到的是 tool-video 的 run，
# 报「module 'run' has no attribute 'candidates'」，看半天才反应过来
_spec = importlib.util.spec_from_file_location("deliver_run", os.path.join(HERE, "run.py"))
deliver = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(deliver)

ok_all = True


def show(label, cond, extra=""):
    global ok_all
    ok_all &= bool(cond)
    print(f"  {'✅' if cond else '❌'} {label}{('  ' + str(extra)) if extra else ''}")


# ---- 打桩：把 tv._req 换成假的，返回我们摆好的数据 ----

TICKETS = [
    # 最上面这张是【未收款的新单】：它不能占掉 limit=1 的唯一名额
    {"id": 101, "ticketNo": "GD-A", "title": "新单未收款", "status": "delivering", "clientId": 7},
    {"id": 102, "ticketNo": "GD-B", "title": "退款中",     "status": "refunding",  "clientId": 7},
    {"id": 103, "ticketNo": "GD-C", "title": "开发失败",   "status": "failed",     "clientId": 7},
    {"id": 104, "ticketNo": "GD-D", "title": "客户打回",   "status": "customer_rejected", "clientId": 7},
    {"id": 105, "ticketNo": "GD-E", "title": "线下客户",   "status": "delivering", "clientId": None},
    {"id": 106, "ticketNo": "GD-F", "title": "该做的这张", "status": "delivering", "clientId": 7},
]
PAID = {106}
DETAIL_DESC = "需求原文：做一个能算复利的小页面，输入本金年化年限，输出逐年余额表。"


class FakeResp:
    def __init__(self, obj):
        self._b = json.dumps(obj).encode()

    def read(self):
        return self._b


def fake_req(path, tok=None, method="GET", body=None, **kw):
    if path.startswith("/api/tickets?"):
        return FakeResp({"list": TICKETS})
    if path.startswith("/api/tickets/"):
        tid = int(path.rsplit("/", 1)[1])
        t = dict(next(x for x in TICKETS if x["id"] == tid))
        t["description"] = DETAIL_DESC          # 详情才有需求原文
        return FakeResp(t)
    if path.startswith("/api/finance?ticketId="):
        tid = int(path.split("ticketId=")[1].split("&")[0])
        return FakeResp({"list": ([{"type": "income", "paymentStatus": "received", "amount": 100}]
                                  if tid in PAID else [])})
    if path.startswith("/api/admin/tools/deliver/"):
        return FakeResp({"exists": False, "complete": False, "missing": ["还没上架"]})
    raise AssertionError(f"没打桩的请求：{path}")


def main():
    tv._req = fake_req

    print("=== 选题 ===")
    got = deliver.candidates(1)
    picked = [t["ticketNo"] for t, _ in got]
    show(f"只挑该做的那张，未收款的新单不占名额 → {picked}", picked == ["GD-F"])

    got3 = deliver.candidates(5)
    nos = [t["ticketNo"] for t, _ in got3]
    show(f"退款中/开发失败/客户打回 一个都不做 → {nos}",
         all(x not in nos for x in ("GD-B", "GD-C", "GD-D")))
    show("线下客户（没有平台账号）不做", "GD-E" not in nos)

    print("=== 需求原文 ===")
    t = got[0][0]
    show("选中的工单带着需求原文（列表接口不返回它，必须再拉详情）",
         DETAIL_DESC in (t.get("description") or ""))

    captured = {}

    def fake_call(ask, system, **kw):
        captured["ask"] = ask
        captured["system"] = system
        return "```html\n<!DOCTYPE html><html><body>" + "x" * 900 + "</body></html>\n```", True, ""

    deliver.mdl = types.SimpleNamespace(call=fake_call, is_infra_error=lambda *a, **k: False)
    html = deliver.generate_html(t)
    show("拼给模型的 prompt 里【真的带了需求原文】", DETAIL_DESC in captured["ask"])
    show("system 里带了威震天的铁则（单一真源）", "威震天" in captured["system"])
    show("交付契约要求单文件网页", "单文件网页" in captured["system"])
    show(f"生成结果过了自检（{len(html)} 字节）", len(html) > 800)

    print("=== 需求原文为空时必须拒做 ===")
    empty = dict(t)
    empty["description"] = ""
    try:
        deliver.generate_html(empty)
        show("空需求居然做了出来", False)
    except Exception as e:
        show(f"空需求被拒：{str(e)[:48]}…", "不按标题瞎做" in str(e))

    print("=== 交付物自检 ===")
    cases = [
        ("外链脚本", '<!DOCTYPE html><html><script src="https://cdn.x/a.js"></script>' + "y" * 900, True),
        ("对外 fetch", '<!DOCTYPE html><html><script>fetch("https://x.com/a")</script>' + "y" * 900, True),
        ("留着 TODO", '<!DOCTYPE html><html>TODO 待补' + "y" * 900, True),
        ("太小是空壳", '<!DOCTYPE html><html>hi</html>', True),
        ("正常单文件", '<!DOCTYPE html><html><script>let t=25</script>' + "y" * 900 + '</html>', False),
    ]
    for name, html_s, should_fail in cases:
        bad = deliver.check_html(html_s)
        show(f"{name} → {'拦下' if bad else '放行'}", bool(bad) == should_fail, bad[:1])

    print("\n判定:", "✅ 全部通过" if ok_all else "❌ 有不通过项")
    sys.exit(0 if ok_all else 1)


main()
