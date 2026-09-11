#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""发现的分类与聚合。

【使用方：目前只有 workflows/patrol】——coo-patrol 已于 2026-09-11 删除
（docs/decisions/006），它曾是第二个使用方。见 README 里记的那笔欠账。

═══ 为什么要有这层 ═══════════════════════════════════════════════

2026-09-08 之前，两个巡检有**两条互不相通的输出路径**：
patrol 的发现进 `events/`，coo-patrol 的发现只进一条发给站长的消息。
谁也看不见谁 —— 第二层循环对 coo-patrol 那 8 项业务检查完全是瞎的，
patrol 的退避与升级也管不到它。

**可见性是基础设施问题，不该由「这条给人看还是给机器看」来决定**
（灵犀 2026-09-08）。所以证据流统一：一律落 events/，
发消息降级成 events 的下游 sink，不再是并行分支。

处置策略靠事件上的 `disposition` 字段区分，不靠"进不进流"区分：
**混的是存储，不是处置。**

═══ 两个真实约束 ═══════════════════════════════════════════════

**一、量。** 实测：334 条 finding 只有 60 个不同指纹，重复最多的一条
出现了 87 次（每 5 分钟报一次同一个 P0，直到它被修掉）。
notify-only 全量落而不聚合，events/ 自己会变成噪音源，patrol 反而更瞎。
所以同指纹在窗口内合并计数，不每次新开一条。

**二、谁来判定 disposition。** 不能由发现方自己打标 ——
那等于把「什么该人管」的判断权交给发现方，标错了就静默漏掉。
规则表外置在 `ops/dispositions.json`，可审、可 diff、可被门禁检查。
不在表里的一律 `notify-only`（**向人判断的方向失败**），
并且另报一条 P2 —— 否则「外置可审」会退化成「外置但没人维护」。
"""
import hashlib
import json
import os
import time

AUTO = "auto"
NOTIFY = "notify-only"


def _repo_root(start):
    d = start
    while True:
        if os.path.exists(os.path.join(d, "AGENTS.md")):
            return d
        p = os.path.dirname(d)
        if p == d:
            return start
        d = p


TABLE = os.path.join(_repo_root(os.path.dirname(os.path.abspath(__file__))),
                     "ops", "dispositions.json")
STATE = os.environ.get("GOODAY_HARNESS_STATE", "/var/lib/gooday-harness")


def load_table(path=None):
    """读规则表。读不到就【全部按 notify-only】并说明原因 ——
    表坏了不能变成「全部自动处置」，那是往危险的一边失败。"""
    try:
        with open(path or TABLE, encoding="utf-8") as f:
            d = json.load(f)
        return d.get("rules", {}), d.get("_default", NOTIFY), None
    except Exception as e:
        return {}, NOTIFY, f"处置规则表读不到（{type(e).__name__}），全部按 {NOTIFY} 处理：{e}"


def classify(kind, table=None, default=NOTIFY):
    """(disposition, known) —— known=False 表示这个 kind 不在表里。

    调用方必须把 known=False 单独报出来，不能只用 disposition 就完事。
    """
    rules = table if table is not None else load_table()[0]
    r = rules.get(kind)
    if r is None:
        return default, False
    return r.get("disposition", default), True


def fingerprint(finding):
    """同一件事的指纹。

    用 check + what 而不是整个 payload：`why` 里常带时间/计数
    （「已 5.9 小时未更新」），每轮都不一样，拿它算指纹等于不聚合。
    """
    raw = f"{finding.get('check','')}|{finding.get('what','')}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


class Aggregator:
    """窗口内同指纹合并计数。

    落盘是必须的：聚合要跨轮次才有意义，而巡检是每轮一个新进程。
    """

    def __init__(self, name, window_min=60, state_dir=None):
        self.window = window_min * 60
        self.path = os.path.join(state_dir or STATE, "state", name, "findings.json")
        try:
            with open(self.path, encoding="utf-8") as f:
                self.seen = json.load(f)
        except Exception:
            self.seen = {}

    def see(self, finding):
        """返回 (是否该落新事件, 本窗口内第几次)。

        第 1 次落事件；窗口内重复只累加计数不落新事件；
        超窗后重新落一条（带上「本窗口内共 N 次」）。
        """
        fp = fingerprint(finding)
        now = time.time()
        rec = self.seen.get(fp)
        if rec and (now - rec.get("first", 0)) < self.window:
            rec["count"] = rec.get("count", 1) + 1
            rec["last"] = now
            return False, rec["count"]
        self.seen[fp] = {"first": now, "last": now, "count": 1,
                         "what": str(finding.get("what", ""))[:120]}
        return True, 1

    def flush(self):
        """落盘并清掉过期条目。"""
        cutoff = time.time() - max(self.window * 3, 86400)
        self.seen = {k: v for k, v in self.seen.items() if v.get("last", 0) > cutoff}
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = f"{self.path}.tmp.{os.getpid()}"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.seen, f, ensure_ascii=False)
            os.replace(tmp, self.path)
        except Exception as e:
            # 落不下去就是下一轮不会聚合（重复落事件），比静默丢失好，但要说
            print(f"[finding] ⚠️ 聚合状态写入失败，下一轮会重复落事件: {e}",
                  file=__import__("sys").stderr, flush=True)

    def suppressed(self):
        """窗口内被合并掉的条目，用于在摘要里如实交代「压了多少」。"""
        return {k: v for k, v in self.seen.items() if v.get("count", 1) > 1}
