#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""开单闸门的回归测试。不碰库、不调模型、不发消息。

    python3 services/bot-ruyi/test_intake.py

═══ 这个文件的第一版有两条【假通过】═══════════════════════════════════

  「交付形式不在白名单 → 拦下」和「违规词 → 拦下」两条，
  用例里的 need 只写了二十几个字，于是【在跑到被测判据之前就因为「太短」被拦了】。
  测试是绿的，而它想验的两条规则一次都没执行过。

  所以下面每条用例都：
    · need 一律 ≥ 30 字，跨过长度闸；
    · 断言【拦下的原因】而不只是「拦下了」。
  只断言"拦下了"的测试，会在判据串味的时候继续绿着。
═══════════════════════════════════════════════════════════════════
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import intake                                            # noqa: E402

ok_all = True


def show(label, cond, extra=""):
    global ok_all
    ok_all &= bool(cond)
    print(f"  {'✅' if cond else '❌'} {label}" + (f"  —— {extra}" if extra else ""))


def expect_pass(label, d):
    try:
        intake.validate(dict(d))
        show(label, True)
    except intake.Rejected as e:
        show(label, False, f"不该拦却拦了：{e}")


def expect_reject(label, d, because):
    """`because` 必须出现在拒绝原因里——【断言原因，不只断言拦下了】。"""
    try:
        intake.validate(dict(d))
        show(label, False, "该拦却放行了")
    except intake.Rejected as e:
        why = str(e)
        show(label, because in why, f"因「{why}」" + ("" if because in why else f"，但期望是「{because}」"))


GOOD = {
    "title": "C# 源码行数统计命令行工具",
    "client": "何萍",
    "contact": "wechat hp_1234",
    "need": ("扫描指定目录下所有 .cs 文件，输出总行数与按文件降序排行，"
             "支持导出 CSV，做成 Windows 上能直接跑的命令行工具，"
             "要能排除 bin 和 obj 目录。"),
}


def main():
    print("=== 填齐且合规 ===")
    expect_pass("六项齐全 + 形式在白名单 → 放行", GOOD)

    print("=== 缺字段 ===")
    for k in ("title", "client", "contact", "need"):
        expect_reject(f"缺 {k} → 拦下", {x: v for x, v in GOOD.items() if x != k}, f"缺字段 {k}")

    print("=== 长度闸 ===")
    expect_reject("需求太短 → 拦下", {**GOOD, "need": "做个工具帮我统计一下"}, "不够 30")

    print("=== 交付形式白名单（用例必须够长，否则会被长度闸抢先拦下）===")
    long_offline = ("希望有人每周上门一次，帮我把办公室的打印机和复印机做保养维护，"
                    "顺便清理一下机房的灰尘，按次结算，长期合作。")
    assert len(long_offline) >= intake.MIN_NEED, "用例本身就没跨过长度闸，测的不是白名单"
    expect_reject("上门服务 → 拦下", {**GOOD, "title": "上门维修保养", "need": long_offline},
                  "交付形式不在白名单")

    print("=== 违规词（用例同样必须够长）===")
    long_crawl = ("做一个程序，自动爬取竞品网站上全部商品的价格和库存数据，"
                  "每天定时抓一次，导出成表格文件方便我们比价，做成网页也行。")
    assert len(long_crawl) >= intake.MIN_NEED, "用例本身就没跨过长度闸，测的不是违规词"
    expect_reject("爬取他人数据 → 拦下", {**GOOD, "need": long_crawl}, "违规词")

    print("=== 如意不谈钱（提示词是软的，这里做硬校验）===")
    expect_reject("需求里带预算 → 拦下", {**GOOD, "need": GOOD["need"] + "预算 800 元以内。"},
                  "不该谈钱")
    expect_reject("需求里带工期 → 拦下", {**GOOD, "need": GOOD["need"] + "工期最好一周内。"},
                  "不该谈钱")

    print("=== 解析：字段白名单 ===")
    got = intake.parse_block(
        "好的记下了\n\n```order\ntitle: X\nclient: Y\ncontact: Z\n"
        "need: N\nevil: rm -rf /\nstatus: CLOSED\n```")
    show("多余字段被丢弃（evil / status 不进结果）",
         got == {"title": "X", "client": "Y", "contact": "Z", "need": "N"}, str(got))
    show("没有 order 块时返回 None（绝大多数轮次都走这条）",
         intake.parse_block("就是普通聊天，没有块") is None)
    show("中文冒号也认", (intake.parse_block("```order\ntitle：中文冒号\n```") or {})
         .get("title") == "中文冒号")

    print("\n" + ("判定: ✅ 全部通过" if ok_all else "判定: ❌ 有未通过"))
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
