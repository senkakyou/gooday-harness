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
                     "present": total - len(broken),   # 【真正可达的绝对数】
                     "items": results},          # 全量落盘，可被重新检验
    }


# ══════════════════ Learn ══════════════════
def _find_twin(path, media, taken=None):
    """找「同一个文件被改过名」的孪生体。

    真实线索（2026-09-07 实测）：库里记 `compare_20260429062048.html`，
    磁盘上是 `compare.html`，而它的 mtime 正是 2026-04-29 06:20:48 ——
    **文件名里的时间戳和磁盘 mtime 对得上，是同一份东西被改了名**。

    ═══ 三条判据，缺一不可 ═══════════════════════════════════

      1. 去掉 `_时间戳` 后的主干名一致
      2. 磁盘 mtime 与文件名里的时间戳相差 ≤ 120 秒
      3. **这个文件没有被别的工具引用**

    第 3 条是灵犀评审加的，也是最重要的一条。前两条完全没把孪生体
    跟「它属于谁」绑定：`compare` / `index` / `template` 这类通用主干名很常见，
    同一批上传的两个工具时间戳差几秒就落在 120 秒窗口内。
    于是 A 的文件丢了，会被改成指向 **B 的文件**。

    后果比 404 恶劣得多：分数 1.0、门禁全过、巡检转绿，
    而用户下到的是别的工具的内容 —— **没有任何信号**。
    404 至少是响亮的失败；这个是安静的错误。

    时间戳用 `calendar.timegm` 按 UTC 解析，不用 `time.mktime`：
    后者按本机时区，本机现在是 UTC 所以对得上，一旦 TZ 改成 Asia/Shanghai
    就差 8 小时，孪生全部失配，闭环会静默从「改名修好」退化成「关掉下载」。
    """
    base = os.path.basename(path)
    m = TS_SUFFIX.match(base)
    if not m:
        return None
    cand = os.path.join(os.path.dirname(path), m.group("stem") + m.group("ext"))
    if not os.path.isfile(cand):
        return None
    # ③ 已被别人引用的文件绝不认领 —— 这条不满足就直接放弃，
    #    宁可退化成「关掉下载」（响亮），也不要指向别人的文件（安静地错）
    if taken and os.path.realpath(cand) in taken:
        return None
    try:
        import calendar
        import time
        want = calendar.timegm(time.strptime(m.group("ts"), "%Y%m%d%H%M%S"))
        if abs(os.path.getmtime(cand) - want) > 120:
            return None
    except Exception:
        return None
    return cand


def learn(evaluation, results, media=None, all_refs=None):
    """把失败沉淀成结构化经验。不是写文档，是产出可被 improve 消费的记录。

    `all_refs` 是【全表】的 (工具Id, 文件路径) 引用关系，包含未发布的草稿。
    不传时退化成只看本轮 results（即已发布的），那会留下一个静默错误的入口 ——
    见下面 owner 的注释。
    """
    media = media or os.environ.get("GOODAY_MEDIA", "/srv/gooday-harness/media")

    # 「谁占着哪个文件」——用来挡住「认领别人的文件」。
    #
    # ⚠️ 必须按 **工具 Id** 记，不能只记路径：孪生体常常正是**这个工具自己的
    # 在线文件**（Tools[14] 的 compare.html 就是它自己 OnlineUrl 指的那个）。
    # 只记路径会把这种正当情形也拒掉，闭环从「改名修好」退化成「关掉下载」——
    # 第一版就写错成这样，是测试抓出来的。
    # ⚠️ 必须覆盖【全表】，不能只看本轮 results（IsPublished=1）。
    # 只扫已发布的话，「未发布草稿工具的文件」不在 taken 里，
    # 可以被一个坏掉的已发布工具认领：文件存在 → present+1、分数涨、
    # Gate 四条判据全过。**Gate 结构上抓不到这个——它只测「存在」，不测「是谁的」。**
    # 这是最后一个静默错误的入口（灵犀评审发现）。
    owner = {}
    for tid, path in (all_refs or []):
        owner.setdefault(path, set()).add(tid)
    for r in (results or []):
        if r.get("exists"):
            owner.setdefault(os.path.realpath(r["path"]), set()).add(r["id"])

    exps = []
    for b in evaluation.get("failures", []):
        # 属于别人的才算被占；属于自己的不算
        taken = {path for path, ids in owner.items() if ids - {b["id"]}}
        twin = _find_twin(b["path"], media, taken=taken)
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
            # 【前缀按 field 分】——两个字段的路径规则不同（见 subject._item）：
            #   OnlineUrl        存的是相对 media 根的完整路径，`/uploads/x.html`
            #   DownloadFileName 存裸文件名，run() 时补 `/uploads/` 前缀
            # 原来无条件剥掉 `uploads/`，于是 OnlineUrl 的孪生修复写成
            # `compare.html`，实际去找 `<media>/compare.html`，**必不存在**。
            # Gate 会拒（安全），但理由报的是「没有实质进展」，把真因盖掉了——
            # 结果是改名的在线页永远修不好，也永远没人知道为什么（灵犀评审发现）。
            rel = e["twin_rel"] if e["twin_rel"].startswith("/") else "/" + e["twin_rel"]
            if it["field"] == "DownloadFileName":
                # 不在 /uploads 下的绝对路径要【保留前导斜杠】：
                # run() 和 all_refs() 都容忍绝对 DownloadFileName（不再补前缀），
                # 而 lstrip("/") 会让 run() 再补一次 /uploads/。三处规则必须一致。
                new = (rel[len("/uploads/"):] if rel.startswith("/uploads/") else rel)
            else:
                new = rel
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
    """门禁。四条判据同时满足才放行，任一不满足即拒。

    **fail closed**：本函数抛异常时，引擎按「门禁崩溃 = 不算通过」处理
    （packages/evolve/loop.py 的 gate_crashed 分支，已有测试覆盖）。
    这里不做任何 try/except 兜底成 pass —— 那正是最危险的写法。

    ═══ 第 ③ 条原来是死代码，第 ④ 条是被指出后补的 ═══════════════

    原第 ③ 条写的是「已发布条目总数不许异常减少」，本意是挡「把坏的下架
    冒充修好」。灵犀评审指出两点，实测都成立：

      · 它**永不触发** —— 阈值恰好按「删光坏项」校准，而删健康项
        已经被第 ② 条（回归保护）抓住了，它是冗余的。
      · 更要命的是**它想挡的事，正是 orphan_download 候选自己在干的**：
        把 HasDownload 关掉，坏项从分母里消失，分数升到 1.0，
        而文件依然是丢的。按我自己定的标准，这就是藏问题。

    所以改成两条实的：
      ③ **真正可达的绝对数不许减少**（present）—— 挡住「删健康项提分」，
        且不像原来那样是恒真式。
      ④ **必须有实质进展**：要么 present 变多（真修好了），
        要么 broken 变少且 present 不减（把 404 止住了，属于缓解）。

    第 ④ 条同时保证「什么都没干」拿不到通过。
    **缓解和修复的区别不靠 Gate 藏起来，靠 evaluate 的 present 台账留在证据里** ——
    分数到 1.0 时，present 有没有涨得出来，一看便知。
    """
    was_ok = {(r["id"], r["field"]) for r in baseline_results if r["exists"]}
    base_present = len(was_ok)
    base_broken = len(baseline_results) - base_present

    def _refs(items):
        """(工具Id, 文件真实路径) 的集合。

        粒度必须是「哪个工具引用了哪个文件」，不能是「这个文件被几个工具引用」：
        后者放不过「同一工具的在线页与下载指向同一文件」这种正当情形
        （真实的 Tools[14] 就是），也挡不住 fixture 里那种预先共用的情况。
        """
        return {(r["id"], os.path.realpath(r["path"]))
                for r in items if r.get("exists")}

    base_refs = _refs(baseline_results)
    base_owner = {}
    for tid, path in base_refs:
        base_owner.setdefault(path, set()).add(tid)

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

        # ③ 真正可达的绝对数不许减少
        present = len(now_ok)
        if present < base_present:
            reasons.append(f"可达条目从 {base_present} 降到 {present} —— "
                           "分数变好看是靠减少分母，不是靠修好东西")

        # ④ 必须有实质进展：修好了，或至少把 404 止住了
        broken = len(res) - present
        if not (present > base_present or
                (broken < base_broken and present >= base_present)):
            reasons.append(f"没有实质进展：可达 {base_present}→{present}，"
                           f"缺失 {base_broken}→{broken}")

        # ⑤ 【不许新引入「两个工具指向同一个文件」】
        #
        # 自查时用攻击用例打出来的洞：把坏项的 DownloadFileName 改成指向
        # 另一个工具的现有文件 —— 可达数从 4 涨到 5、分数 1.0，
        # 前四条判据【全部放行】，因为从 Gate 的视角这看起来就是「修好了」。
        #
        # Learn 那边的 taken 判据能挡住*生成*这种候选，但 Gate 自己没有防御。
        # 而 improve 迟早要换成模型驱动的 —— 到那时 Gate 就是唯一一道线，
        # **纵深防御不能只有一层**。
        #
        # 判据是「新引入的共用」而不是「任何共用」：基线里本来就共用的
        # （同一工具的在线页和下载指同一个文件是正当的）不算。
        for tid, path in _refs(res) - base_refs:
            others = base_owner.get(path, set()) - {tid}
            if others:
                reasons.append(
                    f"工具 {tid} 新指向了 {os.path.basename(path)}，"
                    f"而该文件原本属于工具 {sorted(others)} —— "
                    "把坏项指向别人的文件会让分数变好看，而用户下到的是别人的内容")

        return {"passed": not reasons, "score": ev["score"],
                "present": present, "broken": broken,
                "reasons": reasons or
                [f"可达 {base_present}→{present}，缺失 {base_broken}→{broken}，无回归"]}

    return gate
