#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gooday 已发布内容完整性闭环的四个环节。

Evaluate → Learn → Improve → Gate。引擎在 packages/evolve/loop.py，
这里只提供这条闭环特有的判断，**不复制第二套引擎**。
"""
import os
import re

# 下载名里常见的上传时间戳后缀：xxx_20260429062048.html
TS_SUFFIX = re.compile(r"^(?P<stem>.+?)_(?P<ts>\d{14})(?P<ext>\.[A-Za-z0-9]+)$")


# ══════════════════ Evaluate ══════════════════
def evaluate(results, inputs=None):
    """打分 = 文件真实存在的比例。

    verdict 只有全部存在才算 pass —— 一个已发布内容 404 就是事故，
    没有「99% 也还行」这回事：撞上的那个用户看到的是 100% 坏。
    """
    total = len(results)
    broken = [r for r in results if not r["exists"]]
    score = 1.0 if not total else (total - len(broken)) / total
    reasons = []
    for b in broken[:5]:
        reasons.append(f"[{b['id']}] {b['name']} · {b['field']} → {b['url']} 磁盘上没有")
    if len(broken) > 5:
        reasons.append(f"…另有 {len(broken)-5} 项")
    return {
        "score": round(score, 6),
        "verdict": "pass" if not broken else "fail",
        "reasons": reasons or [f"{total} 项已发布内容全部存在"],
        "failures": broken,
        "evidence": {"total": total, "broken": len(broken),
                     "items": results},          # 全量落盘，可被重新检验
    }


# ══════════════════ Learn ══════════════════
def _find_twin(path, media):
    """找「同一个文件被改过名」的孪生体。

    真实线索（2026-09-07 实测）：库里记 `compare_20260429062048.html`，
    磁盘上是 `compare.html`，而它的 mtime 正是 2026-04-29 06:20:48 ——
    **文件名里的时间戳和磁盘 mtime 对得上，是同一份东西被改了名**。

    两条判据都要满足才认，避免把同名前缀的不同文件错认成孪生：
      1. 去掉 `_时间戳` 后的主干名一致
      2. 磁盘 mtime 与文件名里的时间戳相差 ≤ 120 秒
    """
    base = os.path.basename(path)
    m = TS_SUFFIX.match(base)
    if not m:
        return None
    cand = os.path.join(os.path.dirname(path), m.group("stem") + m.group("ext"))
    if not os.path.isfile(cand):
        return None
    try:
        import time
        want = time.mktime(time.strptime(m.group("ts"), "%Y%m%d%H%M%S"))
        if abs(os.path.getmtime(cand) - want) > 120:
            return None
    except Exception:
        return None
    return cand


def learn(evaluation, results, media=None):
    """把失败沉淀成结构化经验。不是写文档，是产出可被 improve 消费的记录。"""
    media = media or os.environ.get("GOODAY_MEDIA", "/srv/gooday-harness/media")
    exps = []
    for b in evaluation.get("failures", []):
        twin = _find_twin(b["path"], media)
        if twin:
            exps.append({
                "kind": "renamed_twin",
                "what": f"[{b['id']}] {b['name']} 的 {b['field']} 指向 {b['url']}，"
                        f"磁盘上没有；但同主干、同时间戳的 {os.path.basename(twin)} 在",
                "item": b,
                "twin_rel": "/" + os.path.relpath(twin, media),
            })
        else:
            exps.append({
                "kind": "orphan_download",
                "what": f"[{b['id']}] {b['name']} 的 {b['field']} 指向 {b['url']}，"
                        f"磁盘和归档里都找不到任何对应文件",
                "item": b,
            })
    if not exps and evaluation.get("verdict") == "pass":
        exps.append({"kind": "all_present",
                     "what": f"{evaluation['evidence']['total']} 项已发布内容全部可达"})
    return exps


# ══════════════════ Improve ══════════════════
# 允许被改的字段白名单。**不在这张表里的字段一律不生成候选** ——
# 自动改动的边界必须写死在代码里，不能靠「它应该不会那么做」。
WRITABLE = {"DownloadFileName", "HasDownload", "OnlineUrl"}


def improve(experiences, evaluation):
    """经验 → 候选。每个候选必须说清 target/why/scope/risk/acceptance/patch。"""
    cands = []
    for e in experiences:
        it = e.get("item")
        if not it:
            continue
        if e["kind"] == "renamed_twin":
            if "DownloadFileName" not in WRITABLE:
                continue
            new = e["twin_rel"].lstrip("/")
            new = new[len("uploads/"):] if new.startswith("uploads/") else new
            cands.append({
                "target": f"Tools[{it['id']}].{it['field']} → {new}",
                "why": e["what"],
                "scope": "只改这一行的一个字段；文件不动、其它工具不动。"
                         "对外表现是下载按钮从 404 变成可用",
                "risk": "若孪生体其实是另一份内容，用户下到的会是错的东西。"
                        "所以判据要求主干名一致【且】mtime 与文件名时间戳相差 ≤120 秒",
                "acceptance": f"改后 {it['url'].rsplit('/',1)[0]}/{new} 对应的文件存在，"
                              "且本轮其余已存在项一项都不能变成缺失",
                "patch": {"id": it["id"], "field": it["field"], "value": new},
            })
        elif e["kind"] == "orphan_download":
            if it["field"] != "DownloadFileName" or "HasDownload" not in WRITABLE:
                # 在线页面找不到源文件时【不自动下架】——那会让整个工具消失，
                # 影响面远超「关掉一个下载按钮」。留给人判断。
                continue
            cands.append({
                "target": f"Tools[{it['id']}].HasDownload → 0",
                "why": e["what"] + "。继续对外宣称有下载 = 每个点击都是 404",
                "scope": "只关掉这一个工具的下载入口；工具本身仍在线、仍可用。"
                         "不删除记录、不改 IsPublished",
                "risk": "文件日后被找回时需要人工把 HasDownload 改回 1。"
                        "checkpoint 里存了整行原值，回滚一条命令的事",
                "acceptance": "改后该项不再计入「已发布但文件缺失」，"
                              "且工具的在线入口仍然可用",
                "patch": {"id": it["id"], "field": "HasDownload", "value": 0},
            })
    return cands


# ══════════════════ Gate ══════════════════
def make_gate(baseline_results):
    """门禁。三条判据同时满足才放行，任一不满足即拒。

    **fail closed**：本函数抛异常时，引擎按「门禁崩溃 = 不算通过」处理
    （packages/evolve/loop.py 的 gate_crashed 分支，已有测试覆盖）。
    这里不做任何 try/except 兜底成 pass —— 那正是最危险的写法。
    """
    was_ok = {(r["id"], r["field"]) for r in baseline_results if r["exists"]}

    def gate(variant, inputs, baseline):
        res = variant.run(inputs)
        ev = evaluate(res, inputs)
        reasons = []

        # ① 必须真的变好，不是持平
        if baseline is not None and ev["score"] <= baseline:
            reasons.append(f"通过率 {ev['score']:.4f} 未超过基线 {baseline:.4f}")

        # ② 【已经好的不许变坏】——回归保护
        now_ok = {(r["id"], r["field"]) for r in res if r["exists"]}
        regressed = was_ok - now_ok
        if regressed:
            reasons.append(f"{len(regressed)} 项原本正常的变成缺失：{sorted(regressed)[:3]}")

        # ③ 【已发布的数量不许变】——防止「把坏的下架」被当成改进。
        #    下架能让分数变好看，但那是把问题藏起来，不是解决。
        if len(res) < len(baseline_results) - len(
                [r for r in baseline_results if not r["exists"]]):
            reasons.append("已发布条目总数异常减少，疑似把内容下架冒充修好")

        return {"passed": not reasons, "score": ev["score"],
                "reasons": reasons or ["通过率提升，且无回归"]}

    return gate
