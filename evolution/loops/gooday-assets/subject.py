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
import json
import os
import subprocess
import tempfile

# 生产库与媒体根。媒体根是容器 /app/wwwroot 的绑定挂载源。
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

    def variant(self, patch):
        """隔离副本：把库复制到临时文件，patch 只作用在副本上。

        【绝不改真身】。变体构造失败时上层会中止本轮，
        不会退化成「那就直接在生产上试试」。
        """
        fd, tmp = tempfile.mkstemp(prefix="gooday-assets-variant-", suffix=".db")
        os.close(fd)
        os.unlink(tmp)                   # sqlite 要自己建

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

    def rollback(self, ckpt):
        """把**本轮真正改过的那几行**按 checkpoint 写回，并回读校验。

        ═══ 三处是踩过/被指出才明白的 ═══════════════════════════

        **一、只滚自己动过的行。** 原来遍历 checkpoint 全部 1018 行逐行 UPDATE
        —— 为撤销一行改动而重写整张表。期间别的进程（管理后台、发工具脚本）
        合法改过别的工具，会被一并抹掉。**回滚是补救手段，它自己不能制造新事故。**

        **二、字段由 ALLOWED_FIELDS 派生**，不手写。能改却滚不回来 = 回滚是残的。

        **三、写完必须回读校验。** 不校验的话，回滚失败和回滚成功长得一模一样，
        而那正是最需要确定性的时刻。
        """
        fields = ckpt.get("fields") or sorted(self.ALLOWED_FIELDS)
        missing = self.ALLOWED_FIELDS - set(fields)
        if missing:
            raise RuntimeError(
                f"字段 {sorted(missing)} 在可改白名单里，但 checkpoint 没存它，"
                "回滚会不完整。请让 checkpoint() 与本函数都从 ALLOWED_FIELDS 派生")

        want = set(self._touched or [])
        restored = []
        for row in ckpt.get("rows", []):
            tid = row.get("Id")
            if want and tid not in want:
                continue                     # 不是本轮动过的，不碰
            sets = ", ".join(f"{f}=?" for f in fields)
            self._exec(self.db, f"UPDATE Tools SET {sets} WHERE Id=?;",
                       tuple(row.get(f) for f in fields) + (tid,), sudo=self.sudo)
            restored.append((tid, row))

        # 回读校验：写回去的是不是真的等于 checkpoint
        for tid, row in restored:
            cur = _sql(self.db,
                       f"SELECT {','.join(fields)} FROM Tools WHERE Id={int(tid)};",
                       self.sudo)
            if not cur:
                raise RuntimeError(f"回滚校验失败：Id={tid} 查不到")
            for f in fields:
                if cur[0].get(f) != row.get(f):
                    raise RuntimeError(
                        f"回滚校验失败：Id={tid} 的 {f} 期望 {row.get(f)!r}，"
                        f"实际 {cur[0].get(f)!r}")


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
    def _exec(cls, db, sql, args, sudo):
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
        cmd = (["sudo", "-n"] if sudo else []) + ["sqlite3", db, q]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            raise RuntimeError(f"写库失败: {(r.stderr or '').strip()[:200]}")

    def cleanup(self):
        if self._tmp and os.path.exists(self._tmp):
            try:
                os.unlink(self._tmp)
            except OSError:
                pass
