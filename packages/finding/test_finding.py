#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""finding 自测。重点在两处：失败方向、聚合真的在聚合。"""
import json
import os
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="finding-test-")
import finding                                             # noqa: E402

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'✅' if cond else '❌'} {name}" + (f"\n       {detail}" if not cond and detail else ""))


print("\n=== finding 自测 ===\n")

tbl = {"finding:services": {"disposition": "auto"},
       "finding:assets": {"disposition": "notify-only"}}

check("表里的 auto 项判 auto", finding.classify("finding:services", tbl) == ("auto", True))
check("表里的 notify 项判 notify-only",
      finding.classify("finding:assets", tbl) == ("notify-only", True))

# 【失败方向】：不在表里 → notify-only 且 known=False
d, known = finding.classify("finding:从没见过", tbl)
check("不在表里 → notify-only（向人判断的方向失败）", d == "notify-only")
check("不在表里 → known=False（调用方必须另报 P2）", known is False)

# 表读不到时不能变成「全部自动处置」
rules, default, err = finding.load_table("/nonexistent/table.json")
check("规则表读不到 → 默认 notify-only 且报错", default == "notify-only" and err,
      (default, err))
check("规则表读不到 → 规则为空（不是沿用上次）", rules == {})

# 真实的表：所有 auto 项必须是幂等可回滚的那几类
real, _, _ = finding.load_table()
autos = [k for k, v in real.items() if v.get("disposition") == "auto"]
check("真实表里 auto 项只有服务与凭据两类",
      set(autos) == {"finding:services", "finding:credentials"}, autos)

print()
# ── 聚合 ──────────────────────────────────────────────
os.environ["GOODAY_HARNESS_STATE"] = TMP
F = {"check": "assets", "what": "有 2 项已发布内容的文件丢了",
     "why": "已 5.9 小时未更新"}          # why 带可变数字，不该进指纹
F2 = dict(F, why="已 6.4 小时未更新")

check("指纹只看 check+what，不看会变的 why",
      finding.fingerprint(F) == finding.fingerprint(F2))
check("不同 what → 不同指纹",
      finding.fingerprint(F) != finding.fingerprint(dict(F, what="别的事")))

agg = finding.Aggregator("t", window_min=60, state_dir=TMP)
first, n1 = agg.see(F)
second, n2 = agg.see(F2)
third, n3 = agg.see(F)
check("窗口内第一次落事件", first and n1 == 1)
check("窗口内重复只累加不落新事件", (not second) and n2 == 2, (second, n2))
check("累加持续", (not third) and n3 == 3, (third, n3))
check("被压掉的条目查得到（摘要里要如实交代压了多少）",
      len(agg.suppressed()) == 1 and list(agg.suppressed().values())[0]["count"] == 3)

# 跨轮次：落盘后新建实例应继续聚合
agg.flush()
agg2 = finding.Aggregator("t", window_min=60, state_dir=TMP)
again, n4 = agg2.see(F)
check("跨轮次仍然聚合（巡检每轮是新进程）", (not again) and n4 == 4, (again, n4))

# 超窗后重新落
agg3 = finding.Aggregator("t2", window_min=60, state_dir=TMP)
agg3.see(F)
agg3.seen[finding.fingerprint(F)]["first"] = time.time() - 7200
out, _ = agg3.see(F)
check("超出窗口后重新落一条（不能永远压着）", out)

shutil.rmtree(TMP, ignore_errors=True)
print(f"\n{'─'*46}\n通过 {len(PASS)} · 失败 {len(FAIL)}")
if FAIL:
    print("失败：" + "、".join(FAIL))
sys.exit(1 if FAIL else 0)
