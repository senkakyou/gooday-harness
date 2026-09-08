#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""《奇妙数学》产线：一条命令出一集（语音 → 时间轴 → 网页 → 逐帧录制 → 视频 → 上架）

用法：
  python3 scripts/math-build.py ep02              # 全流程
  python3 scripts/math-build.py ep02 --no-render  # 只出音频+网页（快速看版面）
  python3 scripts/math-build.py ep02 --publish    # 出片后挂到听书书 Id=18
  python3 scripts/math-build.py all --publish     # 全集连续出

产物：wwwroot/uploads/math-<ep>.html / .mp3 / .mp4
"""
import asyncio, json, os, re, subprocess, sys, time
import edge_tts

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from math_engine import SHELL
from math_episodes import EPISODES

SPEC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "math-specs")


def load_meta(ep):
    """优先读数据驱动的分镜 spec（math-next.py 产出），没有再回退手写分镜。"""
    f = f"{SPEC_DIR}/{ep}.json"
    if os.path.exists(f):
        sp = json.load(open(f, encoding="utf-8"))
        return {"num": sp["num"], "title": sp["title"], "sub": sp.get("sub", ""),
                "quiz": sp["quiz"], "script": [tuple(x) for x in sp["script"]],
                "scenes_js": ("const SPEC = " + json.dumps(
                    {"title": sp["title"], "sub": sp.get("sub", ""), "scenes": sp["scenes"]},
                    ensure_ascii=False) + ";\nconst DRAW = buildDraw(SPEC);")}
    if ep in EPISODES:
        return EPISODES[ep]
    raise SystemExit(f"没有 {ep} 的分镜：既无 {f}，math_episodes.py 里也没有")

UP = "/srv/gooday-harness/media/uploads"
WORK = "/tmp/claude-1001/-opt-gooday/math-build"
FPS = 25
BOOK_ID = 18

VOICE = {
    "N": ("zh-CN-XiaoxiaoNeural", "+0%"),   # 旁白
    "L": ("zh-CN-XiaoyiNeural",  "+3%"),    # 灵灵
    "D": ("zh-CN-YunxiaNeural",  "+3%"),    # 豆豆
}
GAP, SCENE_GAP = 0.42, 0.65


def sh(*a, **kw):
    return subprocess.run(a, capture_output=True, text=True, **kw)


def dur(path):
    return float(sh("ffprobe", "-v", "error", "-show_entries", "format=duration",
                    "-of", "csv=p=0", path).stdout.strip())


async def probe():
    """CLAUDE.md 规范：配音色前先探活，死音色不进候选"""
    ok = True
    for k, (v, _) in VOICE.items():
        f = f"{WORK}/_probe_{k}.mp3"
        try:
            await edge_tts.Communicate("探活", v).save(f)
            sz = os.path.getsize(f)
        except Exception:
            sz = 0
        print(f"    探活 {k} {v}: {sz}B {'OK' if sz else '！死音色'}")
        ok = ok and sz > 0
    return ok


async def synth(ep, script):
    d = f"{WORK}/{ep}/voice"
    os.makedirs(d, exist_ok=True)
    for i, (sc, sp, line) in enumerate(script):
        f = f"{d}/l{i:03d}.mp3"
        if os.path.exists(f) and os.path.getsize(f) > 2000:
            continue
        text = re.sub(r"⏸[\d.]+", "", line).strip()
        v, rate = VOICE[sp]
        for attempt in range(1, 6):
            try:
                await edge_tts.Communicate(text, v, rate=rate).save(f)
                if os.path.getsize(f) > 2000:
                    break
                raise RuntimeError("0 字节")
            except Exception as e:
                if attempt == 5:
                    print(f"    ！第{i}句失败: {e}"); sys.exit(2)
                await asyncio.sleep(3 * attempt)
        await asyncio.sleep(0.35)
    print(f"    {len(script)} 句语音就绪")


def silence(sec, path):
    sh("ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
       "-t", f"{sec:.3f}", "-c:a", "libmp3lame", "-b:a", "96k", path)
    return path


def timeline(ep, script):
    d, seq, lines, t, prev = f"{WORK}/{ep}/voice", [], [], 0.0, None
    for i, (sc, sp, line) in enumerate(script):
        m = re.search(r"⏸([\d.]+)", line)
        extra = float(m.group(1)) if m else 0.0
        if i > 0:
            gap = SCENE_GAP if sc != prev else GAP
            seq.append(silence(gap, f"{d}/sil{i:03d}.mp3")); t += gap
        f = f"{d}/l{i:03d}.mp3"; dd = dur(f)
        lines.append({"scene": sc, "sp": sp, "start": round(t, 3), "dur": round(dd, 3)})
        seq.append(f); t += dd
        if extra:
            seq.append(silence(extra, f"{d}/pause{i:03d}.mp3")); t += extra
        prev = sc
    seq.append(silence(1.2, f"{d}/_tail.mp3")); t += 1.2

    with open(f"{WORK}/{ep}/alist.txt", "w") as fh:
        for p in seq: fh.write(f"file '{p}'\n")
    mp3 = f"{UP}/math-{ep}.mp3"
    sh("ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
       "-i", f"{WORK}/{ep}/alist.txt", "-c:a", "libmp3lame", "-b:a", "112k",
       "-ar", "24000", "-ac", "1", mp3)
    total = dur(mp3)

    order = []
    for L in lines:
        if L["scene"] not in order: order.append(L["scene"])
    scenes = []
    for si, name in enumerate(order):
        mine = [L for L in lines if L["scene"] == name]
        scenes.append({"id": name,
                       "start": round(max(0, mine[0]["start"] - (0.35 if si else 0)), 3),
                       "end": round(mine[-1]["start"] + mine[-1]["dur"], 3)})
    for i in range(len(scenes) - 1):
        scenes[i]["end"] = scenes[i + 1]["start"]
    scenes[-1]["end"] = round(total, 3)
    return {"duration": round(total, 3), "scenes": scenes,
            "lines": [{"start": L["start"], "dur": L["dur"], "sp": L["sp"]} for L in lines]}, order


def write_html(ep, meta, tl, order):
    groups = "\n  ".join(f'<g id="sc-{k}" class="scene"></g>' for k in order)
    html = (SHELL
            .replace("__EP_TITLE__", meta["title"])
            .replace("__EP_SUB__", meta.get("sub", ""))
            .replace("__MP3__", f"/uploads/math-{ep}.mp3")
            .replace("__SCENE_GROUPS__", groups)
            .replace("__SCENE_IDS__", json.dumps(order, ensure_ascii=False))
            .replace("__TIMELINE__", json.dumps(tl, ensure_ascii=False))
            .replace("__QUIZ__", json.dumps(meta["quiz"], ensure_ascii=False))
            .replace("__SCENES__", meta["scenes_js"]))
    path = f"{UP}/math-{ep}.html"
    open(path, "w", encoding="utf-8").write(html)
    # 自查：独立 HTML 里不允许出现转义反引号（CLAUDE.md）
    bad = html.count("\\`")
    print(f"    网页 {path}（转义反引号 {bad} 处{'，！需修' if bad else ''}）")
    return path


def render(ep, path, tl):
    from playwright.sync_api import sync_playwright
    fd = f"{WORK}/{ep}/frames"
    os.makedirs(fd, exist_ok=True)
    for f in os.listdir(fd):
        os.remove(f"{fd}/{f}")
    n = int(tl["duration"] * FPS); t0 = time.time(); errs = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--disable-gpu", "--no-sandbox", "--force-color-profile=srgb"])
        pg = b.new_page(viewport={"width": 1280, "height": 720}, device_scale_factor=1)
        pg.on("pageerror", lambda e: errs.append(str(e)[:110]))
        pg.goto(f"file://{path}?record=1", wait_until="load")
        pg.wait_for_timeout(600)
        st = pg.locator("#stage")
        for i in range(n):
            pg.evaluate(f"window.seek({i / FPS})")
            st.screenshot(path=f"{fd}/f{i:05d}.jpg", type="jpeg", quality=90)
            if i % 800 == 0:
                print(f"      {i}/{n} 帧 ({(time.time()-t0)/60:.1f}min)", flush=True)
        b.close()
    if errs:
        print("    ！页面报错:", errs[:3])
    print(f"    {n} 帧 / {(time.time()-t0)/60:.1f} 分钟")
    return fd, errs


def encode(ep, fd):
    mp4 = f"{UP}/math-{ep}.mp4"
    sh("ffmpeg", "-y", "-v", "error", "-framerate", str(FPS), "-i", f"{fd}/f%05d.jpg",
       "-i", f"{UP}/math-{ep}.mp3", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
       "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
       "-shortest", mp4)
    for f in os.listdir(fd):
        os.remove(f"{fd}/{f}")            # 帧文件很占盘，立刻清
    print(f"    成片 {mp4}  {os.path.getsize(mp4)//1024}KB  {dur(mp4):.1f}s")
    return mp4


def admin_token():
    env = dict(l.split("=", 1) for l in open("/opt/gooday-harness/.env")
               if "=" in l and not l.startswith("#"))
    secret = env["JWT_SECRET"].strip()
    tver = sh("sudo", "sqlite3",
              "/var/lib/docker/volumes/gooday_gooday_data/_data/gooday.db",
              "SELECT TokenVersion FROM Users WHERE Id=1;").stdout.strip()
    import base64, hmac, hashlib
    b64 = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")
    h = b64(b'{"alg":"HS256","typ":"JWT"}')
    payload = json.dumps({
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier": "1",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name": "admin",
        "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "admin",
        "tver": tver, "exp": int(time.time()) + 900,
        "iss": "gooday.ltd", "aud": "gooday.ltd"}, separators=(",", ":"))
    p = b64(payload.encode())
    sig = b64(hmac.new(secret.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())
    return f"{h}.{p}.{sig}"


def publish(ep, meta, mp4):
    tk = admin_token()
    body = json.dumps({"title": meta["title"], "mediaType": "video",
                       "mediaUrl": f"/uploads/math-{ep}.mp4", "source": "upload",
                       "duration": int(dur(mp4)) + 1, "orderNo": meta["num"]},
                      ensure_ascii=False)
    r = sh("curl", "-sk", "-X", "POST", f"https://localhost/api/audiobooks/{BOOK_ID}/chapters",
           "-H", "Host: gooday.ltd", "-H", f"Authorization: Bearer {tk}",
           "-H", "Content-Type: application/json; charset=utf-8",
           "-w", "\n<<%{http_code}>>", "--data-binary", body)
    out = r.stdout
    print(f"    上架 {out.rsplit('<<', 1)[-1].strip('>>')} {out.rsplit('<<',1)[0].strip()[:80]}")


def build(ep, do_render=True, do_publish=False):
    meta = load_meta(ep)
    print(f"\n=== {ep} {meta['title']} ===")
    os.makedirs(f"{WORK}/{ep}", exist_ok=True)
    asyncio.run(synth(ep, meta["script"]))
    tl, order = timeline(ep, meta["script"])
    print(f"    音轨 {tl['duration']:.1f}s / {len(order)} 场景")
    path = write_html(ep, meta, tl, order)
    if not do_render:
        return
    fd, errs = render(ep, path, tl)
    mp4 = encode(ep, fd)
    if do_publish:
        publish(ep, meta, mp4)


if __name__ == "__main__":
    os.makedirs(WORK, exist_ok=True)
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(1)
    target = args[0]
    do_render = "--no-render" not in args
    do_publish = "--publish" in args
    if not asyncio.run(probe()):
        print("！有死音色，按规范中止"); sys.exit(2)
    eps = list(EPISODES) if target == "all" else [target]
    t0 = time.time()
    for ep in eps:
        build(ep, do_render, do_publish)
    print(f"\n全部完成，用时 {(time.time()-t0)/60:.1f} 分钟")
