#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""比对新旧 patrol 在同一时间窗内的结论是否一致。

这是第二层循环的第一个真实评价器。它回答一个具体的待决问题：
**新 patrol 能不能从影子切成生产？**

`workflows/patrol/README.md` 写着「连续 7 天与旧 patrol 结论一致才可切 active」，
但此前没有任何人在量这句话——那它就只是一句愿望。本文件把它变成可测的。

用法：
    python3 evaluate.py [--days 1]
"""
import glob
import json
import os
import re
import sys
import time
import uuid

NAME = "patrol-agreement"

STATE = os.environ.get("GOODAY_HARNESS_STATE", "/var/lib/gooday-harness")
EVAL_DIR = os.path.join(STATE, "evaluations")
EVIDENCE_DIR = os.path.join(STATE, "evidence")
EVENT_DIR = os.path.join(STATE, "events")

OLD_LOG = "/opt/gooday/scripts/lingxi-coo-patrol.log"

# 同一"时刻"的容差：两个 patrol 错开 2 分钟跑，容差要盖得住又不能太宽
WINDOW_SEC = 200

# 判据：见 experiments/patrol-cutover/README.md，那里是真源，这里只是执行
MIN_SAMPLES = 288 * 7            # 7 天 × 每天 288 轮（5 分钟一轮）
OLD_LINE = re.compile(r"^\[(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\]\[COO巡检\] (.+)$")


def _old_verdicts(since_ts):
    """旧 patrol 的结论。返回 [(epoch, clean: bool, 原文)]。"""
    out = []
    if not os.path.exists(OLD_LOG):
        return out
    year = time.gmtime().tm_year
    with open(OLD_LOG, encoding="utf-8", errors="ignore") as f:
        for line in f:
            m = OLD_LINE.match(line.strip())
            if not m:
                continue
            mo, d, hh, mm, ss, body = m.groups()
            try:
                ts = time.mktime((year, int(mo), int(d), int(hh), int(mm),
                                  int(ss), 0, 0, -1))
            except Exception:
                continue
            if ts < since_ts:
                continue
            out.append((ts, "一切正常" in body, line.strip()))
    return out


def _new_verdicts(since_ts):
    """新 patrol 的结论，来自它自己写的 patrol_summary 事件。"""
    out = []
    for fn in sorted(glob.glob(os.path.join(EVENT_DIR, "*.jsonl"))):
        with open(fn, encoding="utf-8") as f:
            for line in f:
                try:
                    e = json.loads(line)
                except Exception:
                    continue          # 坏一行不影响其余，这正是 JSONL 的用意
                if e.get("type") != "patrol_summary":
                    continue
                ts = time.mktime(time.strptime(e["at"], "%Y-%m-%dT%H:%M:%SZ"))
                if ts < since_ts:
                    continue
                p = e.get("payload", {})
                clean = p.get("findings", 0) == 0 and not p.get("failed_checks")
                out.append((ts, clean, json.dumps(p, ensure_ascii=False)))
    return out


def collect_evidence(days):
    """取证据。没有证据的评价不算数（policies G07）。"""
    since = time.time() - days * 86400
    old, new = _old_verdicts(since), _new_verdicts(since)

    pairs, unmatched_new = [], []
    for ts, clean, raw in new:
        near = [o for o in old if abs(o[0] - ts) <= WINDOW_SEC]
        if not near:
            unmatched_new.append((ts, raw))
            continue
        o = min(near, key=lambda x: abs(x[0] - ts))
        pairs.append({"at": time.strftime("%F %T", time.localtime(ts)),
                      "old_clean": o[1], "new_clean": clean,
                      "agree": o[1] == clean, "old_raw": o[2], "new_raw": raw})
    return {"days": days, "old_count": len(old), "new_count": len(new),
            "pairs": pairs, "unmatched_new": unmatched_new}


def score(ev):
    """打分。**必须能判 fail**——从不判失败的评价器只会制造一切都好的错觉。

    ═══ 但「没数据」有两种，2026-09-07 之后必须分开 ═══════════════

    本评价器原来把「没有可配对样本」一律判 fail，理由是：两边都没数据
    和两边一致长得一样，而前者是故障。**当时对。**

    切换完成后不再对：旧 patrol 已随 /opt/gooday 一起退役，
    它的日志文件永久消失了。此时报「一致率 0.0%」读起来像
    「新旧 patrol 不一致」——**而真相是比对对象根本不存在了**。
    这条评价器每天 08:00 会永久 fail 一次，是纯噪音，
    而噪音会训练人忽略告警。

    所以判据分成：
      · 旧日志文件【不存在】 → retired：对象已退役，本评价器使命完成
      · 文件【在但没数据】   → 仍判 fail：旧 patrol 意外停了，那是故障
    """
    pairs = ev["pairs"]
    reasons = []

    if not os.path.exists(OLD_LOG):
        return None, "retired", [
            f"比对对象已退役：{OLD_LOG} 不存在。",
            "旧 patrol 随 /opt/gooday 一起下线（2026-09-07 切换完成），",
            "本评价器要回答的问题「新 patrol 能不能从影子切成生产」已不成立——",
            "没有旧的可比了。处置见 docs/decisions/003-patrol-cutover.md。"]

    if not pairs:
        return 0.0, "fail", [
            "没有任何可比对的样本。"
            f"旧 patrol {ev['old_count']} 轮、新 patrol {ev['new_count']} 轮，"
            f"但没有落在 ±{WINDOW_SEC}s 窗口内的配对——"
            "要么有一方没在跑，要么两者时间戳基准不同"]

    disagree = [p for p in pairs if not p["agree"]]
    rate = 1 - len(disagree) / len(pairs)

    if disagree:
        reasons.append(f"{len(disagree)}/{len(pairs)} 轮结论不一致")
        for p in disagree[:3]:
            reasons.append(
                f"  {p['at']} 旧={'正常' if p['old_clean'] else '有发现'} "
                f"新={'正常' if p['new_clean'] else '有发现'}")
    if ev["unmatched_new"]:
        reasons.append(f"{len(ev['unmatched_new'])} 轮新 patrol 找不到对应的旧记录"
                       "（旧 patrol 那轮没跑？）")

    if len(pairs) < MIN_SAMPLES:
        reasons.append(f"样本 {len(pairs)}/{MIN_SAMPLES}，未达 7 天判据——"
                       "一致率再高也还不能作为切换依据")
        return rate, "warn", reasons

    if disagree:
        return rate, "fail", reasons
    return 1.0, "pass", [f"{len(pairs)} 轮全部一致，达成 7 天判据"]


def main():
    days = 1
    if "--days" in sys.argv:
        days = int(sys.argv[sys.argv.index("--days") + 1])

    ev = collect_evidence(days)
    sc, verdict, reasons = score(ev)

    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    os.makedirs(EVAL_DIR, exist_ok=True)
    eid = uuid.uuid4().hex[:8]

    ep = os.path.join(EVIDENCE_DIR, f"{NAME}-{eid}.json")
    with open(ep, "w", encoding="utf-8") as f:
        json.dump(ev, f, ensure_ascii=False, indent=2)

    at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rec = {"id": eid, "evaluator": NAME, "target": "workflows/patrol",
           "score": None if sc is None else round(sc, 4),
           "verdict": verdict, "reasons": reasons,
           "evidence_refs": [ep], "at": at}
    rp = os.path.join(EVAL_DIR, f"{at[:10]}-{NAME}-{eid}.json")
    with open(rp, "w", encoding="utf-8") as f:
        json.dump(rec, f, ensure_ascii=False, indent=2)

    icon = {"pass": "✅", "warn": "⚠️", "fail": "❌", "retired": "🗄️"}[verdict]
    rate = "—" if sc is None else f"{sc:.1%}"
    print(f"{icon} {NAME}: {verdict}  一致率 {rate}  "
          f"（配对 {len(ev['pairs'])} 轮，近 {days} 天）")
    for r in reasons:
        print(f"   {r}")
    print(f"   证据 → {ep}")
    # retired 不是失败：对象退役是预期状态，不该让 evaluate 工作流天天变红
    return 0 if verdict in ("pass", "retired") else 1


if __name__ == "__main__":
    sys.exit(main())
