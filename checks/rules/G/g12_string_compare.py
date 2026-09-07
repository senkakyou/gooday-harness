# -*- coding: utf-8 -*-
"""G12 字符串/金额比较陷阱。

两个都真炸过：
1) C# 里字符串不能用 >= / <=，编译报 CS0019。EF Core 查询里比日期字符串，
   要先 .ToList() 拉到内存再 string.Compare(a,b) >= 0，或把字段改成 DateOnly。
2) SQLite 的 TEXT 列比金额要 CAST(x AS REAL)，直接比是【字典序】——"9" > "10"。
   闸门用了 CAST 而巡检没用，导致 ¥0 假账单闸门拦得住、巡检不告警，两边打架。
"""
import re

RULE = "G12"
TITLE = "字符串/金额比较"

# C#：形如  someDate >= "2026-01-01"  或  "..." <= x
CS_STR_CMP = re.compile(r'(?:"[^"\n]*"\s*(?:>=|<=)|(?:>=|<=)\s*"[^"\n]*")')
# SQL：Amount / Price 等金额列直接比较，且没套 CAST
SQL_AMOUNT = re.compile(r"\b(Amount|Price|EstimatedPrice|Total)\s*(?:>|<|>=|<=)\s*['\"]?\d",
                        re.I)


def check(ctx):
    for f in ctx.walk(".cs", under="services/api"):
        for i, line in enumerate(ctx.read(f).splitlines(), 1):
            if line.lstrip().startswith("//"):
                continue
            if CS_STR_CMP.search(line):
                yield ("ERROR", f"{ctx.rel(f)}:{i} C# 字符串用了 >= / <=",
                       "编译报 CS0019。先 .ToList() 再 string.Compare(a,b)>=0，或改 DateOnly")

    for f in ctx.walk(".cs", ".py", ".sh", under=None):
        rel = ctx.rel(f)
        if rel.startswith(("checks/", "norms/", "docs/")):
            continue
        for i, line in enumerate(ctx.read(f).splitlines(), 1):
            m = SQL_AMOUNT.search(line)
            if m and "CAST" not in line.upper():
                yield ("ERROR", f"{rel}:{i} 金额列 {m.group(1)} 直接比较，未用 CAST",
                       "SQLite TEXT 列是字典序，\"9\" > \"10\"。用 CAST(x AS REAL)")
