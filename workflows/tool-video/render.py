#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对话式讲解片：脚本数据 → mp4。配音、逐帧渲染、合成都在这里。

片子的形态是**一男一女两个人在讲课**：
  · 老师（男声，云健）——讲原理、讲取舍、讲坑；
  · 提问者（女声，晓晓）——替观众问那些"听着就想插一句"的问题。

所以每一"帧"要同时表达三件事：现在谁在说、说了什么（字幕）、
以及讲到哪块内容（右侧板块随讲解推进逐条点亮）。

**模型只产结构化数据，版式由这里的代码渲染。**
不让模型直接写 HTML：一是排版会一集一个样，二是等于把不可信文本插进页面。

三个取舍（换来的教训写在各自位置）：
1. 先配音、再定每一轮时长；
2. 动画由 seek(t) 纯函数驱动，不用 CSS 动画；
3. 中文在浏览器里排版，不交给 ffmpeg drawtext。
"""
import asyncio
import html
import json
import os
import subprocess

import edge_tts
from playwright.async_api import async_playwright

W, H, FPS = 1280, 720, 20
ANIM = 0.85         # 每一轮开头这么久是动画（字幕换人、板块淡入、要点上浮），之后画面静止

# 一男一女。老师用云健（沉稳，像真在讲课），提问者用晓晓（自然，像同事插话）。
# 备用音色是"该换"而不是"该等"的那条路——见 tts()
VOICES = {
    "teacher": ("zh-CN-YunjianNeural", "zh-CN-YunxiNeural"),
    "asker": ("zh-CN-XiaoxiaoNeural", "zh-CN-XiaoyiNeural"),
}
RATE = {"teacher": "+8%", "asker": "+10%"}
SPEAKER_META = {
    "teacher": {"icon": "👨‍🏫", "name": "讲解", "cls": "teacher"},
    "asker": {"icon": "🙋‍♀️", "name": "提问", "cls": "asker"},
}
GAP = 0.35          # 一句说完到下一句开口的间隔。太短像抢话，太长像卡住
TAIL = 0.8          # 全片最后一句之后的余韵
BGM_DB = -21        # 背景音乐音量。人声之下两个档次，垫底不抢戏
BGM_DUCK_DB = -9    # 有人说话时音乐再压这么多（sidechain 闪避）


class RenderError(RuntimeError):
    """渲染失败。infra=True 表示外部依赖坏了（该等/该换），不是内容问题。"""

    def __init__(self, msg, infra=False):
        super().__init__(msg)
        self.infra = infra


def probe_duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip()
    if not out:
        raise RenderError(f"ffprobe 读不出时长：{path}")
    return float(out)


async def tts(text, path, speaker):
    """配音。主音色失败就换备用音色再试一次。

    【必须区分"该等"和"该换"】：edge-tts 偶发网络失败该重试，
    而音色被平台下线是永久的——重试一万次也不会好，只会空转。
    """
    last = None
    for voice in VOICES.get(speaker, VOICES["teacher"]):
        try:
            await edge_tts.Communicate(text, voice, rate=RATE.get(speaker, "+6%")).save(path)
            if os.path.getsize(path) > 1024:
                return probe_duration(path), voice
            last = f"{voice} 产出 {os.path.getsize(path)} 字节（等于没出声）"
        except Exception as e:
            last = f"{voice}: {type(e).__name__}: {e}"
    raise RenderError(f"配音失败（主备两个音色都不行）：{last}", infra=True)


# ---------------- 板块版式：模型只能选类型 + 填字段 ----------------

def _esc(s):
    return html.escape(str(s or ""))


def _tone(t):
    return {"purple": "", "teal": "teal", "pink": "pink"}.get(t, "")


def _board_title(b):
    k = f'<div class="kicker">{_esc(b["kicker"])}</div>' if b.get("kicker") else ""
    return f'{k}<h2>{_esc(b.get("title", ""))}</h2>'


def _b_bullets(b):
    items = "".join(
        f'<div class="li {_tone(it.get("tone"))}" data-step="{i}">'
        f'<span class="dot"></span><span>{_esc(it["text"])}</span></div>'
        for i, it in enumerate(b.get("items", [])[:5]))
    return _board_title(b) + f'<div class="list">{items}</div>'


def _b_cards(b):
    cs = "".join(
        f'<div class="card" data-step="{i}"><div class="ico">{_esc(c.get("icon", "•"))}</div>'
        f'<div class="t">{_esc(c["title"])}</div><div class="d">{_esc(c.get("desc", ""))}</div></div>'
        for i, c in enumerate(b.get("cards", [])[:3]))
    return _board_title(b) + f'<div class="cards">{cs}</div>'


def _b_steps(b):
    st = "".join(
        f'<div class="step" data-step="{i}"><div class="n">{i + 1}</div>'
        f'<div class="l">{_esc(x.get("label", ""))}<br><span class="note">{_esc(x.get("note", ""))}</span></div></div>'
        for i, x in enumerate(b.get("steps", [])[:6]))
    return _board_title(b) + f'<div class="steps">{st}</div>'


def _b_compare(b):
    """对照板：讲"这个 vs 那个""该用/不该用"时用它——有深度的讲解绕不开取舍。"""
    def col(side, key):
        d = b.get(key) or {}
        rows = "".join(f'<div class="crow" data-step="{i}">{_esc(x)}</div>'
                       for i, x in enumerate((d.get("items") or [])[:4]))
        return (f'<div class="col {side}"><div class="ch">{_esc(d.get("title", ""))}</div>{rows}</div>')
    return _board_title(b) + f'<div class="cmp">{col("l", "left")}{col("r", "right")}</div>'


def _b_quote(b):
    """一句话结论板。讲到"记住这一条"的时候用。"""
    return (_board_title(b) +
            f'<div class="quote" data-step="0">{_esc(b.get("text", ""))}</div>')


def _b_cover(b):
    return (f'<div class="cover"><div class="cico">{_esc(b.get("icon", "🔧"))}</div>'
            f'<h1>{_esc(b.get("title", ""))}</h1>'
            f'<div class="csub">{_esc(b.get("subtitle", ""))}</div></div>')


BOARDS = {"cover": _b_cover, "bullets": _b_bullets, "cards": _b_cards,
          "steps": _b_steps, "compare": _b_compare, "quote": _b_quote}

PAGE = """<!DOCTYPE html><html><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:%(W)dpx; height:%(H)dpx; overflow:hidden; background:#0a0e17; color:#e8ecf4;
  font-family:"WenQuanYi Zen Hei","Noto Sans CJK SC",sans-serif; }
#stage { position:relative; width:100%%; height:100%%; }
.bg { position:absolute; inset:0;
  background:radial-gradient(900px 520px at 18%% 10%%, rgba(124,108,255,.20), transparent 60%%),
             radial-gradient(760px 480px at 86%% 78%%, rgba(0,212,170,.13), transparent 60%%), #0a0e17; }
.grid { position:absolute; inset:0; opacity:.14;
  background-image:linear-gradient(rgba(124,108,255,.30) 1px, transparent 1px),
                   linear-gradient(90deg, rgba(124,108,255,.30) 1px, transparent 1px);
  background-size:64px 64px; }

/* 上半：板块区。下半：说话人 + 字幕。两块分工固定，观众不用重新找视线落点 */
.board { position:absolute; left:0; right:0; top:0; height:452px; padding:44px 70px 0;
  display:none; flex-direction:column; justify-content:center; }
.board.on { display:flex; }
.kicker { font-size:20px; letter-spacing:6px; color:#00d4aa; font-weight:700; margin-bottom:14px; }
h1 { font-size:66px; line-height:1.12; font-weight:900; }
h2 { font-size:42px; line-height:1.2; font-weight:900; margin-bottom:24px; }
.cover { text-align:center; }
.cover .cico { font-size:104px; line-height:1; margin-bottom:10px; }
.csub { font-size:26px; color:#9aa4bb; margin-top:16px; }
.list .li { display:flex; align-items:flex-start; gap:15px; font-size:28px; line-height:1.4;
  margin-bottom:18px; color:#dfe5f1; opacity:0; transform:translateY(14px); }
.list .li .dot { flex:none; width:12px; height:12px; border-radius:50%%; margin-top:12px;
  background:#7c6cff; box-shadow:0 0 14px rgba(124,108,255,.9); }
.list .li.teal .dot { background:#00d4aa; box-shadow:0 0 14px rgba(0,212,170,.9); }
.list .li.pink .dot { background:#f472b6; box-shadow:0 0 14px rgba(244,114,182,.9); }
.cards { display:flex; gap:20px; }
.cards .card { flex:1; background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.12);
  border-radius:18px; padding:22px 24px; opacity:0; transform:translateY(14px); }
.cards .ico { font-size:44px; margin-bottom:10px; }
.cards .t { font-size:25px; font-weight:800; margin-bottom:6px; }
.cards .d { font-size:19px; color:#9aa4bb; line-height:1.45; }
.steps { display:flex; align-items:flex-start; }
.steps .step { flex:1; text-align:center; opacity:0; transform:translateY(14px); }
.steps .n { width:56px; height:56px; margin:0 auto 10px; border-radius:50%%;
  border:2px solid rgba(0,212,170,.6); color:#04121a; background:#00d4aa; font-size:24px;
  font-weight:800; display:flex; align-items:center; justify-content:center;
  box-shadow:0 0 24px rgba(0,212,170,.5); }
.steps .l { font-size:19px; color:#c6cee0; line-height:1.35; }
.steps .note { color:#8b95ab; font-size:17px; }
.cmp { display:flex; gap:24px; }
.cmp .col { flex:1; border-radius:18px; padding:20px 24px; border:1px solid rgba(255,255,255,.12);
  background:rgba(255,255,255,.04); }
.cmp .col.l { border-color:rgba(244,114,182,.35); }
.cmp .col.r { border-color:rgba(0,212,170,.4); }
.cmp .ch { font-size:26px; font-weight:800; margin-bottom:14px; }
.cmp .col.l .ch { color:#f472b6; } .cmp .col.r .ch { color:#00d4aa; }
.cmp .crow { font-size:22px; line-height:1.45; color:#cfd6e6; margin-bottom:10px;
  opacity:0; transform:translateY(10px); }
.quote { font-size:36px; line-height:1.5; font-weight:800; color:#e8ecf4;
  border-left:6px solid #00d4aa; padding:10px 0 10px 26px; opacity:0; transform:translateY(14px); }

/* 下半：说话人 + 字幕 */
.talk { position:absolute; left:0; right:0; bottom:0; height:268px; padding:22px 70px 30px;
  display:flex; align-items:flex-start; gap:24px;
  border-top:1px solid rgba(255,255,255,.08); background:rgba(6,9,16,.55); }
.who { flex:none; width:132px; text-align:center; transition:none; }
.who .av { width:96px; height:96px; margin:0 auto 8px; border-radius:50%%; font-size:52px;
  display:flex; align-items:center; justify-content:center;
  background:rgba(255,255,255,.05); border:2px solid rgba(255,255,255,.10); }
.who .nm { font-size:19px; color:#7b address; }
.who .nm { font-size:19px; color:#7b8499; font-family:monospace; letter-spacing:2px; }
.who.hot.teacher .av { border-color:#00d4aa; background:rgba(0,212,170,.14);
  box-shadow:0 0 30px rgba(0,212,170,.35); }
.who.hot.asker .av { border-color:#f472b6; background:rgba(244,114,182,.14);
  box-shadow:0 0 30px rgba(244,114,182,.35); }
.who.hot .nm { color:#e8ecf4; }
.sub { flex:1; font-size:31px; line-height:1.55; color:#e8ecf4; padding-top:6px; }
.sub.asker { color:#f9c8e3; }
.brand { position:absolute; right:26px; bottom:8px; font-size:16px; color:#4d5566;
  font-family:monospace; }
</style></head><body>
<div id="stage"><div class="bg"></div><div class="grid"></div>
%(BOARDS)s
<div class="talk">
  <div class="who teacher" id="w-teacher"><div class="av">👨‍🏫</div><div class="nm">讲解</div></div>
  <div class="sub" id="sub"></div>
  <div class="who asker" id="w-asker"><div class="av">🙋‍♀️</div><div class="nm">提问</div></div>
</div>
<div class="brand">gooday.ltd</div></div>
<script>
const T = %(TURNS)s;                 // [{s,e,board,step,speaker,say}]
const ease = p => p<0 ? 0 : p>1 ? 1 : 1-Math.pow(1-p,3);
const boards = [...document.querySelectorAll('.board')];
function seek(t){
  let i = 0;
  for (let k=0;k<T.length;k++){ if (t >= T[k].s){ i = k; } }
  const cur = T[i], local = t - cur.s;

  boards.forEach((b,bi)=>b.classList.toggle('on', bi===cur.board));
  const b = boards[cur.board];
  if (b){
    // 板块整体淡入（只在换板那一轮做），随后按 step 逐条点亮
    const first = T.findIndex(x=>x.board===cur.board);
    const bp = ease((t - T[first].s)/0.5);
    b.style.opacity = String(bp);
    b.querySelectorAll('[data-step]').forEach(el=>{
      const idx = parseInt(el.dataset.step,10);
      // 本轮该亮到第几条：亮过的保持，正在亮的做一次上浮
      // 该在哪一轮点亮这一条：找第一轮 step>=idx 的。
      // 【找不到就从这块板出场时起就显示】——quote / cover 这种整块就是一句话的板
      // 没有 reveal，之前那版会让它们永远 opacity:0，整块板白给（实测踩过）。
      const revealAt = T.filter(x=>x.board===cur.board && x.step>=idx)[0]
                    || T.filter(x=>x.board===cur.board)[0];
      const p = revealAt ? ease((t - revealAt.s)/0.55) : 0;
      el.style.opacity = String(p);
      el.style.transform = `translateY(${14*(1-p)}px)`;
    });
  }
  const isAsk = cur.speaker === 'asker';
  document.getElementById('w-teacher').classList.toggle('hot', !isAsk);
  document.getElementById('w-asker').classList.toggle('hot', isAsk);
  const sub = document.getElementById('sub');
  sub.className = 'sub' + (isAsk ? ' asker' : '');
  sub.textContent = (isAsk ? '' : '') + cur.say;
  sub.style.opacity = String(Math.min(1, ease(local/0.25)));
}
window.seek = seek; seek(0);
</script></body></html>"""


def make_bgm(path, seconds):
    """现场合成一段柔和的垫底音乐。

    【为什么是合成而不是找一首歌】：这片子挂在公开站点上，
    随手下载的音乐版权说不清；自己用正弦波堆出来的和弦垫，版权问题不存在。
    四个和弦（Am–F–C–G 的味道）各 6 秒循环，慢速颤音让它不至于死板。
    """
    chords = [(220.00, 261.63, 329.63),   # Am
              (174.61, 220.00, 261.63),   # F
              (261.63, 329.63, 392.00),   # C
              (196.00, 246.94, 293.66)]   # G
    per = 6
    parts, filters, idx = [], [], 0
    for ci, ch in enumerate(chords):
        for f in ch:
            parts += ["-f", "lavfi", "-t", str(per), "-i", f"sine=frequency={f}:sample_rate=44100"]
            filters.append(f"[{idx}:a]volume=0.30,afade=t=in:st=0:d=1.4,"
                           f"afade=t=out:st={per - 1.6}:d=1.6,adelay={ci * per * 1000}|{ci * per * 1000}[c{idx}]")
            idx += 1
    mix = "".join(f"[c{i}]" for i in range(idx))
    filters.append(f"{mix}amix=inputs={idx}:duration=longest:dropout_transition=0,"
                   f"tremolo=f=0.25:d=0.25,aecho=0.8:0.6:420:0.28,"
                   f"lowpass=f=2200,volume=1.6[loop]")
    loop = path + ".loop.wav"
    r = subprocess.run(["ffmpeg", "-y", *parts, "-filter_complex", ";".join(filters),
                        "-map", "[loop]", "-ar", "44100", "-ac", "2", loop],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RenderError(f"背景音乐合成失败：{(r.stderr or '')[-300:]}")
    # 循环到整片长度，首尾各留一段淡入淡出
    r = subprocess.run(["ffmpeg", "-y", "-stream_loop", "-1", "-i", loop, "-t", f"{seconds:.2f}",
                        "-af", f"afade=t=in:st=0:d=2.5,afade=t=out:st={max(0, seconds - 3):.2f}:d=3",
                        "-ar", "44100", "-ac", "2", path], capture_output=True, text=True)
    os.remove(loop)
    if r.returncode != 0:
        raise RenderError(f"背景音乐铺长失败：{(r.stderr or '')[-300:]}")
    return path


def board_html(b):
    fn = BOARDS.get(b.get("type"))
    if not fn:
        raise RenderError(f"不认识的板块版式：{b.get('type')}")
    return fn(b)


def _plan(script):
    """把 turns 编成时间轴用的结构：每轮属于哪块板、点亮到第几条。"""
    boards, plan = [], []
    cur_board, cur_step = -1, -1
    for t in script["turns"]:
        if t.get("board"):
            boards.append(t["board"])
            cur_board, cur_step = len(boards) - 1, -1
        if cur_board < 0:
            raise RenderError("第一轮必须带 board（否则没有任何板块可显示）")
        if t.get("reveal"):
            cur_step += 1
        plan.append({"board": cur_board, "step": cur_step,
                     "speaker": "asker" if t.get("speaker") == "asker" else "teacher",
                     "say": t["say"]})
    return boards, plan


async def build(script, outdir, slug):
    """script = {"turns":[{speaker, say, board?, reveal?}]}。返回 (mp4, 时长秒)。"""
    os.makedirs(outdir, exist_ok=True)
    frames_dir = os.path.join(outdir, "frames")
    os.makedirs(frames_dir, exist_ok=True)
    for f in os.listdir(frames_dir):
        os.remove(os.path.join(frames_dir, f))

    boards, plan = _plan(script)

    # 1) 先配音：谁说这句用谁的音色，说多久这一轮就多久
    t0, parts = 0.0, []
    for i, p in enumerate(plan):
        mp3 = os.path.join(outdir, f"say{i:02d}.mp3")
        d, _ = await tts(p["say"], mp3, p["speaker"])
        length = d + GAP
        p["s"], p["e"] = round(t0, 3), round(t0 + length, 3)
        parts.append((mp3, d, length))
        t0 += length
    total = t0 + TAIL

    page = PAGE % {"W": W, "H": H,
                   "BOARDS": "".join(f'<div class="board">{board_html(b)}</div>' for b in boards),
                   "TURNS": json.dumps(plan, ensure_ascii=False)}
    html_path = os.path.join(outdir, "page.html")
    open(html_path, "w", encoding="utf-8").write(page)

    # 2) 截图。【只截会动的那些帧】。
    # 画面只在每一轮开头的 ANIM 秒里动（字幕换人、板块淡入、要点上浮），
    # 之后到这一轮结束都是静止的。原来按 20fps 全片硬截，一条 5 分钟的片子
    # 要截 6000 张、跑半小时；现在每轮截 ANIM×FPS 张动画帧 + 1 张静止帧，
    # 静止帧靠 concat 的 duration 铺满剩下的时间——**成片一模一样，帧数少一个数量级**。
    shots = []          # [(png 路径, 该帧占多少秒)]
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox", "--force-device-scale-factor=1"])
        pg = await b.new_page(viewport={"width": W, "height": H})
        await pg.goto("file://" + html_path)
        await pg.wait_for_timeout(400)

        n = 0
        for k, turn in enumerate(plan):
            end = plan[k + 1]["s"] if k + 1 < len(plan) else total
            span = max(0.0, end - turn["s"])
            anim = min(ANIM, span)
            steps = max(1, int(anim * FPS))
            for j in range(steps):
                await pg.evaluate("t => window.seek(t)", turn["s"] + j / FPS)
                f = os.path.join(frames_dir, f"f{n:05d}.png")
                await pg.screenshot(path=f)
                shots.append((f, 1 / FPS))
                n += 1
            rest = span - steps / FPS
            if rest > 0.02:      # 这一轮剩下的时间用一张静止帧铺满
                await pg.evaluate("t => window.seek(t)", end - 0.01)
                f = os.path.join(frames_dir, f"f{n:05d}.png")
                await pg.screenshot(path=f)
                shots.append((f, rest))
                n += 1
        await b.close()

    vlist = os.path.join(outdir, "frames.txt")
    with open(vlist, "w") as fh:
        for f, d in shots:
            fh.write(f"file '{os.path.abspath(f)}'\nduration {d:.4f}\n")
        fh.write(f"file '{os.path.abspath(shots[-1][0])}'\n")   # concat 要求重复最后一帧

    # 3) 音轨：每句 + 句间停顿
    concat = os.path.join(outdir, "audio.txt")
    with open(concat, "w") as fh:
        for mp3, d, length in parts:
            sil = os.path.join(outdir, f"sil{round(length - d, 2)}.wav")
            if not os.path.exists(sil):
                subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
                                "-t", f"{length - d:.3f}", sil], capture_output=True, check=True)
            fh.write(f"file '{os.path.abspath(mp3)}'\nfile '{os.path.abspath(sil)}'\n")
    voice = os.path.join(outdir, "voice.wav")
    subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat,
                    "-ar", "44100", "-ac", "2", voice], capture_output=True, check=True)

    # 3.5) 背景音乐：垫在人声下面，并且【有人说话时自动让路】。
    # 不做闪避的话，音乐一到高处就盖住讲解——观众不会说"音乐大了"，
    # 只会觉得"这人讲得含混"，然后关掉。
    bgm = make_bgm(os.path.join(outdir, "bgm.wav"), total)
    audio = os.path.join(outdir, "mix.m4a")
    r = subprocess.run(
        ["ffmpeg", "-y", "-i", voice, "-i", bgm, "-filter_complex",
         # 【两条支路必须先 aformat 对齐】：人声是 edge-tts 的 24k 单声道、
         # 音乐是 44.1k 立体声，sidechaincompress 要求两边格式一致，
         # 不对齐就是 "Error reinitializing filters"（实测踩过）
         f"[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,"
         f"asplit=2[v1][sc];"
         f"[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,"
         f"volume={BGM_DB}dB[m];"
         f"[m][sc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400"
         f":makeup=1[mduck];"
         f"[v1][mduck]amix=inputs=2:duration=first:dropout_transition=0,"
         f"alimiter=limit=0.95[out]",
         "-map", "[out]", "-c:a", "aac", "-b:a", "160k", audio],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise RenderError(f"混音失败：{(r.stderr or '')[-400:]}")

    # 4) 合成
    out = os.path.join(outdir, f"{slug}.mp4")
    # 【用 -vf fps= 而不是 -vsync vfr】：concat 里静止帧带着几秒的 duration，
    # vfr 会把这些时长丢掉，画面一路飞到片尾再定格——音轨还是对的，所以表现为
    # "声音在讲第三段、画面已经是结尾了"。fps 滤镜会按时长把帧复制成等间隔，才对得上。
    r = subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", vlist,
                        "-i", audio, "-vf", f"fps={FPS}",
                        "-c:v", "libx264", "-preset", "medium", "-crf", "22",
                        "-pix_fmt", "yuv420p", "-c:a", "aac",
                        "-movflags", "+faststart", out], capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out):
        raise RenderError(f"ffmpeg 合成失败：{(r.stderr or '')[-400:]}")
    verify_frames(out, total)
    return out, total


def verify_frames(mp4, total):
    """抽查成片：随机几个时刻，字幕区必须真有字。

    【为什么要查成片而不是查捕获的帧】：捕获的帧一直是好的，
    坏在合成——`-vsync vfr` 把静止帧的时长丢了，声音在讲第三段、画面已经跑到片尾。
    只验"ffmpeg 返回 0"完全看不出来，只有把成片重新拆成图去看才看得见。
    """
    import tempfile
    spots = [total * r for r in (0.15, 0.35, 0.55, 0.75, 0.9)]
    blank = []
    with tempfile.TemporaryDirectory() as td:
        for i, t in enumerate(spots):
            png = os.path.join(td, f"s{i}.png")
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t:.2f}", "-i", mp4,
                            "-frames:v", "1", png], capture_output=True)
            if not os.path.exists(png):
                blank.append(round(t, 1))
                continue
            try:
                from PIL import Image
                im = Image.open(png).convert("L").crop((200, 460, 1100, 600))  # 字幕区
                if sum(1 for p in im.getdata() if p > 120) < 400:
                    blank.append(round(t, 1))
            except ImportError:
                return          # 没装 Pillow 就跳过这项，不阻断出片
    if blank:
        raise RenderError(f"成片在 {blank} 秒处字幕区是空的——画面和声音没对上")
