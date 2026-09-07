# -*- coding: utf-8 -*-
"""G02 目录即契约：每个扩展点的成员必须有 README 且含可证伪的判据。

写不出判据的模块，说明你不知道它算不算成功——那它凭什么存在、凭什么继续占资源。
上一版有 32 个内容产线脚本混在一个目录里，没有一个说得清「跑成什么样算成功」，
于是停摆两个月都没人发现（scifi 那条线就是）。
"""
import re

RULE = "G02"
TITLE = "目录即契约"

SCAN_UNDER = ("services", "workflows", "packages",
              "evolution/evaluators", "evolution/experiments")
CRITERIA_HEAD = re.compile(r"^#{1,4}\s*(判据|验收|通过标准|成功标准)", re.M)

# 无法判定真假的措辞——出现即判不合格
VAGUE = ("更好用", "更方便", "更丰富", "提升体验", "优化体验",
         "跑通", "完善", "增强", "改善", "尽量", "更稳定")

# 模板残留哨兵：复制了 _template 却没填，是最容易发生的失败。
# 模板里的示例判据自带数字，不设哨兵的话照抄就能通过检查——
# 那 G02「必须有判据」就成了摆设。（2026-09-07 实测复制模板后 0 报错才发现）
TEMPLATE_MARKS = ("本文件是模板", "&lt;名字&gt;", "<名字>", "cp -r services/_template",
                  "cp -r pipelines/_template", "cp -r workflows/_template",
                  "cp -r packages/_template", "cp -r evolution/",
                  "一句话说明")


def check(ctx):
    seen = False
    for under in SCAN_UNDER:
        for name in ctx.subdirs(under):
            if name.startswith("_"):        # _core / _shared 是共用件，不是模块
                continue
            seen = True
            rel = f"{under}/{name}"
            readme = ctx.path(rel, "README.md")
            if not ctx.exists(rel, "README.md"):
                yield ("ERROR", f"{rel} 缺 README.md",
                       "每个模块必须说清它是什么、怎么跑、什么算成功")
                continue

            body = ctx.read(readme)

            left = [k for k in TEMPLATE_MARKS if k in body]
            if left:
                yield ("ERROR", f"{rel}/README.md 还是模板没填（残留：{left[0]}）",
                       "照模板复制出来之后要真写：它做什么、明确不做什么、"
                       "判据是什么。不填的话这个模块没人知道算不算成功")
                continue

            m = CRITERIA_HEAD.search(body)
            if not m:
                yield ("ERROR", f"{rel}/README.md 缺「判据」章节",
                       "加一节「## 判据」，写可证伪的验收标准")
                continue

            section = body[m.end():]
            nxt = re.search(r"^#{1,4}\s", section, re.M)
            section = section[:nxt.start()] if nxt else section
            bad = [v for v in VAGUE if v in section]
            if bad:
                yield ("WARN", f"{rel} 的判据含无法判定真假的措辞：{'、'.join(bad)}",
                       "换成能证伪的：90 天内被打开 ≥1 次 / 连续 7 天失败率 <5%")
            elif not re.search(r"\d", section):
                yield ("WARN", f"{rel} 的判据里没有任何数字",
                       "判据要能被机械判定，通常意味着有阈值和时间窗")

    if not seen:
        yield ("SKIP", "services/ workflows/ packages/ evolution/ 下暂无成员", "")
