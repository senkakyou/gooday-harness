#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""工具讲解动画引擎：场景脚本 → 配音 → 逐帧渲染 → mp4。

三个设计取舍，写在这里省得下次重新想：

1. **先配音、再定时长**。旁白多长，这一幕就多长（再加一点尾巴）。
   反过来做——先定 12 秒再让配音塞进去——话就会被切断，
   或者画面停在那里干等三秒。

2. **动画由 seek(t) 纯函数驱动，不用 CSS 动画**。截图是一帧一帧来的，
   CSS 动画按墙上时钟走，截图快慢会让画面抖；seek(t) 给同一个 t
   永远画出同一帧，慢也只是慢，不会花。

3. **中文字体在浏览器里排版**，不交给 ffmpeg 的 drawtext——
   后者默认字体没有中文字形，出来是一片方块（本次实测踩过）。
"""
import asyncio
import json
import os
import subprocess

import edge_tts
from playwright.async_api import async_playwright

W, H, FPS = 1280, 720, 20
VOICE = "zh-CN-YunxiNeural"
TAIL = 0.9          # 每幕旁白说完后留的余韵，避免画面切得太急


def _dur(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip()
    return float(out)


async def tts(text, path, voice=VOICE, rate="+6%"):
    await edge_tts.Communicate(text, voice, rate=rate).save(path)
    return _dur(path)


PAGE = """<!DOCTYPE html><html><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:%(W)dpx; height:%(H)dpx; overflow:hidden;
  background:#0a0e17; color:#e8ecf4;
  font-family:"WenQuanYi Zen Hei","Noto Sans CJK SC",sans-serif; }
#stage { position:relative; width:100%%; height:100%%; }
.bg { position:absolute; inset:0;
  background:
    radial-gradient(900px 520px at 18%% 12%%, rgba(124,108,255,.20), transparent 60%%),
    radial-gradient(760px 480px at 84%% 82%%, rgba(0,212,170,.14), transparent 60%%),
    #0a0e17; }
.grid { position:absolute; inset:0; opacity:.16;
  background-image:linear-gradient(rgba(124,108,255,.30) 1px, transparent 1px),
                   linear-gradient(90deg, rgba(124,108,255,.30) 1px, transparent 1px);
  background-size:64px 64px; }
/* 【竖直居中】：靠 padding 顶上去的话，内容全挤在上半屏，下面空一大条，
   在手机上看尤其像没做完。flex 居中让每一幕自己撑开中间。 */
.scene { position:absolute; inset:0; display:none; padding:56px 78px 72px;
  flex-direction:column; justify-content:center; }
.scene.on { display:flex; }
.el { position:relative; opacity:0; }
.brand { position:absolute; right:38px; bottom:26px; font-size:19px; letter-spacing:.5px;
  color:#5b6478; font-family:monospace; }
.kicker { font-size:22px; letter-spacing:6px; color:#00d4aa; font-weight:700; margin-bottom:18px; }
h1 { font-size:78px; line-height:1.12; font-weight:900; letter-spacing:1px; }
h2 { font-size:52px; line-height:1.2; font-weight:900; margin-bottom:30px; }
.sub { font-size:30px; color:#9aa4bb; margin-top:22px; line-height:1.5; }
.hero-ico { font-size:132px; line-height:1; }
.li { display:flex; align-items:flex-start; gap:18px; font-size:33px; line-height:1.45;
  margin-bottom:26px; color:#dfe5f1; }
.li .dot { flex:none; width:14px; height:14px; border-radius:50%%; margin-top:14px;
  background:#7c6cff; box-shadow:0 0 16px rgba(124,108,255,.9); }
.li.teal .dot { background:#00d4aa; box-shadow:0 0 16px rgba(0,212,170,.9); }
.li.pink .dot { background:#f472b6; box-shadow:0 0 16px rgba(244,114,182,.9); }
.card { background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.12);
  border-radius:20px; padding:26px 28px; }
.cards { display:flex; gap:22px; }
.cards .card { flex:1; }
.card .ico { font-size:52px; margin-bottom:14px; }
.card .t { font-size:29px; font-weight:800; margin-bottom:8px; }
.card .d { font-size:22px; color:#9aa4bb; line-height:1.45; }
.steps { display:flex; align-items:center; gap:0; margin-top:14px; }
.step { flex:1; text-align:center; }
.step .n { width:64px; height:64px; margin:0 auto 12px; border-radius:50%%;
  border:2px solid rgba(124,108,255,.55); color:#7c6cff; font-size:27px; font-weight:800;
  display:flex; align-items:center; justify-content:center; background:rgba(124,108,255,.10); }
.step.hot .n { border-color:#00d4aa; color:#04121a; background:#00d4aa;
  box-shadow:0 0 30px rgba(0,212,170,.7); }
.step .l { font-size:22px; color:#b9c2d6; line-height:1.35; }
.bar { height:12px; border-radius:99px; background:rgba(255,255,255,.10); overflow:hidden; }
.bar > i { display:block; height:100%%; width:0; border-radius:99px;
  background:linear-gradient(90deg,#7c6cff,#00d4aa); }
.tag { display:inline-block; font-size:24px; padding:9px 20px; border-radius:99px;
  border:1px solid rgba(0,212,170,.45); color:#00d4aa; background:rgba(0,212,170,.10);
  margin:0 12px 14px 0; font-family:monospace; }
.tag.p { border-color:rgba(124,108,255,.5); color:#a99cff; background:rgba(124,108,255,.10); }
.tag.k { border-color:rgba(244,114,182,.5); color:#f472b6; background:rgba(244,114,182,.10); }
.sprite { position:absolute; }
.mock { border-radius:18px; border:1px solid rgba(255,255,255,.14);
  background:rgba(9,13,22,.92); overflow:hidden; }
.mock .tb { height:44px; background:rgba(255,255,255,.06); display:flex; align-items:center;
  gap:9px; padding:0 16px; }
.mock .tb i { width:12px; height:12px; border-radius:50%%; background:#3b4256; display:block; }
.mock .bd { padding:22px 24px; font-size:24px; color:#c6cee0; line-height:1.6; }
.mono { font-family:monospace; }
</style></head><body>
<div id="stage"><div class="bg"></div><div class="grid"></div>%(SCENES)s
<div class="brand">gooday.ltd</div></div>
<script>
const SC = %(TIMING)s;
const ease = p => p<0 ? 0 : p>1 ? 1 : 1-Math.pow(1-p,3);
function seek(t){
  let cur = SC.length-1;
  for (let i=0;i<SC.length;i++){ if (t >= SC[i].s && t < SC[i].e){ cur=i; break; } }
  document.querySelectorAll('.scene').forEach((el,i)=>el.classList.toggle('on', i===cur));
  const sc = SC[cur], local = t - sc.s, len = sc.e - sc.s;
  const root = document.querySelectorAll('.scene')[cur];
  // 整幕淡入淡出：切换处不硬跳
  root.style.opacity = String(Math.min(1, ease(local/0.45)) * Math.min(1, ease((len-local)/0.35)));
  root.querySelectorAll('.el').forEach(el=>{
    const d = parseFloat(el.dataset.in||'0'), dur = parseFloat(el.dataset.dur||'0.55');
    const p = ease((local-d)/dur);
    el.style.opacity = String(p);
    const dy = parseFloat(el.dataset.dy||'26');
    const dx = parseFloat(el.dataset.dx||'0');
    el.style.transform = `translate(${dx*(1-p)}px, ${dy*(1-p)}px)`;
  });
  root.querySelectorAll('[data-bar]').forEach(el=>{
    const d = parseFloat(el.dataset.in||'0'), dur = parseFloat(el.dataset.bar||'1.2');
    el.querySelector('i').style.width = (ease((local-d)/dur)*100)+'%%';
  });
  root.querySelectorAll('.step').forEach(el=>{
    el.classList.toggle('hot', local >= parseFloat(el.dataset.hot||'999'));
  });
  root.querySelectorAll('.sprite').forEach(el=>{
    const p = ease((local-parseFloat(el.dataset.in||'0'))/parseFloat(el.dataset.dur||'1'));
    const path = JSON.parse(el.dataset.path||'[0,0,0,0]');
    el.style.opacity = String(Math.min(1,p*3));
    el.style.left = (path[0]+(path[2]-path[0])*p)+'px';
    el.style.top  = (path[1]+(path[3]-path[1])*p)+'px';
    const sp = el.dataset.spin ? ` rotate(${(t*parseFloat(el.dataset.spin))%%360}deg)` : '';
    el.style.transform = `translate(-50%%,-50%%)${sp}`;
  });
}
window.seek = seek; seek(0);
</script></body></html>"""


async def build(video, outdir):
    """video = {name, slug, voice?, scenes:[{say, html}]}。返回成品 mp4 路径。"""
    os.makedirs(outdir, exist_ok=True)
    voice = video.get("voice", VOICE)

    # 1) 先配音，拿到每一幕的真实时长
    timing, t0 = [], 0.0
    audio_parts = []
    for i, sc in enumerate(video["scenes"]):
        mp3 = os.path.join(outdir, f"say{i}.mp3")
        d = await tts(sc["say"], mp3, voice)
        length = d + TAIL
        timing.append({"s": round(t0, 3), "e": round(t0 + length, 3)})
        audio_parts.append((mp3, d, length))
        t0 += length
    total = t0

    # 2) 页面：所有幕塞进一页，靠 seek(t) 决定画哪一帧
    scenes_html = "".join(f'<div class="scene">{sc["html"]}</div>' for sc in video["scenes"])
    page = PAGE % {"W": W, "H": H, "SCENES": scenes_html, "TIMING": json.dumps(timing)}
    html_path = os.path.join(outdir, "page.html")
    open(html_path, "w", encoding="utf-8").write(page)

    # 3) 逐帧截图
    frames_dir = os.path.join(outdir, "frames")
    os.makedirs(frames_dir, exist_ok=True)
    for f in os.listdir(frames_dir):
        os.remove(os.path.join(frames_dir, f))
    n = int(total * FPS)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox", "--force-device-scale-factor=1"])
        pg = await b.new_page(viewport={"width": W, "height": H})
        await pg.goto("file://" + html_path)
        await pg.wait_for_timeout(400)
        for i in range(n):
            await pg.evaluate("t => window.seek(t)", i / FPS)
            await pg.screenshot(path=os.path.join(frames_dir, f"f{i:05d}.png"))
        await b.close()

    # 4) 音轨：每幕旁白 + 尾部静音，拼成整条
    concat = os.path.join(outdir, "audio.txt")
    with open(concat, "w") as fh:
        for mp3, d, length in audio_parts:
            sil = os.path.join(outdir, f"sil{round(length-d,2)}.wav")
            if not os.path.exists(sil):
                subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i",
                                f"anullsrc=r=24000:cl=mono", "-t", f"{length-d:.3f}", sil],
                               capture_output=True, check=True)
            fh.write(f"file '{os.path.abspath(mp3)}'\nfile '{os.path.abspath(sil)}'\n")
    audio = os.path.join(outdir, "voice.m4a")
    subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat,
                    "-ar", "44100", "-b:a", "128k", audio], capture_output=True, check=True)

    # 5) 合成
    out = os.path.join(outdir, f"{video['slug']}.mp4")
    subprocess.run(["ffmpeg", "-y", "-framerate", str(FPS), "-i",
                    os.path.join(frames_dir, "f%05d.png"), "-i", audio,
                    "-c:v", "libx264", "-preset", "medium", "-crf", "22",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
                    "-movflags", "+faststart", out], capture_output=True, check=True)
    return out, total
