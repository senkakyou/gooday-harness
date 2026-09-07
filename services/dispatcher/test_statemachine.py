#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""状态机自测。重点是【防诈尸】——它当年真把跑着的单打成过 failed。"""
import importlib.util, sys, os
spec=importlib.util.spec_from_file_location("m", os.path.join(os.path.dirname(os.path.abspath(__file__)),"main.py"))
m=importlib.util.module_from_spec(spec)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), "packages", "trace"))
try: spec.loader.exec_module(m)
except SystemExit: pass

ok=fail=0
def check(name, got, want):
    global ok, fail
    if got == want: ok+=1; print(f"  ✅ {name}")
    else: fail+=1; print(f"  ❌ {name}  期望 {want} 实际 {got}")

def d(status, event):
    return m.decide({"Status": status}, {"EventType": event})

print("\n=== 1. 合法迁移 ===")
check("pending + analysis_done", d("pending","analysis_done"), ("transition","analyst_complete"))
check("confirmed + payment_confirmed", d("confirmed","payment_confirmed"), ("transition","in_progress"))
check("in_progress + dev_done", d("in_progress","dev_done"), ("transition","delivering"))

print("\n=== 2. 防诈尸：状态机拥有的事件遇非法迁移必须被消费 ===")
# 这四个当年就是漏网的，非法时留成 new，工单状态回退后诈尸重放
for et in ("dev_failed","rework_approved","refund_approved","refund_recorded"):
    action,_ = d("pending", et)
    check(f"pending + {et} 被消费（不留 new）", action is not None, True)

print("\n=== 3. 越权事件要告警，陈旧事件只消费不告警 ===")
check("未付款就 dev_done → illegal", d("pending","dev_done")[0], "illegal")
check("陈旧的 rework_approved → stale", d("pending","rework_approved")[0], "stale")

print("\n=== 4. 终态之后的迁移事件也要消费 ===")
for st in ("done","refunded","cancelled"):
    action,_ = d(st, "dev_done")
    check(f"{st} + dev_done 被消费", action, "stale")

print("\n=== 5. 非状态机事件不碰（留给各自消费者）===")
for et in ("payment_claimed","scope_change","routed","progress"):
    check(f"{et} 不处理", d("pending", et), (None,None))

print("\n=== 6. 事件集合确实是【派生】的，不是手写 ===")
derived = {et for (_s,et) in m.TRANSITIONS}
check("_TRANSITION_EVENTS == 从 TRANSITIONS 派生", m._TRANSITION_EVENTS, derived)

print(f"\n{'─'*44}\n通过 {ok} · 失败 {fail}")
sys.exit(1 if fail else 0)
