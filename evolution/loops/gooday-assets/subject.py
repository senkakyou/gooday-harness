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
import os
import shutil
import sqlite3
import subprocess
import tempfile

# 生产库与媒体根。媒体根是容器 /app/wwwroot 的绑定挂载源。
DB = os.environ.get("GOODAY_DB",
                    "/var/lib/docker/volumes/gooday_gooday_data/_data/gooday.db")
MEDIA = os.environ.get("GOODAY_MEDIA", "/srv/gooday-harness/media")


def _sql(db, sql, sudo=True):
    """读库。生产库归 root，巡检/闭环以 root 跑；开发机上用 sudo -n。

    走 sqlite3 命令行而不是 python sqlite3，是因为**只读也需要目录读权限**，
    而 sudo -n sqlite3 是本机明确授权过的路径。
    """
    cmd = (["sudo", "-n"] if sudo else []) + ["sqlite3", db, sql]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        raise RuntimeError(f"查库失败: {(r.stderr or '').strip()[:200]}")
    return [l for l in r.stdout.strip().splitlines() if l]


class GoodayAssets:
    """已发布内容完整性。实现 packages/evolve 的 Subject 接口。"""

    def __init__(self, db=DB, media=MEDIA, sudo=True):
        self.db, self.media, self.sudo = db, media, sudo
        self._tmp = None                 # 变体持有的临时库，用完删

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
        for line in rows:
            p = line.split("|")
            if len(p) < 6:
                continue
            tid, name, online, dl, is_on, has_dl = p[0], p[1], p[2], p[3], p[4], p[5]
            if is_on == "1" and online:
                out.append(self._item(tid, name, "OnlineUrl", online))
            if has_dl == "1" and dl:
                rel = dl if dl.startswith("/") else "/uploads/" + dl
                out.append(self._item(tid, name, "DownloadFileName", rel))
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
        """回滚点：受影响工具的**整行原值**。

        只存被改的字段是不够的——Admin API 的 PUT 是全量覆盖，
        回滚时必须能把整行原样写回去（CLAUDE.md 记过这个坑）。
        """
        rows = _sql(self.db,
                    "SELECT Id,Name,Slug,Description,Category,IconEmoji,IsOnline,"
                    "OnlineUrl,HasDownload,DownloadFileName,IsPublished,RequireLogin,"
                    "COALESCE(ReadmeMarkdown,'') FROM Tools WHERE IsPublished=1;",
                    self.sudo)
        return {"rows": rows, "db": self.db}

    def promote(self, patch):
        """真正应用。只有过了 Gate 才会被调用。"""
        self._apply(self.db, patch, sudo=self.sudo)

    def rollback(self, ckpt):
        """按 checkpoint 把受影响行的字段写回。"""
        for line in ckpt.get("rows", []):
            p = line.split("|")
            if len(p) < 13:
                continue
            tid, online_url, has_dl, dl = p[0], p[7], p[8], p[9]
            self._exec(self.db,
                       "UPDATE Tools SET OnlineUrl=?, HasDownload=?, "
                       "DownloadFileName=? WHERE Id=?;",
                       (online_url, has_dl, dl, tid), sudo=self.sudo)

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
        """按 SQLite 字面量规则转义。整数不加引号，避免存进 INT 列变成文本。"""
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
