# -*- coding: utf-8 -*-
"""G01 五类分离：状态和产物不得进版本库。

上一版就是栽在这条上——心跳文件、*-state.json、22 个日志、1.2G 媒体、
580M 数据库快照全在版本库和代码目录里，.git 涨到 491M，清理时根本分不清
哪些能删。分不清的根因是它们本来就不该在一起。

注意：大文件本身交给 pre-commit 的 check-added-large-files 管（见 policies
「什么该外包」）。这条只管【类别错位】——某类东西出现在不该出现的位置。
"""
import re

RULE = "G01"
TITLE = "五类分离"

# 类别 -> (匹配规则, 该去哪)
MISPLACED = [
    ("日志", re.compile(r"\.log$|\.log\.\d+$"), "/var/log/gooday-harness/"),
    ("运行期状态", re.compile(r"(^|/)\.?[\w-]*(heartbeat|-state\.json|-pending\.json|\.pid)$"),
     "/var/lib/gooday-harness/state/"),
    ("数据库", re.compile(r"\.(db|db-wal|db-shm|sqlite3?)$"), "/srv/gooday-harness/backups/ 或运行期卷"),
    ("媒体产物", re.compile(r"\.(mp3|mp4|wav|m4a|apk|zip|epub|iso)$"), "/srv/gooday-harness/media/"),
    ("手工备份", re.compile(r"\.bak(\.\d+)?$|~$|\.tmp$"), "版本库本身就是干这个的（见 G03）"),
]

# 明确允许的例外：写在这里必须附理由，别默默加
ALLOW = (
    "ops/docker/",          # Dockerfile 旁的小样本
)


def check(ctx):
    go, level, why = ctx.git_verdict()
    if not go:
        # 四态裁决：no_repo→SKIP（本来就没版本库），
        # no_git/failed→ERROR（检查本该跑却没跑成，绝不能当成没问题）
        yield (level, why, "")
        return
    tracked = ctx.tracked()
    if not tracked:
        yield ("WARN", "git 可用但无跟踪文件（新仓库？）", "确认这是预期状态")
        return

    hits = {}
    for f in tracked:
        if any(f.startswith(a) for a in ALLOW):
            continue
        for kind, pat, target in MISPLACED:
            if pat.search(f):
                hits.setdefault((kind, target), []).append(f)
                break

    for (kind, target), files in sorted(hits.items()):
        sample = "；".join(files[:3])
        more = f"（共 {len(files)} 个）" if len(files) > 3 else ""
        yield ("ERROR", f"{kind}进了版本库{more}：{sample}",
               f"移到 {target}，并加进 .gitignore")

    # 反向检查：仓库外的四个位置是否被误建在仓库内
    for d in ("state", "logs", "media", "backups", "var", "tmp"):
        if ctx.exists(d):
            yield ("ERROR", f"仓库内出现 {d}/ 目录",
                   "状态/日志/产物/备份一律在仓库外，见 policies G01 的位置表")

    # ── 工作区扫描：.gitignore 挡住的产物，本条一样要抓 ──────────────────
    #
    # 【只查已跟踪文件是不够的】。本规则的原话是「状态和产物**不得出现在仓库内**」，
    # 不是「不进 git 就行」。而 .gitignore 里恰好挡着 *.log / *.mp3 / *.db ——
    # 于是产线把日志和 spec 写进仓库目录时，G01 一个字都不说。
    #
    # 2026-09-08 真撞到：math-episodes 的 SPEC_DIR 连着赋值两次，
    # 第一行写对了 state 目录、第二行又覆盖回 `HERE/data/math-specs`，
    # 正确的那行成了死代码。加上 `LOG = HERE/math-next.log`，
    # 跑一集就往版本库目录里落一份 spec 和一份日志 —— **全程零告警**，
    # 直到我手滑把那个 spec 一起提交了才暴露。
    #
    # 「东西存在但检查器看不见」正是本项目要消灭的形状，G01 自己更不能犯。
    import os
    tracked_set = set(tracked)
    for dirpath, dirnames, filenames in os.walk(ctx.path(".")):
        dirnames[:] = [d for d in dirnames
                       if d not in (".git", "node_modules", "__pycache__",
                                    "obj", "bin", "dist", "build", ".venv")]
        for fn in filenames:
            rel = os.path.relpath(os.path.join(dirpath, fn), ctx.path("."))
            if rel in tracked_set:
                continue                      # 已跟踪的上面那轮查过了
            if any(rel.startswith(a) for a in ALLOW):
                continue
            for kind, pat, target in MISPLACED:
                if pat.search(rel):
                    yield ("ERROR",
                           f"{kind}出现在仓库目录内（未跟踪，被 .gitignore 挡着）：{rel}",
                           f"移到 {target}。**「没进 git」不等于「不在仓库里」**——"
                           "产线把它写在这儿，说明路径配错了，改代码里的路径")
                    break
