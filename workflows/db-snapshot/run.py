#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""数据库快照。cron 每小时调起，跑完退出。

从旧 Gooday 的 db-snapshot.sh 重新设计。保留它三条硬知识：

1. **用 `sqlite3 .backup` 在线热备**，不用 cp。
   WAL 模式下写入先落 `-wal` 文件，直接 cp 主文件会得到一份
   「看起来正常但缺最近写入」的快照——这种损坏不报错，
   只在你真的需要恢复的那天才发现（policies G14）。

2. **备完立即校验**：integrity_check ＋ 关键表非空。
   文件完整不等于数据在——"备份成功但内容是空的"是真实存在的失败形态。

3. **校验通过才替换正式位**。上一份好快照在此之前一直保留。
   否则一次失败的备份会顺手毁掉上一份能用的。

新增一条旧脚本没有的：**恢复演练**。
旧脚本验证的是「备份文件完整」，从没验证过「这份备份能恢复」——
而后者才是你真正需要的那个。见 _restore_drill()。
"""
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages", "trace"))

from trace import Task                                    # noqa: E402

CONFIG = os.path.join(HERE, "config.json")
BACKUP_ROOT = "/srv/gooday-harness/backups"
FAIL_MARK = os.path.join(BACKUP_ROOT, ".snapshot-failure")


def log(msg):
    print(f"[db-snapshot] {time.strftime('%F %T')} {msg}", flush=True)


def _hot_backup(db, dest_tmp):
    """在线热备。返回 (ok, 错误信息)。"""
    r = subprocess.run(["sqlite3", db, f".backup '{dest_tmp}'"],
                       capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        return False, (r.stderr or "sqlite3 .backup 失败").strip()
    if not os.path.exists(dest_tmp) or os.path.getsize(dest_tmp) == 0:
        return False, "备份文件不存在或为 0 字节"
    return True, ""


def _validate(path, table, min_rows):
    """校验这份备份能不能用。返回 (ok, 说明, 行数)。"""
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=30)
    except Exception as e:
        return False, f"打不开: {e}", 0
    try:
        chk = conn.execute("PRAGMA integrity_check;").fetchone()[0]
        if chk != "ok":
            return False, f"integrity_check 不通过: {chk}", 0
        n = conn.execute(f"SELECT COUNT(*) FROM {table};").fetchone()[0]
        if n < min_rows:
            # 文件完整、但内容是空的——这也是失败，而且是更阴的那种
            return False, f"关键表 {table} 只有 {n} 行（应 ≥{min_rows}）", n
        return True, "", n
    except Exception as e:
        return False, f"校验查询失败: {e}", 0
    finally:
        conn.close()


def _restore_drill(snapshot, table, task):
    """恢复演练：把最新快照当成真要恢复的那份，复制出来打开并查关键表。

    旧脚本没有这一步。它验证的是「备份文件完整」，
    而你真正需要的是「这份备份能恢复」——两件事。
    备份体系最危险的状态不是没备份，是**以为有备份**。
    """
    drill = snapshot + ".drill"
    try:
        shutil.copy2(snapshot, drill)
        ok, why, n = _validate(drill, table, 1)
        task.event("restore_drill", "P2" if ok else "P0",
                   {"snapshot": snapshot, "ok": ok, "why": why, "rows": n})
        return ok, why, n
    except Exception as e:
        task.event("restore_drill", "P0", {"snapshot": snapshot, "error": str(e)})
        return False, str(e), 0
    finally:
        if os.path.exists(drill):
            os.remove(drill)


def main():
    if not os.path.exists(CONFIG):
        log(f"缺 {CONFIG}，从 config.example.json 拷一份改")
        return 2
    with open(CONFIG, encoding="utf-8") as f:
        cfg = {k: v for k, v in json.load(f).items() if not k.startswith("_")}

    hour = time.strftime("%H")
    failures = []

    with Task("db-snapshot", subject=hour, actor="db-snapshot") as task:
        for t in cfg.get("targets", []):
            name, db = t["name"], t["db"]
            hourly = os.path.join(BACKUP_ROOT, name, "hourly")
            daily = os.path.join(BACKUP_ROOT, name, "daily")
            os.makedirs(hourly, exist_ok=True)
            os.makedirs(daily, exist_ok=True)

            if not os.path.exists(db):
                # 【区分「不存在」和「看不见」】。父目录不可读时 os.path.exists
                # 也返回 False——报「源库不存在」会让人去找一个没丢的文件。
                # 今天在 db_health、migration 上已经栽过同一形态两次。
                parent = os.path.dirname(db)
                if not os.access(parent, os.R_OK | os.X_OK):
                    why = (f"{parent} 对当前身份不可读，无法判断 {db} 的状态"
                           f"（备份需以能读该路径的身份跑，cron 用 root）")
                    task.event("source_unreadable", "P1",
                               {"target": name, "db": db, "why": why})
                else:
                    why = f"源库确实不存在：{db}（父目录可读）"
                    task.event("source_missing", "P0", {"target": name, "db": db})
                failures.append(f"{name}: {why}")
                continue

            tmp = os.path.join(hourly, f".{name}-{hour}.db.tmp")
            dest = os.path.join(hourly, f"{name}-{hour}.db")

            ok, err = _hot_backup(db, tmp)
            if not ok:
                failures.append(f"{name}: {err}")
                task.event("backup_failed", "P0", {"target": name, "error": err})
                if os.path.exists(tmp):
                    os.remove(tmp)
                continue

            ok, why, rows = _validate(tmp, t.get("sanity_table", "sqlite_master"),
                                      t.get("sanity_min_rows", 0))
            if not ok:
                # 【关键】校验不过就不替换正式位，上一份好快照原封不动
                failures.append(f"{name}: {why}")
                task.event("validate_failed", "P0",
                           {"target": name, "why": why,
                            "kept_previous": os.path.exists(dest)})
                os.remove(tmp)
                continue

            os.replace(tmp, dest)          # 原子替换
            size_mb = os.path.getsize(dest) / 1048576
            task.event("snapshot_ok", "P3",
                       {"target": name, "dest": dest,
                        "rows": rows, "size_mb": round(size_mb, 1)})
            log(f"{name} hourly OK → {dest}（{t.get('sanity_table')}={rows}, {size_mb:.1f}MB）")

            # 日快照
            if hour == t.get("daily_at_hour", "03"):
                dp = os.path.join(daily, f"{name}-{time.strftime('%Y%m%d')}.db")
                shutil.copy2(dest, dp)
                keep = t.get("daily_keep", 7)
                olds = sorted(os.listdir(daily), reverse=True)
                for f in olds[keep:]:
                    os.remove(os.path.join(daily, f))
                task.event("daily_archived", "P3", {"target": name, "dest": dp,
                                                    "kept": min(len(olds) + 1, keep)})
                log(f"{name} daily OK → {dp}")

            # 恢复演练
            if hour == cfg.get("restore_drill_hour", "04"):
                dok, dwhy, dn = _restore_drill(dest, t.get("sanity_table", "sqlite_master"),
                                               task)
                if dok:
                    log(f"{name} 恢复演练通过（{dn} 行）")
                else:
                    failures.append(f"{name}: 恢复演练失败 {dwhy}")
                    log(f"{name} 恢复演练失败: {dwhy}")

        # 失败标记：巡检会捡起来升 P0
        os.makedirs(BACKUP_ROOT, exist_ok=True)
        if failures:
            with open(FAIL_MARK, "a", encoding="utf-8") as f:
                for x in failures:
                    f.write(f"{time.strftime('%F %T')} {x}\n")
            log(f"⚠️ {len(failures)} 项失败，已落标记 {FAIL_MARK}")
        elif os.path.exists(FAIL_MARK):
            os.remove(FAIL_MARK)           # 恢复正常就清掉，否则标记会永久挂着

        task.event("snapshot_summary", "P3",
                   {"targets": len(cfg.get("targets", [])),
                    "failures": failures, "hour": hour})

    return 1 if failures else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"[db-snapshot] 致命错误: {e}", file=sys.stderr)
        sys.exit(1)
