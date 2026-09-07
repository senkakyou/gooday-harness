#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""被改进的对象：**运行中的 Gooday 已发布内容完整性**。

不是 demo，是真库真文件真用户。判据是二值的、没有解释空间：
库里说某个已发布工具有文件在路径 X，X 在磁盘上到底存不存在。

═══ 为什么选它作为第一条真实闭环 ═══════════════════════════════

2026-09-07 巡检持续报 P0：「有 2 项已发布内容的文件丢了」。
实测：两个 URL 对真实用户返回 404，而后台一切正常、页面照常列出来。
**只有点进去的人才知道**。这满足第一条闭环该有的全部条件：

  · 真实——现在就在发生，每 5 分钟报一次
  · 可客观测量——文件在不在，不需要判断
  · 低风险——改的是元数据字段，不动文件，checkpoint 是整行
  · 可自动复验——改完 URL 要么 200、要么不再对外宣称有下载

═══ 隔离：变体绝不碰生产库 ═══════════════════════════════════

`variant()` 把运行库**复制一份到临时文件**，patch 只作用在副本上。
拿生产当实验场，是这套东西最不该犯的错。
"""
import glob
import json
import os
import subprocess
import tempfile
import time
import weakref

# 生产库与媒体根。媒体根是容器 /app/wwwroot 的绑定挂载源。
def _repo_root(start):
    """向上找 AGENTS.md 认仓库根（别数 dirname 层数，挪个位置就算错）。"""
    d = start
    while True:
        if os.path.exists(os.path.join(d, "AGENTS.md")):
            return d
        p = os.path.dirname(d)
        if p == d:
            return start
        d = p


DB = os.environ.get("GOODAY_DB",
                    "/var/lib/docker/volumes/gooday_gooday_data/_data/gooday.db")
MEDIA = os.environ.get("GOODAY_MEDIA", "/srv/gooday-harness/media")


def _sql(db, sql, sudo=True):
    """读库，返回 [dict]。

    ═══ 必须 `-json`，不能按 `|` 切 ═══════════════════════════════

    2026-09-07 灵犀评审发现、实测复现：sqlite3 默认用 `|` 分隔列，
    而工具名里完全可能有竖线（`A|B 对比工具`）。按 `|` split 的后果：
      · 列数不足 → 那一行被静默跳过，**永远回滚不了**
      · 列数恰好够 → 字段整体错位，回滚会把 Category 写进 OnlineUrl、
        IconEmoji 写进 HasDownload ——**回滚动作本身在写坏生产数据**
    实测就是后者：回滚后 OnlineUrl 变成 '1'、HasDownload 变成了路径。

    而当时 28 项测试全绿 —— 测试数据里没有一个竖线，这个 bug 天然照不到。
    顺带：`-json` 里 NULL 就是 null，按 `|` 切会读成空串，回滚后 NULL 变空串。

    走 sqlite3 命令行而不是 python sqlite3，是因为生产库归 root，
    本机只授权了 `sudo sqlite3` 这一条路径。
    """
    # ⚠️ `-json` 必须放在**库路径之后**。本机的 sudoers 规则是
    #    `sqlite3 <库路径> *` —— 选项放前面就不匹配那条规则，报「需要密码」。
    #    授权规则长什么样，会决定命令怎么写；这不是风格问题。
    cmd = (["sudo", "-n"] if sudo else []) + ["sqlite3", db, "-json", sql]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f"查库失败: {(r.stderr or '').strip()[:200]}")
    out = (r.stdout or "").strip()
    if not out:
        return []
    return json.loads(out)


class GoodayAssets:
    """已发布内容完整性。实现 packages/evolve 的 Subject 接口。"""

    def __init__(self, db=DB, media=MEDIA, sudo=True):
        self.db, self.media, self.sudo = db, media, sudo
        self._tmp = None                 # 变体持有的临时库，用完删
        self._touched = []               # 本轮 promote 动过哪些行，rollback 据此定范围

    # ── Subject 接口 ────────────────────────────────────────
    def run(self, inputs=None):
        """扫一遍所有已发布工具，逐项判定文件在不在。

        返回 [{id,name,field,url,path,exists}]，一个工具可能有两项
        （在线页面 + 下载文件），它们各自独立坏。
        """
        rows = _sql(self.db,
                    "SELECT Id,Name,OnlineUrl,DownloadFileName,IsOnline,"
                    "HasDownload FROM Tools WHERE IsPublished=1;", self.sudo)
        out = []
        for r in rows:
            if r.get("IsOnline") and r.get("OnlineUrl"):
                out.append(self._item(r["Id"], r["Name"], "OnlineUrl", r["OnlineUrl"]))
            if r.get("HasDownload") and r.get("DownloadFileName"):
                dl = r["DownloadFileName"]
                out.append(self._item(r["Id"], r["Name"], "DownloadFileName",
                                      dl if dl.startswith("/") else "/uploads/" + dl))
        return out

    def _item(self, tid, name, field, rel):
        rel = rel if rel.startswith("/") else "/" + rel
        path = os.path.join(self.media, rel.lstrip("/"))
        return {"id": int(tid), "name": name, "field": field,
                "url": rel, "path": path, "exists": os.path.isfile(path)}

    def all_refs(self):
        """【全表】的 (工具Id, 文件真实路径) 引用关系，**含未发布的草稿**。

        learn 用它判断「这个文件是不是别人的」。只扫已发布的话，
        草稿工具的文件不在名单里，会被坏掉的已发布工具认领 ——
        文件确实存在，于是分数涨、Gate 全过，而用户下到的是草稿内容。
        Gate 抓不到这个：它只测「存在」，不测「是谁的」。
        """
        out = set()
        for r in _sql(self.db,
                      "SELECT Id,OnlineUrl,DownloadFileName FROM Tools;", self.sudo):
            for field, val in (("OnlineUrl", r.get("OnlineUrl")),
                               ("DownloadFileName", r.get("DownloadFileName"))):
                if not val:
                    continue
                rel = val if val.startswith("/") else (
                    "/uploads/" + val if field == "DownloadFileName" else "/" + val)
                out.add((r["Id"], os.path.realpath(
                    os.path.join(self.media, rel.lstrip("/")))))
        return out

    def variant(self, patch):
        """隔离副本：把库复制到临时文件，patch 只作用在副本上。

        【绝不改真身】。变体构造失败时上层会中止本轮，
        不会退化成「那就直接在生产上试试」。
        """
        self._sweep_stale()              # 进程被 SIGKILL 时 finalize 也跑不了
        # 【别 unlink】：mkstemp 出来就是 0600 的 0 字节文件，
        # 而 0 字节文件本身就是合法的空 sqlite 库，sqlite 会直接往里写。
        # 原来 unlink 掉让 sqlite 自己建，权限按 umask 落回 0644，还多出两个窗口：
        # 重建失败时泄漏一个 0644 的半份 Tools 副本（此时 finalize 还没注册，
        # 只能等 6 小时清扫）；成功路径上「建好→chmod」之间也有 0644 的一瞬。
        # 不 unlink 就从头到尾 0600，chmod 和竞态窗口都不需要了（灵犀评审建议）。
        fd, tmp = tempfile.mkstemp(prefix="gooday-assets-variant-", suffix=".db")
        os.close(fd)

        # 用 `.dump` 导出再本地重建，而不是 cp 库文件。两个理由：
        #   1. **WAL 模式下直接 cp 主文件会丢数据** —— 新写入还在 -wal 里
        #      （CLAUDE.md 记过这条）。`.dump` 走的是事务视图，拿到的是一致快照。
        #   2. cp 出来的文件归 root，变体要写它就还得提权；
        #      dump 走 stdout，重建出来的库本来就归当前身份，实验不需要任何提权。
        # 只导 Tools 表：这条闭环只碰它，导整库既慢又扩大了实验的影响面。
        d = subprocess.run((["sudo", "-n"] if self.sudo else []) +
                           ["sqlite3", self.db, ".dump Tools"],
                           capture_output=True, text=True, timeout=120)
        if d.returncode != 0 or not d.stdout.strip():
            raise RuntimeError(f"导出 Tools 失败: {(d.stderr or '').strip()[:200]}")
        b = subprocess.run(["sqlite3", tmp], input=d.stdout,
                           capture_output=True, text=True, timeout=120)
        if b.returncode != 0:
            raise RuntimeError(f"重建变体库失败: {(b.stderr or '').strip()[:200]}")

        v = GoodayAssets(db=tmp, media=self.media, sudo=False)
        v._tmp = tmp
        # 【weakref.finalize 而不是 __del__】：GC 和解释器退出都能兜住。
        # 引擎不调 cleanup()——它不该知道某条闭环的变体是文件还是别的什么，
        # 那是 Subject 自己的事。
        #
        # ⚠️ callback 必须是 staticmethod + 纯字符串参数。
        # **绝不能写成 `weakref.finalize(v, v.cleanup)`** —— 那样 finalize
        # 会强引用 v 的绑定方法，v 永远不被回收，临时库永远不删。
        # 现在这条链是 v._fin → finalize → weakref(v)，不成环。
        v._fin = weakref.finalize(v, GoodayAssets._unlink_quiet, tmp)
        v._apply(tmp, patch, sudo=False)
        return v

    def checkpoint(self):
        """回滚点：**只存本闭环能改的那几个字段**，加 Id。

        原来存 13 列，注释写的理由是「Admin API 的 PUT 是全量覆盖」——
        但实现走的是直连 SQL，理由和代码对不上（灵犀评审指出）。
        直连 SQL 只改指定列，存全表既无必要，也扩大了回滚的影响面。

        存哪些列由 ALLOWED_FIELDS 派生，不手写：
        往白名单加字段却忘了同步这里，回滚就会静默变成残的。
        """
        cols = ",".join(["Id"] + sorted(self.ALLOWED_FIELDS))
        return {"rows": _sql(self.db, f"SELECT {cols} FROM Tools;", self.sudo),
                "fields": sorted(self.ALLOWED_FIELDS), "db": self.db}


    def promote(self, patch):
        """真正应用。只有过了 Gate 才会被调用。

        【先记下要动哪些行，再动】。顺序不能反：promote 中途炸掉时，
        引擎会调 rollback，那时必须已经知道该滚哪几行。
        """
        self._touched = sorted({int(p["id"]) for p in
                                (patch if isinstance(patch, list) else [patch])})
        self._apply(self.db, patch, sudo=self.sudo)

    def rollback(self, ckpt, ids=None):
        """把本轮改过的行按 checkpoint 写回。返回 {restored, problems}。

        ═══ 只在【真身状态未知】时抛 ═══════════════════════════════

        引擎里三处 `self.subject.rollback(ckpt)` 都是裸调用，
        紧跟在后面的 `dec.update(status="rolled_back")` 和 `_write(dpath, dec)`
        才是落盘留痕。所以**这里一抛，Decision 就永远停在 status=experimenting**
        —— 生产已经被 promote 改过、又已经回滚干净，而记录说「还在实验中」。
        那正是本项目最恨的「执行失败但系统认为成功」的镜像版（灵犀评审指出）。

        所以两种性质分开，绝不压成同一个异常：
          · **行已不存在** —— 没什么可滚，属于告知级。记进 problems，不抛。
          · **写失败 / 回读不符** —— 真身可能还带着改动，必须叫人。抛。
            抛之前先自己落一条 P0 事件，这样即使引擎那边的 decision
            没写成，证据链上仍有记录。

        `ids` 显式指定要滚哪些行；不传则用本轮 promote 记下的 _touched。
        **两者都空 = 没什么可滚，不是「全滚」** —— checkpoint 就是为崩溃后
        人工恢复才落盘的，恢复脚本新建 subject 再调 rollback 时 _touched 是空的，
        降级成全表 1018 行回滚正好踩上要避免的那件事。要全滚请显式传 ids。
        """
        fields = ckpt.get("fields") or sorted(self.ALLOWED_FIELDS)
        missing = self.ALLOWED_FIELDS - set(fields)
        if missing:
            raise RuntimeError(
                f"字段 {sorted(missing)} 在可改白名单里，但 checkpoint 没存它，"
                "回滚会不完整。请让 checkpoint() 与本函数都从 ALLOWED_FIELDS 派生")
        # 【反向也要校验】：fields 来自 checkpoint 的 JSON，而 checkpoint 文件
        # 正是为人工恢复才落盘的、会被手改的东西。它直接拼进
        # `SET {f}=?` 和 `SELECT {','.join(fields)}` —— 不校验就等于
        # rollback 这条路绕过了整个白名单。实测：改一份 checkpoint 加上
        # IsPublished，回滚就能把工具下架。
        # _apply 那边写着「边界必须在最靠近写操作的地方再确认一次」，
        # 这一侧当时没确认（灵犀第四轮发现）。
        extra = set(fields) - self.ALLOWED_FIELDS
        if extra:
            raise RuntimeError(
                f"checkpoint 里的字段 {sorted(extra)} 不在自动改动白名单内，"
                "拒绝回滚。checkpoint 文件可能被改过")

        want = set(ids) if ids is not None else set(self._touched or [])
        report = {"restored": [], "problems": [], "unknown_state": False}
        if not want:
            # 【不能在这里提前 return】——那样就绕过了末尾的留痕，
            # 于是「一行没滚」既无 trace、引擎又照样写 status=rolled_back，
            # **记录说已回滚、实际什么都没做**。而这条路径正是文档里写的
            # 人工恢复场景（新建 subject，_touched 是空的）。
            # 这是最该留痕的一条，第一版偏偏是唯一不留痕的（灵犀第四轮发现）。
            report["problems"].append("没有记录本轮改过哪些行，未执行任何回滚")

        seen = set()
        for row in ckpt.get("rows", []):
            tid = row.get("Id")
            if tid not in want:
                continue
            seen.add(tid)
            sets = ", ".join(f"{f}=?" for f in fields)
            try:
                n = self._exec(self.db, f"UPDATE Tools SET {sets} WHERE Id=?;",
                               tuple(row.get(f) for f in fields) + (tid,),
                               sudo=self.sudo, expect_changes=False)
            except Exception as e:
                # 写失败 = 真身可能还带着改动
                report["problems"].append(f"Id={tid} 回滚写入失败: {e}")
                report["unknown_state"] = True
                continue
            if n == 0:
                report["problems"].append(f"Id={tid} 已不存在（checkpoint 之后被删），无可回滚")
                continue
            report["restored"].append(tid)

        # ② want 里有、checkpoint 里没有 —— 零动作却报干净，同一个静默家族
        for tid in sorted(want - seen, key=str):
            report["problems"].append(
                f"Id={tid} 不在 checkpoint 里，无法回滚（id 类型不符？传错了？）")

        # 回读校验：不校验的话，回滚失败和回滚成功长得一模一样
        for tid in list(report["restored"]):
            row = next((r for r in ckpt["rows"] if r.get("Id") == tid), None)
            cur = _sql(self.db,
                       f"SELECT {','.join(fields)} FROM Tools WHERE Id={int(tid)};",
                       self.sudo)
            if not cur or row is None:
                report["problems"].append(f"Id={tid} 回读不到")
                report["unknown_state"] = True
                continue
            for f in fields:
                if cur[0].get(f) != row.get(f):
                    report["problems"].append(
                        f"Id={tid} 的 {f} 期望 {row.get(f)!r} 实际 {cur[0].get(f)!r}")
                    report["unknown_state"] = True

        if report["unknown_state"]:
            # 先自己留痕再抛：引擎那边的 decision 写不成时，至少证据链上有
            self._emit("rollback_incomplete", "P0", report)
            raise RuntimeError("回滚未完成，真身状态未知（其余行已尽力复原）："
                               + "；".join(report["problems"][:5]))

        # 【告知级的也要落痕】。返回 dict 给调用方是对的，但引擎不看返回值 ——
        # 「行已不存在，无可回滚」这种信息就只活在一个没人读的字典里，等于没记。
        # 自己往 trace 落一条 P2：证据链上留得住，patrol 也看得见。
        if report["problems"]:
            self._emit("rollback_partial", "P2", report)
        return report

    def _emit(self, kind, level, payload):
        """自己往 trace 落一条事件。复用 packages/trace，不另造日志系统。

        为什么 Subject 要自己留痕：引擎只落 Decision，而 Decision 里
        没有「回滚时哪几行滚不动」这种颗粒度；且 rollback 抛异常那条路径上
        引擎的 Decision 根本写不成。**能自己说的话就自己说。**
        """
        try:
            import sys as _sys
            tp = os.path.join(_repo_root(os.path.dirname(os.path.abspath(__file__))),
                              "packages", "trace")
            if tp not in _sys.path:
                _sys.path.insert(0, tp)
            from trace import Task
            with Task("gooday-assets-rollback", subject=str(self._touched or []),
                      actor="gooday-assets") as t:
                t.event(kind, level, dict(payload, touched=self._touched,
                                          db=self.db))
        except Exception as e:
            # 留痕失败不能反过来盖掉原始故障，但**也不能一声不吭** ——
            # 这是最后一道证据，它自己失败时至少要有人看得见。
            print(f"[gooday-assets] ⚠️ 留痕失败（原始事件 {kind}/{level} 丢失）: {e}",
                  file=__import__("sys").stderr, flush=True)


    # ── 内部 ────────────────────────────────────────────────
    # 自动改动能碰的字段，**写死在执行层**。
    # improve 那边也有一份白名单，但那是「生成候选时的自律」；
    # 这一份是「即使候选来路不明也改不动别的东西」的硬边界。
    # 一个自动改生产库的东西，边界必须在最靠近写操作的地方再确认一次。
    ALLOWED_FIELDS = {"DownloadFileName", "HasDownload", "OnlineUrl"}

    def _apply(self, db, patch, sudo):
        """patch = {"id":N, "field":"DownloadFileName", "value":... }
        或 {"id":N, "field":"HasDownload", "value":0}。"""
        for p in (patch if isinstance(patch, list) else [patch]):
            field = p["field"]
            if field not in self.ALLOWED_FIELDS:
                raise RuntimeError(
                    f"字段 {field} 不在自动改动白名单内，拒绝执行。"
                    f"允许的只有 {sorted(self.ALLOWED_FIELDS)}")
            if not str(p["id"]).isdigit():
                raise RuntimeError(f"工具 Id 必须是数字，收到 {p['id']!r}")
            self._exec(db, f"UPDATE Tools SET {field}=? WHERE Id=?;",
                       (p["value"], p["id"]), sudo=sudo)

    @staticmethod
    def _quote(a):
        """按 SQLite 字面量规则转义。

        None → NULL（不是 'None' 也不是空串）。`-json` 把 NULL 读成 None，
        回滚时必须能原样写回去 —— 否则 NULL 会变成空串，而
        「没有下载文件名」和「下载文件名是空字符串」在应用层可能是两回事。
        """
        if a is None:
            return "NULL"
        if isinstance(a, bool):
            return "1" if a else "0"
        if isinstance(a, int):
            return str(a)
        return "'" + str(a).replace("'", "''") + "'"

    @classmethod
    def _exec(cls, db, sql, args, sudo, expect_changes=True):
        """执行写操作。

        ⚠️ 占位符必须【一次性切分拼接】，不能 `for a in args: q.replace("?", v, 1)`。
        逐个替换会扫到**已经替换进去的值**：文件名里出现一个 `?`，
        下一个参数就替换到那个 `?` 上，SQL 结构被破坏。
        2026-09-07 实测：value="a?b.html" 直接报 `near "1": syntax error`。
        （这次是响亮失败，但同类写法在别的语句形状下可能变成静默改错行。）

        走 sqlite3 命令行而不是 python sqlite3，是因为生产库归 root，
        而本机只授权了 `sudo sqlite3` 这一条路径。
        """
        parts = sql.split("?")
        if len(parts) != len(args) + 1:
            raise RuntimeError(f"占位符数({len(parts)-1})与参数数({len(args)})对不上")
        q = parts[0]
        for a, tail in zip(args, parts[1:]):
            q += cls._quote(a) + tail
        # 【要求真的改到了行】。`UPDATE ... WHERE Id=999` 匹配 0 行时
        # sqlite 返回 0（成功），于是「工具已被删除」会被记成一次成功的 promote，
        # 而 Decision 里写着 promoted、实际什么也没发生。
        # （SQLite 的 changes() 计「匹配到的行」，把字段更新成原值也算 1，
        #   所以 0 行只可能是 Id 真不存在——干净信号，没有误报。）
        #
        # ⚠️ 但**不能无条件抛**：rollback 也走这里。某行在 checkpoint 之后
        # 被人删了，抛异常会把【后面几行的回滚一起打断】——第一版就是这样，
        # 实测 Id=2 被删导致 Id=3 停在改动后的值上。回滚是补救手段，
        # 它必须尽力做完，不能因为一行没了就整体作废。
        # 所以 promote 路径 expect_changes=True（抛错），
        # rollback 路径 False（返回 0，由调用方收集告警继续走）。
        q_with_check = q.rstrip().rstrip(";") + "; SELECT changes();"
        cmd = (["sudo", "-n"] if sudo else []) + ["sqlite3", db, q_with_check]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            raise RuntimeError(f"写库失败: {(r.stderr or '').strip()[:200]}")
        lines = (r.stdout or "").strip().splitlines()
        n = int(lines[-1].strip()) if lines and lines[-1].strip().isdigit() else -1
        if expect_changes and n == 0:
            raise RuntimeError(
                f"写库匹配 0 行 —— 目标可能已被删除。语句: {q[:120]}")
        return n

    @staticmethod
    def _unlink_quiet(path):
        try:
            os.unlink(path)
        except OSError:
            pass

    def cleanup(self):
        """显式清理。finalize 已经兜底，这里让调用方能主动收回。"""
        fin = getattr(self, "_fin", None)
        if fin is not None:
            fin()                         # finalize 是幂等的
        elif self._tmp:
            self._unlink_quiet(self._tmp)
        self._tmp = None

    @staticmethod
    def _sweep_stale(hours=6):
        """扫掉超过 N 小时的遗留变体库。

        finalize 兜住了正常路径，但进程被 SIGKILL 时什么都不会跑。
        **在 variant() 开头扫**，不在 run()/gate 里扫——那时变体还在用。
        """
        cutoff = time.time() - hours * 3600
        for f in glob.glob(os.path.join(tempfile.gettempdir(),
                                        "gooday-assets-variant-*.db")):
            try:
                if os.path.getmtime(f) < cutoff:
                    os.unlink(f)
            except OSError:
                pass
