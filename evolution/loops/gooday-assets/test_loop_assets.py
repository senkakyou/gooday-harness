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

# ⑩ 灵犀评审发现的三个真问题 —— 回归测试
#    这三个当时 28 项测试全绿却全都漏掉了，因为测试数据太干净。

# ⑩a 名字/描述里有竖线、换行、NULL —— 原来按 `|` 切列，
#     实测「回滚动作本身把行写坏了」：OnlineUrl 变成 '1'、HasDownload 变成路径
subprocess.run(["sqlite3", DB, """
INSERT INTO Tools VALUES (10,'A|B 对比工具','p','desc|带竖线','系统','x',
  1,'/uploads/ok.html',1,'ok.html',1,0,NULL);
INSERT INTO Tools VALUES (11,'换行
的名字','q','d','系统','x',1,'/uploads/ok.html',0,NULL,1,0,NULL);"""],
    capture_output=True)
dirty = S()
items = {(r["id"], r["field"]): r for r in dirty.run(None)}
check("竖线名被正确解析（不是截断成 'A'）",
      items.get((10, "OnlineUrl"), {}).get("name") == "A|B 对比工具",
      items.get((10, "OnlineUrl"), {}).get("name"))
check("换行名不破坏行解析", (11, "OnlineUrl") in items, sorted(items))

snap = lambda: subprocess.run(["sqlite3", "-json", DB, "SELECT * FROM Tools;"],
                              capture_output=True, text=True).stdout
b4 = snap()
ck2 = dirty.checkpoint()
dirty.promote({"id": 10, "field": "DownloadFileName", "value": "changed?x.html"})
dirty.rollback(ck2)
check("含竖线/换行/NULL 的行也能逐字节复原", snap() == b4,
      "回滚后与回滚前不一致")

# ⑩b 孪生体不能认领【已被别人引用】的文件 ——
#     否则 A 的文件丢了会指向 B 的文件，用户下到别人的东西，且毫无信号
tw = os.path.join(MEDIA, "uploads", "shared.html")
open(tw, "w").write("shared")
os.utime(tw, (ts, ts))
subprocess.run(["sqlite3", DB, f"""
INSERT INTO Tools VALUES (20,'占用者','r','','系统','x',1,'/uploads/shared.html',0,NULL,1,0,'');
INSERT INTO Tools VALUES (21,'丢文件的','s','','系统','x',0,NULL,1,
  'shared_20260429062048.html',1,0,'');"""], capture_output=True)
res_tw = S().run(None)
ev_tw = phases.evaluate(res_tw)
kinds_tw = [e["kind"] for e in phases.learn(ev_tw, res_tw, media=MEDIA)
            if e.get("item", {}).get("id") == 21]
check("孪生体已被别人引用 → 不认领（宁可退化成关下载，也不指向别人的文件）",
      kinds_tw == ["orphan_download"], kinds_tw)
subprocess.run(["sqlite3", DB, "DELETE FROM Tools WHERE Id IN (10,11,20,21);"],
               capture_output=True)
os.unlink(tw)

# ⑩c Gate 第 ④ 条：什么都没干拿不到通过；靠删健康项提分要被拦住
res0 = S().run(None)
gate0 = phases.make_gate(res0)
noop = S().variant({"id": 1, "field": "OnlineUrl", "value": "/uploads/ok.html"})
gnoop = gate0(noop, None, phases.evaluate(res0)["score"])
check("什么都没改 → 拒绝（无实质进展）", not gnoop["passed"], gnoop["reasons"])
noop.cleanup()

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

# ⑨ 回滚的范围与完整性 —— 自查发现的第二组问题
#    原来 rollback 遍历 checkpoint 全部行逐行 UPDATE：为撤销一行改动
#    而重写整张表。期间别的进程合法改过别的工具，会被一并抹掉。
sub = S()
ck = sub.checkpoint()
subprocess.run(["sqlite3", DB,
    "UPDATE Tools SET DownloadFileName='别人改的.html' WHERE Id=3;"],
    capture_output=True)          # 模拟另一个进程在 checkpoint 之后改了别的工具
sub.promote({"id": 1, "field": "DownloadFileName", "value": "被闭环改的.html"})
sub.rollback(ck)
r1 = subprocess.run(["sqlite3", DB, "SELECT DownloadFileName FROM Tools WHERE Id=1;"],
                    capture_output=True, text=True).stdout.strip()
r3 = subprocess.run(["sqlite3", DB, "SELECT DownloadFileName FROM Tools WHERE Id=3;"],
                    capture_output=True, text=True).stdout.strip()
check("回滚复原了自己动过的行", r1 == "ok.html", r1)
check("回滚【不碰】别人改的行（不制造新事故）", r3 == "别人改的.html", r3)
subprocess.run(["sqlite3", DB, "UPDATE Tools SET DownloadFileName='zip/gone.zip' WHERE Id=3;"],
               capture_output=True)

# 白名单加了字段却没在 checkpoint 里存 → 回滚会不完整，必须当场炸而不是静默
class Incomplete(GoodayAssets):
    ALLOWED_FIELDS = GoodayAssets.ALLOWED_FIELDS | {"IsPublished"}
try:
    Incomplete(db=DB, media=MEDIA, sudo=False).rollback(
        {"rows": [{"Id": 1, "OnlineUrl": "/u", "HasDownload": 1,
                   "DownloadFileName": "x"}],
         "fields": ["DownloadFileName", "HasDownload", "OnlineUrl"]})
    check("可改字段没被 checkpoint 覆盖 → 报错", False, "居然静默通过了")
except RuntimeError as e:
    check("可改字段没被 checkpoint 覆盖 → 报错（回滚不许是残的）", "回滚会不完整" in str(e))

# ⑪ 灵犀提的两条零碎
# ⑪a 临时库权限 0600 且用完自动清 —— 它是生产 Tools 全表的副本，
#     0644 留在 /tmp 就是全机可读；引擎不调 cleanup，得 Subject 自己兜
vperm = S().variant({"id": 1, "field": "DownloadFileName", "value": "ok.html"})
mode = oct(os.stat(vperm.db).st_mode & 0o777)
check("变体临时库权限 0600（不是默认的 0644）", mode == "0o600", mode)
leaked = vperm.db
del vperm                       # 触发 __del__ 兜底清理
import gc; gc.collect()
check("变体对象被回收时临时库自动清掉（引擎不调 cleanup）",
      not os.path.exists(leaked), leaked)

# ⑪b UPDATE 匹配 0 行必须报错 —— 否则「工具已被删除」会记成一次成功的 promote
try:
    S()._apply(DB, {"id": 999999, "field": "HasDownload", "value": 0}, sudo=False)
    check("UPDATE 匹配 0 行 → 报错（不许记成 promoted）", False, "居然算成功了")
except RuntimeError as e:
    check("UPDATE 匹配 0 行 → 报错（不许记成 promoted）", "0 行" in str(e), str(e)[:60])

# ⑫ 灵犀第二轮：rollback 不能因一行失败就整体作废 + -json 的行为变化
sub2 = S()
ck3 = sub2.checkpoint()
sub2.promote([{"id": 1, "field": "DownloadFileName", "value": "c1.html"},
              {"id": 2, "field": "DownloadFileName", "value": "c2.html"}])
subprocess.run(["sqlite3", DB, "DELETE FROM Tools WHERE Id=1;"], capture_output=True)
# 行被删属于告知级：返回报告，【不抛】——抛了会让引擎的 decision 永远
# 停在 status=experimenting，生产已改又已回滚而记录说「还在实验中」
rep = sub2.rollback(ck3)
reported = "；".join(rep["problems"])
r2 = subprocess.run(["sqlite3", DB, "SELECT DownloadFileName FROM Tools WHERE Id=2;"],
                    capture_output=True, text=True).stdout.strip()
check("一行被删不打断其余回滚（回滚必须尽力做完）",
      r2 == "twin_20260429062048.html", r2)
check("行被删 → 返回报告不抛异常（否则 decision 丢失）",
      "已不存在" in reported and not rep["unknown_state"], reported[:70])
subprocess.run(["sqlite3", DB, """INSERT INTO Tools VALUES
  (1,'好工具','a','','系统','x',1,'/uploads/ok.html',1,'ok.html',1,0,'');"""],
    capture_output=True)

# -json 换过来引入的两处行为变化（灵犀预测的，验证确实挡住了）
from subject import _sql
check("空结果集返回 [] 而不是炸在 json.loads('')",
      _sql(DB, "SELECT * FROM Tools WHERE Id=-1;", sudo=False) == [])
subprocess.run(["sqlite3", DB, """INSERT INTO Tools VALUES
  (30,'全 NULL','n',NULL,'系统','x',1,NULL,1,NULL,1,0,NULL);"""], capture_output=True)
try:
    n_items = [r for r in S().run(None) if r["id"] == 30]
    check("NULL 字段（-json 给 None）不触发 startswith 崩溃", n_items == [], n_items)
except Exception as e:
    check("NULL 字段（-json 给 None）不触发 startswith 崩溃", False, f"{type(e).__name__}: {e}")
subprocess.run(["sqlite3", DB, "DELETE FROM Tools WHERE Id=30;"], capture_output=True)

# 陈旧变体库清扫（进程被 SIGKILL 时 finalize 也跑不了）
import tempfile as _tf
stale = os.path.join(_tf.gettempdir(), "gooday-assets-variant-STALE_TEST.db")
open(stale, "w").write("x")
os.utime(stale, (time.time() - 7 * 3600, time.time() - 7 * 3600))
S().variant({"id": 1, "field": "DownloadFileName", "value": "ok.html"}).cleanup()
check("variant() 开头清掉超过 6 小时的遗留变体库", not os.path.exists(stale))

# ⑬ 对 Gate 做攻击测试 —— 自查时找到一个真洞
#    「把坏项指向别人的现有文件」：可达数上升、分数 1.0，
#    前四条判据全部放行，因为从 Gate 的视角这看起来就是「修好了」。
#    Learn 的 taken 判据能挡住生成，但 Gate 自己没有防御 ——
#    improve 迟早换成模型驱动的，那时 Gate 就是唯一一道线。
atk_base = S().run(None)
atk_gate = phases.make_gate(atk_base)
atk_score = phases.evaluate(atk_base)["score"]

ATTACKS = [
    ("把坏项指向别人的现有文件（安静的错误）",
     {"id": 3, "field": "DownloadFileName", "value": "twin.html"}, False),
    ("把健康工具的下载也关掉（缩分母提分）",
     {"id": 1, "field": "HasDownload", "value": 0}, False),
    ("把健康项的在线地址清空（藏掉一项）",
     {"id": 1, "field": "OnlineUrl", "value": ""}, False),
    ("把坏项的下载关掉（正当缓解）",
     {"id": 3, "field": "HasDownload", "value": 0}, True),
]
for desc, patch, should_pass in ATTACKS:
    va = S().variant(patch)
    ga = atk_gate(va, None, atk_score)
    check(f"Gate：{desc} → {'放行' if should_pass else '拦住'}",
          ga["passed"] == should_pass,
          f"实际{'放行' if ga['passed'] else '拦住'}；{ga['reasons'][0][:70]}")
    va.cleanup()

# 反面：基线里本来就共用的文件不算「新引入的共用」，
# 否则「同一工具的在线页与下载指同一文件」这种真实正当场景会被误拦
same = S().variant({"id": 2, "field": "DownloadFileName", "value": "twin.html"})
gs = atk_gate(same, None, atk_score)
check("同一工具的在线页与下载指同一文件 → 不算新共用，不误拦",
      gs["passed"], gs["reasons"][0][:80])
same.cleanup()

# ⑭ 灵犀第三轮的三个发现
# ⑭a 真身状态未知时才抛，且抛之前自己留痕
class WriteFails(GoodayAssets):
    @classmethod
    def _exec(cls, db, sql, args, sudo, expect_changes=True):
        if sql.startswith("UPDATE"):
            raise RuntimeError("模拟写失败")
        return super()._exec(db, sql, args, sudo, expect_changes)
wf = WriteFails(db=DB, media=MEDIA, sudo=False)
wf._touched = [1]
try:
    wf.rollback(S().checkpoint())
    check("写失败（真身状态未知）→ 抛", False, "居然没抛")
except RuntimeError as e:
    check("写失败（真身状态未知）→ 抛，且区别于「行被删」", "状态未知" in str(e), str(e)[:60])

# ⑭b _touched 为空时不许降级成全表回滚
empty = S()
rep_empty = empty.rollback(S().checkpoint())
check("没记录改过哪些行 → 不回滚任何东西（不是全表滚）",
      rep_empty["restored"] == [] and "未执行任何回滚" in "".join(rep_empty["problems"]),
      rep_empty)

# ⑭c OnlineUrl 的孪生修复要带 /uploads/ 前缀，DownloadFileName 不带
pg = os.path.join(MEDIA, "uploads", "page.html")
open(pg, "w").write("p")
os.utime(pg, (ts, ts))
subprocess.run(["sqlite3", DB, """INSERT INTO Tools VALUES
  (40,'在线页改名了','w','','系统','x',1,'/uploads/page_20260429062048.html',0,NULL,1,0,'');"""],
    capture_output=True)
r40 = S().run(None); e40 = phases.evaluate(r40)
c40 = [c for c in phases.improve(phases.learn(e40, r40, media=MEDIA), e40)
       if c["patch"]["id"] == 40]
check("OnlineUrl 孪生修复带 /uploads/ 前缀（不带就永远修不好）",
      c40 and c40[0]["patch"]["value"] == "/uploads/page.html",
      c40[0]["patch"] if c40 else "没生成候选")
if c40:
    v40 = S().variant(c40[0]["patch"])
    fixed = [r for r in v40.run(None) if r["id"] == 40]
    check("应用后该在线页真的可达了", fixed and fixed[0]["exists"],
          fixed[0] if fixed else "")
    v40.cleanup()

# ⑭d 未发布草稿的文件不许被已发布工具认领
sec = os.path.join(MEDIA, "uploads", "secret.html")
open(sec, "w").write("draft")
os.utime(sec, (ts, ts))
subprocess.run(["sqlite3", DB, """
INSERT INTO Tools VALUES (41,'草稿','dr','','系统','x',1,'/uploads/secret.html',0,NULL,0,0,'');
INSERT INTO Tools VALUES (42,'已发布的','pb','','系统','x',0,NULL,1,
  'secret_20260429062048.html',1,0,'');"""], capture_output=True)
sub42 = S()
r42 = sub42.run(None); e42 = phases.evaluate(r42)
k42 = [e["kind"] for e in phases.learn(e42, r42, media=MEDIA,
                                       all_refs=sub42.all_refs())
       if e.get("item", {}).get("id") == 42]
check("未发布草稿的文件不被已发布工具认领（Gate 抓不到这个）",
      k42 == ["orphan_download"], k42)
subprocess.run(["sqlite3", DB, "DELETE FROM Tools WHERE Id IN (40,41,42);"],
               capture_output=True)
for f in (pg, sec):
    os.unlink(f)

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
