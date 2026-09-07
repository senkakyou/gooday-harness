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
    if not ctx.git_available():
        # 【不许静默放行】：git 用不了 ≠ 没有问题。以 root 跑时的 dubious ownership
        # 会让本规则扫 0 个文件却显示通过——门禁在最该起作用的时刻（部署）失灵。
        yield ("ERROR", f"git 不可用，本规则无法检查：{ctx.git_error() or '未知原因'}",
               "若是 dubious ownership，跑 "
               "git config --global --add safe.directory <仓库路径> 后重试")
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
