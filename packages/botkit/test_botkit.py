#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""botkit 自测。覆盖的是【会真的坏】的路径。"""
import os, sys, tempfile, shutil, json, time
TMP = tempfile.mkdtemp(prefix="botkit-test-")
os.environ["GOODAY_HARNESS_STATE"] = TMP
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model, outbound, inbox
model.STATE = TMP; model.SLOTS_DB = os.path.join(TMP, "state", "model-slots.db")
inbox.STATE = TMP

ok = fail = 0
def check(name, cond, detail=""):
    global ok, fail
    if cond: ok += 1; print(f"  ✅ {name}")
    else: fail += 1; print(f"  ❌ {name}  {detail}")

print("\n=== 1. 并发闸门 ===")
hs = [model._acquire("t", 60) for _ in range(5)]
got = [h for h in hs if h]
check("最多同时 3 个槽位", len(got) == 3, f"实际 {len(got)}")
for h in got: model._release(h)
check("释放后能再取", model._acquire("t", 60) is not None)

print("\n=== 2. 闸门坏掉时【放行】而不是阻断 ===")
bad = model.SLOTS_DB
model.SLOTS_DB = "/proc/cannot/write/slots.db"
h = model._acquire("t", 60)
check("槽位库不可用时降级放行", h is not None, "辅助设施不该阻断主流程")
model.SLOTS_DB = bad

print("\n=== 3. 基础设施错误识别 ===")
check("认得 OAuth 失效", model.is_infra_error("Failed to authenticate: OAuth session expired", 1))
check("认得未登录", model.is_infra_error("not logged in", 1))
check("正常业务输出不误判", not model.is_infra_error("这是模型的正常回答", 0))

print("\n=== 4. 出口白名单（默认拒绝）===")
outbound.configure({20: {1}, 23: "*"})
check("白名单内放行", outbound.allowed(20, 1))
check("白名单外拦截", not outbound.allowed(20, 999))
check("* 表示任意", outbound.allowed(23, 12345))
check("【未登记的角色默认拒绝】", not outbound.allowed(99, 1), "默认允许是安全灾难")

print("\n=== 5. 幂等认领 ===")
inbox.claim("demo", "k1", sender=7)
check("认领已落盘", "k1" in inbox.read_pending("demo"))
inbox.resolve("demo", "k1")
check("完成后清除", "k1" not in inbox.read_pending("demo"))

print("\n=== 6. 失败必回执（不许静默吞）===")
got_receipt = []
def handler(s, m): raise RuntimeError("故意炸")
def on_error(s, e): got_receipt.append((s, str(e)))
o, f = inbox.process("demo", {7: [{"Id": 1}]}, handler, on_error)
check("失败被计数", f == 1)
check("调用方收到了回执", len(got_receipt) == 1, got_receipt)
check("认领已清理（不留僵尸）", not inbox.read_pending("demo"))

print("\n=== 7. 处理完必须认领掉（2026-09-07 事故回归测试）===")
# 事故：unread() 从不标已读（迁移期的影子模式保护活过了它该在的时期），
# 每轮轮询都把同一条当新消息重答——站长一句「你好」被回了 14 条。
# 心跳绿、服务 active、patrol 全绿，没有任何东西会说。
marked = []
inbox.process("demo2", {8: [{"Id": 11}, {"Id": 12}]},
              lambda s, m: None, lambda s, e: None,
              mark_read=lambda ids: marked.extend(ids))
check("成功后标已读", marked == [11, 12], marked)

marked2, receipts2 = [], []
inbox.process("demo3", {9: [{"Id": 21}]},
              lambda s, m: (_ for _ in ()).throw(RuntimeError("炸")),
              lambda s, e: receipts2.append(s),
              mark_read=lambda ids: marked2.extend(ids))
check("【失败也要标】否则「处理异常」会一直刷屏",
      marked2 == [21] and len(receipts2) == 1, (marked2, receipts2))

# 反向：不传 mark_read 就是事故当时的行为 —— 消息永远留在未读里。
# 这条断言在于证明【测试真的能分辨修没修】。
seen = []
for _ in range(3):
    inbox.process("demo4", {10: [{"Id": 31}]},
                  lambda s, m: seen.append(1), lambda s, e: None)
check("不认领时同一条会被反复处理（事故形态可复现）", len(seen) == 3, seen)

shutil.rmtree(TMP, ignore_errors=True)
print(f"\n{'─'*44}\n通过 {ok} · 失败 {fail}")
sys.exit(1 if fail else 0)
