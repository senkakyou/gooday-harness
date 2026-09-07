#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第二层循环的引擎：Run → Evaluate → Learn → Improve → Experiment → Gate → Promote/Rollback。

**这是让「自我进化」从文档变成可运行代码的那一层。**
在它之前，evolution/ 只有 Gate（检查器）和 Evaluator（打分）两环有执行体，
Learn 与 Improve 是人在写文档——那样说「系统会自我进化」是自欺。

═══ 设计立场 ═══════════════════════════════════════════════════

**一、闭环必须能在没有大模型的情况下跑通。**
否则 CI 验证不了它，而验证不了的闭环就是又一个「写了但不知道有没有用」的东西。
所以 Improver 是可插拔的：默认用确定性策略库，模型驱动的实现作为可选项接入。

**二、任何环节失败都进安全状态。**
不是「失败了就跳过继续走」——那会让一轮空转被记成一轮成功。
每一环失败都标记 outcome=failed 并中止本轮，证据完整保留。

**三、Promote 必须有基线可比。**
没有基线时不允许自动 promote——「改完了没变差」和「不知道有没有变差」
是两回事。后者一律降级为「生成候选、等人决定」。

**四、全程留痕**：Task/Event/Evidence/Evaluation/Decision/Checkpoint 六样。
不是为了审计，是因为**你没法改进一件你看不见的事**。
"""
import json
import os
import sys
import time
import traceback
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "trace"))

from trace import Task                                    # noqa: E402

STATE = os.environ.get("GOODAY_HARNESS_STATE", "/var/lib/gooday-harness")
EXPERIENCE_DIR = os.path.join(STATE, "experience")
DECISION_DIR = os.path.join(STATE, "decisions")


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


# ════════════════════════ 各环的接口 ════════════════════════

class Subject:
    """被改进的对象。使用方实现这四个方法。

    `variant()` 是安全的关键：候选改动【必须先在隔离副本上跑】，
    不能直接改真身。改真身再回滚，等于把生产当实验场。
    """

    def run(self, inputs):
        raise NotImplementedError

    def variant(self, patch):
        """返回一个应用了 patch 的隔离副本（不影响自身）。"""
        raise NotImplementedError

    def checkpoint(self):
        """返回可回滚的当前状态快照。"""
        raise NotImplementedError

    def promote(self, patch):
        """真正应用改动。只有过了 Gate 才会被调用。"""
        raise NotImplementedError

    def rollback(self, checkpoint):
        raise NotImplementedError


class Outcome:
    def __init__(self, phase, status, detail=None):
        self.phase, self.status, self.detail = phase, status, detail or {}

    def __repr__(self):
        return f"<Outcome {self.phase}:{self.status}>"

    @property
    def ok(self):
        return self.status in ("ok", "promoted", "no_change_needed")


# ════════════════════════ 引擎 ════════════════════════

class Loop:
    def __init__(self, name, subject, *, evaluator, learner, improver,
                 gate, inputs, min_gain=0.0):
        self.name = name
        self.subject = subject
        self.evaluator = evaluator      # (results, inputs) -> Evaluation
        self.learner = learner          # (evaluation, results) -> [Experience]
        self.improver = improver        # ([Experience], evaluation) -> [Candidate]
        self.gate = gate                # (variant, inputs, baseline) -> GateResult
        self.inputs = inputs
        self.min_gain = min_gain        # 低于此增益不值得 promote

    def cycle(self, task=None):
        """跑一轮完整闭环。返回 Outcome。

        任何一环失败都【中止本轮并标 failed】，不继续往下走——
        「执行失败但系统认为成功」是本项目最痛恨的形态。
        """
        own_task = task is None
        t = task or Task(f"evolve:{self.name}", actor=f"evolve/{self.name}")
        if own_task:
            t.__enter__()
        try:
            return self._cycle(t)
        except Exception as e:
            t.event("cycle_crashed", "P0",
                    {"error": f"{type(e).__name__}: {e}",
                     "traceback": traceback.format_exc()[-1500:]})
            return Outcome("cycle", "failed", {"error": str(e)})
        finally:
            if own_task:
                t.__exit__(None, None, None)

    # ── 六环 ──────────────────────────────────────────────
    def _cycle(self, t):
        # ① Run
        try:
            results = self.subject.run(self.inputs)
        except Exception as e:
            t.event("run_failed", "P1", {"error": str(e)})
            return Outcome("run", "failed", {"error": str(e)})
        t.event("run_done", "P3", {"n": len(results)})

        # ② Evaluate
        ev = self.evaluator(results, self.inputs)

        # Evidence 先落盘再打分引用它——【没有证据的评价是拍脑袋】。
        # 原来只写 Evaluation 不写 Evidence，等于结论有了、依据没了，
        # 别人无法重新检验（policies G07）。
        eid = uuid.uuid4().hex[:8]
        epath = os.path.join(STATE, "evidence", f"{_now()[:10]}-{self.name}-{eid}.json")
        _write(epath, {"loop": self.name, "at": _now(),
                       "inputs": self.inputs, "results": results,
                       "detail": ev.get("evidence"), "failures": ev.get("failures")})
        ev["evidence_refs"] = [epath]

        _write(os.path.join(STATE, "evaluations",
                            f"{_now()[:10]}-{self.name}-{uuid.uuid4().hex[:8]}.json"),
               {"loop": self.name, "at": _now(), **ev})
        t.event("evaluated", "P2" if ev.get("verdict") != "pass" else "P3",
                {k: ev.get(k) for k in ("score", "verdict", "reasons")})

        baseline = ev.get("score")
        if ev.get("verdict") == "pass":
            # 已经达标就不折腾——【没问题时不改动】本身是一条纪律。
            # 为了「让循环转起来」而改一个正常的系统，是最容易被忽略的破坏方式。
            t.event("no_change_needed", "P3", {"score": baseline})
            return Outcome("evaluate", "no_change_needed", {"score": baseline})

        # ③ Learn —— 沉淀成结构化经验，不是写一篇文档
        exps = self.learner(ev, results)
        for e in exps:
            e.setdefault("id", uuid.uuid4().hex[:8])
            e.setdefault("at", _now())
            e["loop"] = self.name
            _write(os.path.join(EXPERIENCE_DIR, f"{e['id']}.json"), e)
        t.event("learned", "P3", {"experiences": len(exps),
                                  "kinds": sorted({e.get("kind") for e in exps})})
        if not exps:
            # 评价说不合格，却学不到任何东西 —— 这本身是个问题，不能装作没事
            t.event("learn_empty", "P1",
                    {"why": "评价判不合格但没沉淀出任何经验，说明 learner 覆盖不到这类失败"})
            return Outcome("learn", "failed", {"why": "no experience extracted"})

        # ④ Improve —— 生成候选，每个必须说清改什么/影响面/风险/验收指标
        cands = self.improver(exps, ev)
        t.event("improved", "P3", {"candidates": len(cands),
                                   "targets": [c.get("target") for c in cands]})
        if not cands:
            t.event("no_candidate", "P2",
                    {"why": "有经验但生成不出候选——需要人来看这类失败"})
            return Outcome("improve", "needs_human", {"experiences": len(exps)})

        # ⑤ Experiment ＋ ⑥ Gate（逐个候选，第一个过关的胜出）
        #
        # 【只有「门禁正常判否」才继续试下一个】。其余结论一律原样返回，
        # 不能被后面的候选覆盖掉——原因有二：
        #   · 安全：promote 后回滚过，真身刚被动过，接着拿下一个候选去试是拿真身冒险；
        #     门禁自身崩溃时，后面每个候选也只会照样崩。
        #   · 可诊断：把 rolled_back / needs_human / gate_crashed 统统压成
        #     一句 all_rejected，值班的人就分不出「按设计拒绝了」和
        #     「上线后变差、已回滚」——后者是 P0。**丢掉原因等于丢掉这次事故。**
        last = None
        for c in cands:
            r = self._try_candidate(t, c, baseline)
            if r.ok:
                return r
            if r.status != "rejected":
                return r                       # 终止性结论：不再试，不被覆盖
            last = r
        return Outcome("gate", "all_rejected",
                       {"tried": len(cands), "last_reasons": last.detail if last else None})

    def _try_candidate(self, t, cand, baseline):
        cid = cand.setdefault("id", uuid.uuid4().hex[:8])

        # Decision 先写：没有理由的改动不许跑（G07）
        dec = {"id": cid, "loop": self.name, "at": _now(),
               "target": cand.get("target"), "why": cand.get("why"),
               "scope": cand.get("scope"), "risk": cand.get("risk"),
               "acceptance": cand.get("acceptance"),
               "baseline": baseline, "status": "experimenting"}
        dpath = os.path.join(DECISION_DIR, f"{_now()[:10]}-{self.name}-{cid}.json")
        _write(dpath, dec)
        t.event("decision_created", "P3", {"candidate": cid,
                                           "target": cand.get("target")})

        # ⑤ Experiment：【在隔离副本上跑】，绝不改真身
        try:
            variant = self.subject.variant(cand["patch"])
        except Exception as e:
            t.event("variant_failed", "P1", {"candidate": cid, "error": str(e)})
            dec.update(status="failed", result=f"隔离副本构造失败: {e}")
            _write(dpath, dec)
            return Outcome("experiment", "failed", {"candidate": cid})

        # ⑥ Gate：跑门禁 ＋ 与基线比较
        try:
            g = self.gate(variant, self.inputs, baseline)
        except Exception as e:
            # 门禁自己挂了【不能当成通过】——这是本项目最痛恨的形态
            t.event("gate_crashed", "P0", {"candidate": cid, "error": str(e)})
            dec.update(status="rejected", result=f"门禁执行失败: {e}")
            _write(dpath, dec)
            return Outcome("gate", "failed", {"candidate": cid})

        gain = (g.get("score") or 0) - (baseline or 0)
        t.event("gated", "P2", {"candidate": cid, "passed": g.get("passed"),
                                "score": g.get("score"), "baseline": baseline,
                                "gain": round(gain, 4), "reasons": g.get("reasons")})

        if not g.get("passed"):
            dec.update(status="rejected", result=g.get("reasons"))
            _write(dpath, dec)
            return Outcome("gate", "rejected", {"candidate": cid,
                                                "reasons": g.get("reasons")})

        if baseline is None:
            # 【没有基线不许自动 promote】。「改完了没变差」和
            # 「不知道有没有变差」是两回事，后者必须由人来判。
            dec.update(status="needs_human", result="无基线可比，不允许自动 promote")
            _write(dpath, dec)
            t.event("promote_blocked", "P1",
                    {"candidate": cid, "why": "无基线可比"})
            return Outcome("gate", "needs_human", {"candidate": cid})

        if gain <= self.min_gain:
            dec.update(status="rejected",
                       result=f"增益 {gain:.4f} 未超过阈值 {self.min_gain}")
            _write(dpath, dec)
            return Outcome("gate", "rejected", {"candidate": cid, "gain": gain})

        # ⑦ Promote —— 先存回滚点
        ckpt = self.subject.checkpoint()
        cpath = os.path.join(STATE, "checkpoints", f"{self.name}-{cid}.json")
        _write(cpath, {"loop": self.name, "candidate": cid,
                       "at": _now(), "checkpoint": ckpt})
        try:
            self.subject.promote(cand["patch"])
        except Exception as e:
            t.event("promote_failed", "P0", {"candidate": cid, "error": str(e)})
            self.subject.rollback(ckpt)
            t.event("rolled_back", "P1", {"candidate": cid, "why": "promote 失败"})
            dec.update(status="rolled_back", result=f"promote 失败已回滚: {e}")
            _write(dpath, dec)
            return Outcome("promote", "failed", {"candidate": cid})

        # Promote 后【再验一次】：改上去之后是不是真的还好
        try:
            after = self.evaluator(self.subject.run(self.inputs), self.inputs)
        except Exception as e:
            self.subject.rollback(ckpt)
            t.event("rolled_back", "P0", {"candidate": cid,
                                          "why": f"promote 后复验崩溃: {e}"})
            dec.update(status="rolled_back", result=f"复验崩溃: {e}")
            _write(dpath, dec)
            return Outcome("promote", "failed", {"candidate": cid})

        if (after.get("score") or 0) < (baseline or 0):
            # 隔离副本上过了、真身上却变差——必须回滚。
            # 这种情况真实存在：副本与真身的环境差异。
            self.subject.rollback(ckpt)
            t.event("rolled_back", "P0",
                    {"candidate": cid, "before": baseline,
                     "after": after.get("score"),
                     "why": "promote 后实测低于基线"})
            dec.update(status="rolled_back",
                       result=f"promote 后 {after.get('score')} < 基线 {baseline}")
            _write(dpath, dec)
            return Outcome("promote", "rolled_back", {"candidate": cid})

        dec.update(status="promoted", result={"before": baseline,
                                              "after": after.get("score")},
                   checkpoint=cpath)
        _write(dpath, dec)
        t.event("promoted", "P2", {"candidate": cid, "before": baseline,
                                   "after": after.get("score"),
                                   "checkpoint": cpath})
        return Outcome("promote", "promoted",
                       {"candidate": cid, "before": baseline,
                        "after": after.get("score")})
