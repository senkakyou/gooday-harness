#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""evolution/evaluators/<名字> 的执行体。

【本文件是模板】。评价器回答一个问题：**刚才那次做得怎么样。**

    cp -r evolution/evaluators/_template evolution/evaluators/<名字>

它是第二层循环的入口——没有评价，系统就只会「做完」，不会「做得更好」。
"""
import json
import os
import time
import uuid

NAME = os.path.basename(os.path.dirname(os.path.abspath(__file__)))

EVAL_DIR = "/var/lib/gooday-harness/evaluations"
EVIDENCE_DIR = "/var/lib/gooday-harness/evidence"


def collect_evidence(target):
    """取证据。**没有证据的评价不算数**（policies G07）。

    证据是「凭什么这么判」的原始材料：日志片段、指标、客户回复、产物样本。
    它必须能被别人重新检验——否则评价就是拍脑袋，
    而用拍脑袋的评价驱动自动改进，只会把噪音放大成系统性偏移。

    返回 [(描述, 内容)]，会被落盘到 EVIDENCE_DIR。
    """
    raise NotImplementedError


def score(target, evidence):
    """打分。返回 (score: float, verdict: str, reasons: list[str])。

    verdict ∈ {"pass", "warn", "fail"}。

    铁律：**「fail」这一档必须真的会被判出来。**
    从不判失败的评价器等于没有，它只会制造「一切都好」的错觉——
    真实教训：巡检连续三周报「一切正常」，而凭据其实早就失效了，
    因为那条检查对「文件不存在」的情况是静默跳过的。

    reasons 要具体。「质量不好」不是原因，「客户三次追问同一个字段」才是。
    """
    raise NotImplementedError


def save(target_id, sc, verdict, reasons, evidence_refs):
    """落一条 Evaluation。这是第二层循环的燃料，格式别随意改。"""
    os.makedirs(EVAL_DIR, exist_ok=True)
    rec = {
        "id": str(uuid.uuid4()),
        "evaluator": NAME,
        "target": target_id,
        "score": sc,
        "verdict": verdict,
        "reasons": reasons,
        "evidence_refs": evidence_refs,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    path = os.path.join(EVAL_DIR, f"{rec['at'][:10]}-{NAME}-{rec['id'][:8]}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rec, f, ensure_ascii=False, indent=2)
    return path


def evaluate(target, target_id):
    """对外入口。"""
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    refs = []
    for i, (desc, content) in enumerate(collect_evidence(target)):
        p = os.path.join(EVIDENCE_DIR, f"{target_id}-{NAME}-{i}.txt")
        with open(p, "w", encoding="utf-8") as f:
            f.write(f"# {desc}\n{content}")
        refs.append(p)

    sc, verdict, reasons = score(target, refs)
    return save(target_id, sc, verdict, reasons, refs)


if __name__ == "__main__":
    raise SystemExit("本文件是模板，复制后实现 collect_evidence / score 再用")
