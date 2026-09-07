#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""闭环引擎的自测 —— 重点在【失败路径】。

成功路径由 examples/hello-harness 演示（30%→100% 自动收敛）。
但一个只在顺利时能跑的闭环是危险的：它会在出事那天
把坏东西 promote 上去，然后报告说「一轮成功」。

所以这里逐条验证每道防线**真的会触发**：
门禁挂了不算过、promote 后变差要回滚、无基线不许自动上、
学不到东西要认账、退化的候选要拦住。

判据：`python3 packages/evolve/test_loop.py` 退出码 0。
"""
import os
import shutil
import sys
import tempfile

STATE = tempfile.mkdtemp(prefix="evolve-test-")
os.environ["GOODAY_HARNESS_STATE"] = STATE
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import loop as L                                            # noqa: E402

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'✅' if cond else '❌'} {name}" + (f"\n       {detail}" if not cond and detail else ""))


class FakeSubject(L.Subject):
    """可编程的假被试：想让哪一步炸就让哪一步炸。"""

    def __init__(self, score=0.5, **boom):
        self.score, self.boom = score, boom
        self.state = ["base"]
        self.rolled_back = False
        self.promoted = []

    def run(self, inputs):
        if self.boom.get("run"):
            raise RuntimeError("run 炸了")
        return {"score": self.score, "state": list(self.state)}

    def variant(self, patch):
        if self.boom.get("variant"):
            raise RuntimeError("变体构造炸了")
        v = FakeSubject(self.score)
        v.state = self.state + [patch]
        return v

    def checkpoint(self):
        return list(self.state)

    def promote(self, patch):
        if self.boom.get("promote"):
            raise RuntimeError("promote 炸了")
        self.promoted.append(patch)
        self.state.append(patch)
        if "after_promote_score" in self.boom:
            self.score = self.boom["after_promote_score"]

    def rollback(self, ckpt):
        self.rolled_back = True
        self.state = list(ckpt)


def mk(subject, *, gate=None, learner=None, improver=None, baseline_score=None,
       min_gain=0.0):
    """装配一个 Loop，各环给出合理默认值。"""
    def ev(results, inputs):
        s = results["score"] if baseline_score is None else baseline_score
        return {"score": s, "verdict": "pass" if s >= 1.0 else "fail",
                "failures": [{"case": "x"}], "evidence": {"n": 1}}

    return L.Loop(
        "t", subject,
        evaluator=ev,
        learner=learner or (lambda e, r: [{"kind": "k", "what": "w"}]),
        improver=improver or (lambda x, e: [{"target": "t", "why": "w", "scope": "s",
                                             "risk": "r", "acceptance": "a",
                                             "patch": "p"}]),
        gate=gate or (lambda v, i, b: {"passed": True, "score": 0.9, "reasons": []}),
        inputs={}, min_gain=min_gain)


print("\n=== 闭环引擎失败路径自测 ===\n")

# ① 门禁自己崩溃 —— 绝不能当成通过
s = FakeSubject()
r = mk(s, gate=lambda v, i, b: (_ for _ in ()).throw(RuntimeError("门禁炸了"))).cycle()
check("门禁崩溃 → 不算通过，不 promote",
      r.status == "failed" and not s.promoted, f"得到 {r}")

# ② 门禁判否 —— 拦住
s = FakeSubject()
r = mk(s, gate=lambda v, i, b: {"passed": False, "score": 0.2,
                                "reasons": ["退化"]}).cycle()
# 单个候选被拒 → all_rejected（「都试过了，都不行」），仍是拒绝语义
check("门禁判否 → 拒绝，不 promote",
      r.status in ("rejected", "all_rejected") and not s.promoted, f"得到 {r}")

# ③ promote 后实测低于基线 —— 必须回滚
s = FakeSubject(score=0.5, after_promote_score=0.1)
r = mk(s).cycle()
check("promote 后变差 → 自动回滚",
      r.status == "rolled_back" and s.rolled_back and s.state == ["base"],
      f"得到 {r}，state={s.state}，rolled_back={s.rolled_back}")

# ④ promote 动作本身崩溃 —— 回滚
s = FakeSubject(score=0.5, promote=True)
r = mk(s).cycle()
check("promote 崩溃 → 自动回滚",
      r.status == "failed" and s.rolled_back, f"得到 {r}")

# ⑤ 没有基线 —— 不许自动上，交给人
s = FakeSubject()          # 全新的：不能复用跑过 promote 的那个
r2 = L.Loop("t2", s,
            evaluator=lambda res, i: {"score": None, "verdict": "fail",
                                      "failures": [], "evidence": {}},
            learner=lambda e, r: [{"kind": "k"}],
            improver=lambda x, e: [{"target": "t", "patch": "p"}],
            gate=lambda v, i, b: {"passed": True, "score": 0.9},
            inputs={}).cycle()
check("无基线可比 → 不自动 promote，转人工",
      r2.status == "needs_human" and not s.promoted, f"得到 {r2}")

# ⑥ 增益不足 —— 不值得改
s = FakeSubject(score=0.5)
r = mk(s, gate=lambda v, i, b: {"passed": True, "score": 0.5001},
       min_gain=0.05).cycle()
check("增益低于阈值 → 拒绝（不为改而改）",
      r.status in ("rejected", "all_rejected") and not s.promoted, f"得到 {r}")

# ⑦ 判了不合格却学不到东西 —— 这本身是问题，不许装作没事
s = FakeSubject()
r = mk(s, learner=lambda e, r: []).cycle()
check("判不合格但学不到经验 → 标 failed（不静默跳过）",
      r.status == "failed", f"得到 {r}")

# ⑧ 有经验但生成不出候选 —— 转人工，不是「成功」
s = FakeSubject()
r = mk(s, improver=lambda x, e: []).cycle()
check("生成不出候选 → 转人工（不报成功）",
      r.status == "needs_human" and not r.ok, f"得到 {r}")

# ⑨ run 崩溃 —— 中止本轮
s = FakeSubject(run=True)
r = mk(s).cycle()
check("run 崩溃 → 中止本轮，不继续往下走",
      r.status == "failed" and not s.promoted, f"得到 {r}")

# ⑩ 变体构造失败 —— 绝不退化成「改真身试试」
s = FakeSubject(variant=True)
r = mk(s).cycle()
check("隔离副本构造失败 → 中止，绝不改真身",
      r.status == "failed" and not s.promoted and s.state == ["base"],
      f"得到 {r}，state={s.state}")

# ⑪ 已达标就不折腾
s = FakeSubject(score=1.0)
r = mk(s).cycle()
check("已达标 → no_change_needed（不为转而转）",
      r.status == "no_change_needed" and not s.promoted, f"得到 {r}")

# ⑫ 实验绝不污染真身：变体改了，真身状态不动
s = FakeSubject()
s.variant("xx")
check("变体不影响真身", s.state == ["base"], f"state={s.state}")

# ⑬ 留痕：失败的轮次也要留下 Decision，不能只记成功的
n_dec = len(os.listdir(os.path.join(STATE, "decisions")))
check("失败轮次同样留 Decision（可复盘）", n_dec >= 6, f"只有 {n_dec} 份")

print(f"\n{'─'*52}\n通过 {len(PASS)} · 失败 {len(FAIL)}")
if FAIL:
    print("失败：" + "、".join(FAIL))
shutil.rmtree(STATE, ignore_errors=True)
sys.exit(1 if FAIL else 0)
