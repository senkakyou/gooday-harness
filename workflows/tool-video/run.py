#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tool-video —— 给工具出讲解片的产线。

一轮做一件事：**挑一个还没有讲解、但有人用的工具，出一条 60 秒左右的讲解片，
上架，回查，然后把稿子和链接私信给站长。**

    python3 run.py                    # 按规则挑 1 个（cron 走这条）
    python3 run.py --slug pdf-converter
    python3 run.py --limit 3
    python3 run.py --no-publish       # 只出片不上架，产物留在 MEDIA_DIR
    python3 run.py --self-test        # 不调模型，用样例稿渲一条，验证这条线还活着

设计上的三个"宁可不做"：

1. **宁可不出片，也不出一条吹牛的**——稿子过不了事实闸就整篇拒收（见 writer.py）。
2. **宁可撤回，也不留半挂状态**——上架后回查线上不过就撤文件+撤字段（见 publish.py）。
3. **宁可停下，也不空转**——凭据/额度这类基础设施故障立刻停这一轮并告警，
   不退避重试（历史：43 段永久 0 字节被当成限流，空转一小时）。
"""
import argparse
import asyncio
import json
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = os.path.basename(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, "/opt/gooday-harness/packages")

import publish                                                    # noqa: E402
import render                                                     # noqa: E402
import writer                                                     # noqa: E402
from botkit import outbound                                       # noqa: E402
from botkit.auth import provider                                  # noqa: E402

# G01：状态在 /var/lib，产物在 /srv，日志在 /var/log，都不在仓库内
STATE_DIR = f"/var/lib/gooday-harness/state/{NAME}"
MEDIA_DIR = f"/srv/gooday-harness/media/{NAME}"
EVIDENCE_DIR = f"/var/lib/gooday-harness/evidence/{NAME}"
PROGRESS = os.path.join(STATE_DIR, "progress.json")

LINGXI_ID, ADMIN_ID = 20, 1
MAX_ATTEMPTS = 3          # 同一个工具连挂 3 次就拉黑，不无限重试
# 时长不设上限——口径是「讲清楚为止」（docs/specs/003）。
# 下限挡「没讲透」，上限只是跑飞保护：模型抽风写出半小时稿子时不至于直接上架。
MIN_SEC, MAX_SEC = 60, 20 * 60


def log(msg):
    print(f"[{NAME}] {time.strftime('%F %T')} {msg}", flush=True)


def load_progress():
    try:
        with open(PROGRESS) as f:
            return json.load(f)
    except Exception:
        return {"done": {}, "failed": {}}


def save_progress(p):
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = PROGRESS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(p, f, ensure_ascii=False, indent=1)
    os.replace(tmp, PROGRESS)      # 原子替换，防写一半被打断留下坏文件


def evidence(slug, payload):
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    p = os.path.join(EVIDENCE_DIR, f"{time.strftime('%Y%m%d-%H%M%S')}-{slug}.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    return p


def notify(text):
    """私信站长。发不出去不阻断产线，但要在日志里喊一声。"""
    try:
        outbound.configure({LINGXI_ID: [ADMIN_ID]})
        ok, err = outbound.send(LINGXI_ID, ADMIN_ID, text,
                                token_provider=provider(LINGXI_ID, "灵犀", "admin", publish.db_path()),
                                tag=NAME)
        if not ok:
            log(f"⚠️ 私信没发出去：{err}")
    except Exception as e:
        log(f"⚠️ 私信异常：{type(e).__name__}: {e}")


def pick(tools, limit, slug=None):
    """选题：已发布 + 还没有讲解 + 有人用过的，按下载量、浏览量排。

    【不碰已经有讲解的】——这既是幂等的来源，也保证人工换过的片子不会被自动覆盖。
    """
    if slug:
        hit = [t for t in tools if t["slug"] == slug]
        if not hit:
            raise SystemExit(f"❌ 没有 slug={slug} 这个工具")
        return hit
    cand = [t for t in tools
            if t.get("isPublished") and not (t.get("videoUrl") or "").strip()
            and ((t.get("downloadCount") or 0) + (t.get("viewCount") or 0)) > 0]
    cand.sort(key=lambda t: (-(t.get("downloadCount") or 0), -(t.get("viewCount") or 0)))
    return cand[:limit]


def one(tool, *, do_publish, script=None):
    """出一条。返回结果 dict；失败抛异常（异常带 .infra 表示基础设施故障）。"""
    slug, name = tool["slug"], tool["name"]
    outdir = os.path.join(MEDIA_DIR, slug)
    os.makedirs(outdir, exist_ok=True)

    if script is None:
        log(f"写稿：{name}")
        script = writer.write(tool, publish.page_text(tool))
    log(f"渲染：{name}（{len(script['turns'])} 轮对话，"
        f"提问 {sum(1 for t in script['turns'] if t.get('speaker') == 'asker')} 轮）")
    mp4, dur = asyncio.run(render.build(script, outdir, slug))

    # 成片自检：时长在范围内、两条流都在。ffprobe 读不出就是坏片，别往上传
    if not MIN_SEC <= dur <= MAX_SEC:
        raise RuntimeError(f"成片 {dur:.0f}s 不在 {MIN_SEC}~{MAX_SEC}s"
                           f"（下限=没讲透，上限=跑飞保护），不上架")
    real = render.probe_duration(mp4)
    if abs(real - dur) > 2:
        raise RuntimeError(f"成片实际时长 {real:.1f}s 与预期 {dur:.1f}s 差太多")

    result = {"slug": slug, "name": name, "duration": round(real, 1),
              "size": os.path.getsize(mp4), "mp4": mp4, "script": script,
              "published": False, "at": time.strftime("%F %T")}

    if do_publish:
        log(f"上架：{name}")
        old = (tool.get("videoUrl") or "").strip()
        up = publish.publish(tool, mp4, real)
        result["published"] = True
        result["videoPath"] = up["path"]
        # 重做时把上一版删掉。【必须在新片验过之后】——先删后传，
        # 中间任何一步失败工具就变成"有讲解按钮但点开是空的"
        if old.startswith("/uploads/") and old != up["url"]:
            publish.delete_upload(old[len("/uploads/"):])
            log(f"已删除上一版：{old}")
    result["evidence"] = evidence(slug, result)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug")
    ap.add_argument("--limit", type=int, default=1)
    ap.add_argument("--no-publish", action="store_true")
    ap.add_argument("--self-test", action="store_true",
                    help="不调模型，用样例稿渲一条，只验证渲染链路")
    args = ap.parse_args()

    os.makedirs(MEDIA_DIR, exist_ok=True)

    if args.self_test:
        import samples
        t0 = time.time()
        mp4, dur = asyncio.run(render.build(samples.SELF_TEST, os.path.join(MEDIA_DIR, "_selftest"),
                                            "selftest"))
        real = render.probe_duration(mp4)
        log(f"✅ 自检通过：{mp4} {real:.1f}s，耗时 {time.time() - t0:.0f}s")
        return 0

    progress = load_progress()
    tools = publish.list_tools()
    targets = pick(tools, args.limit, args.slug)
    if not targets:
        log("没有待处理的工具（都已经有讲解了）——这是正常状态，不是失败")
        return 0

    done_n = 0
    for tool in targets:
        slug = tool["slug"]
        if progress["failed"].get(slug, 0) >= MAX_ATTEMPTS and not args.slug:
            log(f"跳过 {slug}：已连续失败 {MAX_ATTEMPTS} 次（要重试请显式 --slug）")
            continue
        try:
            r = one(tool, do_publish=not args.no_publish)
            progress["done"][slug] = {"at": r["at"], "duration": r["duration"],
                                      "published": r["published"]}
            progress["failed"].pop(slug, None)
            save_progress(progress)
            done_n += 1
            log(f"✅ {r['name']}：{r['duration']}s / {r['size'] // 1024}KB "
                f"/ {'已上架' if r['published'] else '未上架'}")
            says = "\n".join(("🙋 " if t.get("speaker") == "asker" else "👨‍🏫 ") + t["say"]
                             for t in r["script"]["turns"])
            notify(f"【讲解片】{r['name']} 出片了：{r['duration']} 秒"
                   f"{'，已上架' if r['published'] else '，还没上架'}。\n"
                   f"看片：{publish.SITE}（搜「{r['name']}」→ 视频讲解）\n\n旁白全文：\n{says}\n\n"
                   f"不合适回我一句，我撤下来重做。稿子存在 {r['evidence']}")
        except Exception as e:
            infra = getattr(e, "infra", False)
            progress["failed"][slug] = progress["failed"].get(slug, 0) + 1
            save_progress(progress)
            log(f"❌ {tool['name']}：{type(e).__name__}: {e}")
            log(traceback.format_exc()[-1500:])
            if infra:
                # 【基础设施故障立刻停这一轮】：凭据/额度/音色下线，
                # 继续跑下一个只会用同样的姿势再失败一次，还把错误刷成一片
                notify(f"⚠️ 讲解片产线停了：{e}\n这是基础设施问题（凭据/额度/外部服务），"
                       f"不是内容问题，重试没用，要人看一眼。")
                return 2
    return 0 if done_n or args.slug is None else 1


if __name__ == "__main__":
    sys.exit(main())
