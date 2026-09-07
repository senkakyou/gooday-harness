# -*- coding: utf-8 -*-
"""G07 可追溯：自动改动必须留痕，且实验必须有 Decision。

自我迭代的前提不是"能改"，是"改了之后说得清为什么改、凭什么判断改对了、
以及怎么退回去"。没有这三样，第二层循环就退化成随机扰动。

今晚（2026-09-07）踩的每个坑都是"发生了但没留痕"：
  · 凭据 8/25 就失效，没有任何地方记下这件事，三周无人发现
  · drop-in 装上了但安装脚本没记，重装即静默丢失
  · 注入防御条款写进文档三个月，没进任何 bot 的 prompt，也没人能发现

所以本规则查的是【结构上有没有留痕的位置】，以及【实验有没有理由和退路】。
"""
import os
import re
import time

RULE = "G07"
TITLE = "自动改动可追溯"

# 运行期留痕目录（在仓库外，由 ops/install.sh 创建）
RUNTIME_DIRS = ("tasks", "events", "evidence", "evaluations", "checkpoints")

# 证据链多久没动就算断了。7 天：比任何一条产线的周期都长，
# 又短到能在下次月报前发现（凭据那次拖了三周）。
STALE_DAYS = 7


def _expand_braces(text):
    """把 bash 花括号展开成字面路径：/a/{x,y} → /a/x /a/y

    不做这一步的话，检查器会在【完全正确】的 install.sh 上报警——
    而在正确代码上报警的检查器会被人关掉，那比不检查更糟
    （今晚 C09 用 grep 抓 `except: pass` 已经栽过一次同样的坑）。
    """
    def one(m):
        prefix, items = m.group(1), m.group(2).split(",")
        return " ".join(prefix + i.strip() for i in items)
    return re.sub(r"(\S*?)\{([^{}]*,[^{}]*)\}", one, text or "")


def check(ctx):
    install = _expand_braces(ctx.read("ops/install.sh"))

    # 1) 安装脚本必须创建全部留痕目录，否则第一次跑就无处可写
    if install:
        missing = [d for d in RUNTIME_DIRS if f"/var/lib/gooday-harness/{d}" not in install]
        if missing:
            yield ("ERROR",
                   f"ops/install.sh 未创建留痕目录：{'、'.join(missing)}",
                   "第二层循环靠它们说话，没有目录就等于没有证据链")

    # 2) Decision 必须进版本库（它是「为什么这么改」的唯一载体）
    if not ctx.exists("docs/decisions"):
        yield ("ERROR", "docs/decisions/ 不存在",
               "改动理由必须进版本库，运行期数据可以丢，决策记录不能丢")

    # 3) 每个实验必须关联一个 Decision，且写明回滚点
    for name in ctx.subdirs("evolution/experiments"):
        if name.startswith("_"):
            continue
        rel = f"evolution/experiments/{name}"
        body = ctx.read(os.path.join(rel, "README.md"))
        if not body:
            continue
        m = re.search(r"(docs/decisions/\S+?\.md)", body)
        if not m:
            yield ("ERROR", f"{rel} 没有关联 Decision",
                   "没有 Decision 的实验，结果无从解释——先写清楚为什么要改")
        elif "NNN" in m.group(1) or not ctx.exists(*m.group(1).split("/")):
            # 只查「写没写路径」是不够的：照抄模板里的占位 NNN-xxx.md 也能过。
            # 门禁必须验那份 Decision 真的存在，否则这条规则只是在查排版。
            yield ("ERROR", f"{rel} 关联的 Decision 不存在：{m.group(1)}",
                   "占位符不算数。先在 docs/decisions/ 建出那份文档再跑实验")
        if not re.search(r"回滚|rollback|checkpoint", body, re.I):
            yield ("ERROR", f"{rel} 没写回滚点",
                   "实验必须能退回去。没演练过的回滚方案等于没有")

    # 4) 必须有写 Task/Event 的库——没有写入方，前面那些目录只是空壳
    if not ctx.exists("packages/trace", "trace.py"):
        yield ("ERROR", "packages/trace 不存在，没有任何东西会写 Task/Event",
               "G07 会退化成「检查有没有放证据的地方」而不是「有没有证据」")

    # 5) 运行期实证：证据链是不是真的在流动
    #
    # 【这条是本规则的灵魂】。前面几项查的都是结构；结构齐全但没人写时，
    # 系统看起来一切正常而实际什么都没记——凭据失效三周无人发现就是这个形状。
    # CI 里没有这些目录，SKIP 掉，由服务器上的巡检覆盖。
    #
    # ⚠️ 这里【不能 return】：第 6 项与运行期无关，
    # 守卫 return 会连带跳过它——本规则和 G12 都栽过这一下。
    state = os.environ.get("GOODAY_HARNESS_STATE", "/var/lib/gooday-harness")
    if not os.path.isdir(state):
        yield ("SKIP", f"运行期目录不存在（{state}），证据链实证未生效",
               "部署后由服务器上的巡检覆盖此项")
    else:
        yield from _check_runtime(state)

    # 6) 每个评价器必须说明 Evidence 来源
    for name in ctx.subdirs("evolution/evaluators"):
        if name.startswith("_"):
            continue
        rel = f"evolution/evaluators/{name}"
        body = ctx.read(os.path.join(rel, "README.md"))
        if body and not re.search(r"Evidence|证据", body, re.I):
            yield ("ERROR", f"{rel} 未说明 Evidence 来源",
                   "没有证据的评价是拍脑袋，用它驱动改进只会放大噪音")


def _check_runtime(state):
    """证据链是不是真的在流动。只在运行期目录存在时调用。"""
    mark = os.path.join(state, ".trace-failure")
    if os.path.exists(mark) and os.path.getsize(mark) > 0:
        yield ("ERROR", "存在 .trace-failure 标记：追踪写入链已断",
               f"看 {mark}。追踪断掉时系统看起来一切正常，是最危险的状态")

    now = time.time()
    for sub, what in (("tasks", "Task"), ("events", "Event")):
        d = os.path.join(state, sub)
        files = [os.path.join(d, f) for f in os.listdir(d)] if os.path.isdir(d) else []
        files = [f for f in files if os.path.isfile(f)]
        if not files:
            yield ("ERROR", f"{what} 目录是空的：{d}",
                   "目录建好了但没人往里写，证据链等于不存在。用 packages/trace")
            continue
        age_d = (now - max(os.path.getmtime(f) for f in files)) / 86400
        if age_d > STALE_DAYS:
            yield ("ERROR", f"{what} 已 {age_d:.1f} 天没有新记录（阈值 {STALE_DAYS} 天）",
                   "要么系统真的什么都没干，要么写入链断了——两种都要查")
