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
# SQL：金额列直接比较且没套 CAST。
#
# ⚠️ 必须先确认这一行【真的是 SQL】，不能只看变量名。
# 2026-09-07 实测：只匹配变量名的版本在真实 C# 代码上报了约 40 处误报——
#   total >= 80        评分卡分数（int）
#   req.Price < 0      decimal 参数校验
#   dto.Payment.Amount > 0   decimal 判空
# 全是完全正确的数值比较。**在正确代码上报警的规则第一天就会被关掉**，
# 那比不检查更糟（今晚第四次栽在同一类错误上：只看形状不看上下文）。
SQL_CTX = re.compile(r"\b(SELECT|WHERE|FROM|UPDATE|DELETE|HAVING)\b", re.I)
SQL_AMOUNT = re.compile(r"\b(Amount|Price|EstimatedPrice|Total)\s*(?:>=|<=|>|<)\s*['\"]?\d",
                        re.I)


def check(ctx):
    # 第一段：C# 字符串比较，只在后端目录里查。
    # 目标不存在时必须【明说】——扫 0 个文件却静默通过，等于门禁在这一项上不存在。
    # 注意守卫只能罩住这一段：第二段是全仓扫描，不依赖 services/api 是否存在。
    if not ctx.exists("services/api"):
        yield ("SKIP", "services/api/ 不存在，C# 字符串比较检查未生效",
               "迁入后端代码后此项才会真正检查")
    else:
        for f in ctx.walk(".cs", under="services/api"):
            for i, line in enumerate(ctx.read(f).splitlines(), 1):
                if line.lstrip().startswith("//"):
                    continue
                if CS_STR_CMP.search(line):
                    yield ("ERROR", f"{ctx.rel(f)}:{i} C# 字符串用了 >= / <=",
                           "编译报 CS0019。先 .ToList() 再 string.Compare(a,b)>=0，或改 DateOnly")

    # 第二段：SQL 金额比较，全仓扫描，与上面无关
    for f in ctx.walk(".cs", ".py", ".sh", under=None):
        rel = ctx.rel(f)
        if rel.startswith(("checks/", "policies/", "docs/")):
            continue
        for i, line in enumerate(ctx.read(f).splitlines(), 1):
            m = SQL_AMOUNT.search(line)
            # 门槛：这一行必须真的是 SQL（含 SELECT/WHERE/FROM…），
            # 否则就是普通的 C#/Python 数值比较，完全正确，不该报
            if m and SQL_CTX.search(line) and "CAST" not in line.upper():
                yield ("ERROR", f"{rel}:{i} 金额列 {m.group(1)} 直接比较，未用 CAST",
                       "SQLite TEXT 列是字典序，\"9\" > \"10\"。用 CAST(x AS REAL)")
