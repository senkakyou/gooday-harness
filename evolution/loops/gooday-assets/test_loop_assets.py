#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gooday-assets 闭环的离线自测 —— 造一个假 Gooday，不碰生产。

CI 里没有真实的 Gooday 库和媒体目录，但**闭环契约必须能被机械验证**：
分类对不对、候选带没带齐字段、Gate 拦不拦得住、隔离有没有真隔离。
这些都不需要真系统，只需要一份长得一样的数据。

判据：`python3 test_loop_assets.py` 退出码 0。
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time

def _repo_root(start):
    """向上找 AGENTS.md 认仓库根。

    别数 dirname 层数——文件一挪位置层数就变，而写死层数的代码会
    【静默算错根目录】然后 import 失败或扫了个空。check.py 早就是这么做的。
    """
    d = start
    while True:
        if os.path.exists(os.path.join(d, "AGENTS.md")):
            return d
        p = os.path.dirname(d)
        if p == d:
            return start
        d = p


HERE = os.path.dirname(os.path.abspath(__file__))
REPO = _repo_root(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(REPO, "packages", "evolve"))

TMP = tempfile.mkdtemp(prefix="gooday-assets-test-")
os.environ["GOODAY_HARNESS_STATE"] = os.path.join(TMP, "state")

import assets_phases as phases                             # noqa: E402
from subject import GoodayAssets                           # noqa: E402
from loop import Loop                                      # noqa: E402

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'✅' if cond else '❌'} {name}" +
          (f"\n       {detail}" if not cond and detail else ""))


# ── 造一个假 Gooday：库 + 媒体目录 ────────────────────────────
MEDIA = os.path.join(TMP, "media")
os.makedirs(os.path.join(MEDIA, "uploads", "zip"), exist_ok=True)
DB = os.path.join(TMP, "gooday.db")

# 三个工具：
#   1 正常  2 下载指向被改名的文件（孪生体存在）  3 下载文件哪都没有
subprocess.run(["sqlite3", DB, """
CREATE TABLE Tools (Id INTEGER PRIMARY KEY, Name TEXT, Slug TEXT, Description TEXT,
  Category TEXT, IconEmoji TEXT, IsOnline INT, OnlineUrl TEXT, HasDownload INT,
  DownloadFileName TEXT, IsPublished INT, RequireLogin INT, ReadmeMarkdown TEXT);
INSERT INTO Tools VALUES (1,'好工具','a','','系统','x',1,'/uploads/ok.html',1,'ok.html',1,0,'');
INSERT INTO Tools VALUES (2,'被改名的','b','','系统','x',1,'/uploads/twin.html',1,'twin_20260429062048.html',1,0,'');
INSERT INTO Tools VALUES (3,'没源文件的','c','','系统','x',1,'/uploads/ok.html',1,'zip/gone.zip',1,0,'');
INSERT INTO Tools VALUES (4,'没发布的','d','','系统','x',1,'/uploads/nope.html',1,'nope.html',0,0,'');
"""], check=True, capture_output=True)

open(os.path.join(MEDIA, "uploads", "ok.html"), "w").write("ok")
twin = os.path.join(MEDIA, "uploads", "twin.html")
open(twin, "w").write("twin")
# 孪生判据要求 mtime 与文件名里的时间戳对得上
ts = time.mktime(time.strptime("20260429062048", "%Y%m%d%H%M%S"))
os.utime(twin, (ts, ts))

S = lambda: GoodayAssets(db=DB, media=MEDIA, sudo=False)    # noqa: E731

print("\n=== gooday-assets 闭环离线自测 ===\n")

# ① Run / Evaluate
res = S().run(None)
ev = phases.evaluate(res)
check("只扫已发布的（未发布的第 4 个不算）",
      all(r["id"] != 4 for r in res), [r["id"] for r in res])
check("一项 404 就判 fail（没有「99% 也还行」）", ev["verdict"] == "fail", ev["verdict"])
check("准确找出 2 项缺失", ev["evidence"]["broken"] == 2, ev["evidence"])

# ② Learn 分类
exps = phases.learn(ev, res, media=MEDIA)
kinds = sorted(e["kind"] for e in exps)
check("分成 renamed_twin 与 orphan_download 两类",
      kinds == ["orphan_download", "renamed_twin"], kinds)

# 孪生判据要够严：时间戳对不上就不该认
os.utime(twin, (ts + 9999, ts + 9999))
exps_strict = phases.learn(phases.evaluate(S().run(None)), None, media=MEDIA)
check("mtime 与文件名时间戳对不上时不认孪生（防错认成同名的另一份）",
      all(e["kind"] != "renamed_twin" for e in exps_strict),
      [e["kind"] for e in exps_strict])
os.utime(twin, (ts, ts))

# ③ Improve：候选必须字段齐全
cands = phases.improve(phases.learn(ev, res, media=MEDIA), ev)
check("生成 2 个候选", len(cands) == 2, len(cands))
need = ("target", "why", "scope", "risk", "acceptance", "patch")
check("每个候选都带齐 target/why/scope/risk/acceptance/patch",
      all(all(c.get(k) for k in need) for c in cands),
      [[k for k in need if not c.get(k)] for c in cands])
check("在线页面缺源文件时【不生成下架候选】",
      all(c["patch"]["field"] != "IsPublished" for c in cands))

# ④ 隔离
base = S()
before = subprocess.run(["sqlite3", DB, "SELECT DownloadFileName FROM Tools WHERE Id=2;"],
                        capture_output=True, text=True).stdout
v = base.variant({"id": 2, "field": "DownloadFileName", "value": "twin.html"})
after = subprocess.run(["sqlite3", DB, "SELECT DownloadFileName FROM Tools WHERE Id=2;"],
                       capture_output=True, text=True).stdout
check("变体不污染真身", before == after, (before, after))
check("变体里分数确实提高了",
      phases.evaluate(v.run(None))["score"] > phases.evaluate(res)["score"])
v.cleanup()

# ⑤ 执行层白名单
try:
    S()._apply(DB, {"id": 1, "field": "IsPublished", "value": 0}, sudo=False)
    check("白名单外字段被拒", False, "居然放行了 IsPublished")
except RuntimeError:
    check("白名单外字段被拒（执行层硬边界）", True)
try:
    S()._apply(DB, {"id": "1 OR 1=1", "field": "HasDownload", "value": 0}, sudo=False)
    check("非数字 Id 被拒", False, "居然放行了")
except RuntimeError:
    check("非数字 Id 被拒", True)

# ⑤b SQL 拼接的边角 —— 这组是自查时才发现的，原来的 17 项全绿却漏掉了它。
#     `for a in args: q.replace("?", v, 1)` 会扫到已替换进去的值：
#     文件名里带一个 ? ，下一个参数就替换到那个 ? 上，SQL 结构被破坏。
for val, desc in [("a?b.html", "含问号"), ("???", "全问号"),
                  ("it's.html", "含单引号"),
                  ("a'; UPDATE Tools SET IsPublished=0; --", "注入尝试"),
                  ('a"b.html', "含双引号"), ("x\\y.html", "含反斜杠")]:
    try:
        S()._apply(DB, {"id": 2, "field": "DownloadFileName", "value": val}, sudo=False)
        got = subprocess.run(["sqlite3", DB,
              "SELECT DownloadFileName FROM Tools WHERE Id=2;"],
              capture_output=True, text=True).stdout.strip()
        pub = subprocess.run(["sqlite3", DB,
              "SELECT COUNT(*) FROM Tools WHERE IsPublished=1;"],
              capture_output=True, text=True).stdout.strip()
        check(f"值{desc}：存入正确且不误伤其它行", got == val and pub == "3",
              f"存入={got!r} 期望={val!r} 已发布数={pub}")
    except Exception as e:
        check(f"值{desc}：存入正确且不误伤其它行", False, f"抛异常 {str(e)[:70]}")
subprocess.run(["sqlite3", DB,
    "UPDATE Tools SET DownloadFileName='twin_20260429062048.html' WHERE Id=2;"],
    capture_output=True)

# 布尔/整数不能被存成文本，否则 C# 那边的 bool 映射可能出问题
S()._apply(DB, {"id": 3, "field": "HasDownload", "value": 0}, sudo=False)
ty = subprocess.run(["sqlite3", DB, "SELECT typeof(HasDownload) FROM Tools WHERE Id=3;"],
                    capture_output=True, text=True).stdout.strip()
check("整数存成 integer 而不是文本", ty == "integer", ty)
subprocess.run(["sqlite3", DB, "UPDATE Tools SET HasDownload=1 WHERE Id=3;"],
               capture_output=True)

# 占位符与参数数量对不上必须报错，不能凑合执行
try:
    GoodayAssets._exec(DB, "UPDATE Tools SET Name=? WHERE Id=? AND Name=?;", ("a", 1), False)
    check("占位符数与参数数不符 → 报错", False, "居然放行了")
except RuntimeError:
    check("占位符数与参数数不符 → 报错", True)

# ⑥ Gate 三条判据
gate = phases.make_gate(res)
v2 = S().variant({"id": 2, "field": "DownloadFileName", "value": "twin.html"})
g = gate(v2, None, phases.evaluate(res)["score"])
check("真改进 → 放行", g["passed"], g)
v2.cleanup()

v3 = S().variant({"id": 1, "field": "DownloadFileName", "value": "gone_forever.html"})
g3 = gate(v3, None, phases.evaluate(res)["score"])
check("把原本正常的弄坏 → 拒绝（回归保护）", not g3["passed"], g3)
v3.cleanup()

# Gate 自身崩溃必须 fail closed —— 由引擎保证，这里验它确实没被当成通过
def boom_gate(variant, inputs, baseline):
    raise RuntimeError("门禁炸了")

lp = Loop("t", S(), evaluator=phases.evaluate,
          learner=lambda e, r: phases.learn(e, r, media=MEDIA),
          improver=phases.improve, gate=boom_gate, inputs=None)
o = lp.cycle()
check("门禁自身崩溃 → 不算通过（fail closed）", not o.ok, o.status)

# ⑦ 端到端：真的能收敛
subject = S()
scores = []
for _ in range(4):
    r0 = subject.run(None)
    lp = Loop("gooday-assets-test", subject, evaluator=phases.evaluate,
              learner=lambda e, r: phases.learn(e, r, media=MEDIA),
              improver=phases.improve, gate=phases.make_gate(r0), inputs=None)
    out = lp.cycle()
    scores.append(round(phases.evaluate(subject.run(None))["score"], 4))
    if out.status == "no_change_needed":
        break
check(f"端到端收敛到 100%（{scores}）", scores[-1] == 1.0, scores)

# ⑧ 留痕
st = os.environ["GOODAY_HARNESS_STATE"]
missing = [d for d in ("decisions", "evidence", "evaluations", "checkpoints")
           if not os.path.isdir(os.path.join(st, d))
           or not os.listdir(os.path.join(st, d))]
check("六样留痕齐（decisions/evidence/evaluations/checkpoints）", not missing, missing)

shutil.rmtree(TMP, ignore_errors=True)
print(f"\n{'─'*52}\n通过 {len(PASS)} · 失败 {len(FAIL)}")
if FAIL:
    print("失败：" + "、".join(FAIL))
sys.exit(1 if FAIL else 0)
