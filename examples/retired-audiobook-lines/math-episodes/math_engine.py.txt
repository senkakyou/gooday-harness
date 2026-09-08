#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""《奇妙数学》动画引擎：所有集共用的页面外壳 + 绘图原语 + 角色。
每集只提供「台词脚本」和「场景绘制 JS」，由 math-build.py 拼装。

⚠️ 占位符用 replace 注入（不能用 .format，JS 里全是花括号）：
   __EP_TITLE__ __EP_SUB__ __MP3__ __TIMELINE__ __SCENES__ __SCENE_IDS__
⚠️ 本文件里的 JS 模板字符串必须是原始反引号，不要转义（CLAUDE.md 独立 HTML 规则）。
"""

SHELL = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>奇妙数学 · __EP_TITLE__</title>
<style>
  :root{
    --cream:#fff7e8; --ink:#2f3542; --ink2:#6b7280;
    --orange:#f2994a; --red:#eb5757; --teal:#2d9cdb;
    --purple:#9b51e0; --green:#27ae60; --gold:#f2c94c;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#12161f}
  body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
  #stage{position:relative;width:100vw;max-width:1280px;margin:0 auto;background:var(--cream)}
  #stage.record{max-width:none;width:1280px;height:720px}
  svg{display:block;width:100%;height:auto}
  #ui{padding:14px 18px 22px;background:#12161f;color:#e8edf5}
  .row{display:flex;align-items:center;gap:14px;max-width:1280px;margin:0 auto}
  #play{flex:none;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;
        background:var(--orange);color:#fff;font-size:22px;line-height:1}
  #bar{flex:1;height:10px;border-radius:6px;background:#2a3242;cursor:pointer;position:relative}
  #fill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:6px;background:var(--orange)}
  #time{flex:none;font-size:14px;color:#9aa5b5;font-variant-numeric:tabular-nums}
  .hint{max-width:1280px;margin:12px auto 0;color:#8c97a8;font-size:13px;line-height:1.7}
  #quiz{max-width:1280px;margin:18px auto 0;background:#1b2230;border-radius:14px;padding:18px 20px;display:none}
  #quiz h3{margin:0 0 12px;font-size:18px;color:#fff}
  .opt{display:block;width:100%;text-align:left;margin:8px 0;padding:13px 16px;border-radius:10px;
       border:1px solid #2f3a4d;background:#232c3d;color:#dfe6f0;font-size:16px;cursor:pointer}
  .opt.right{background:#1e4436;border-color:var(--green);color:#c8f5dd}
  .opt.wrong{background:#4a2430;border-color:var(--red);color:#ffd6dd}
  #qres{margin-top:10px;font-size:15px;color:#9aa5b5;min-height:22px}
  @media(max-width:640px){#play{width:48px;height:48px;font-size:18px}}
</style>
</head>
<body>
<div id="stage">
<svg id="sv" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <rect width="1280" height="720" fill="var(--cream)"/>
  <g id="deco"></g>
  __SCENE_GROUPS__
  <g id="chars"></g>
</svg>
</div>

<div id="ui">
  <div class="row">
    <button id="play" aria-label="播放">▶</button>
    <div id="bar"><div id="fill"></div></div>
    <div id="time">0:00 / 0:00</div>
  </div>
  <div id="quiz">
    <h3>动动脑：<span id="qq"></span></h3>
    <div id="opts"></div>
    <div id="qres"></div>
  </div>
  <div class="hint">奇妙数学 · __EP_TITLE__ · 适合 8–10 岁 · 灵灵 &amp; 豆豆出品</div>
</div>

<audio id="au" preload="auto" src="__MP3__"></audio>

<script>
// ===== 时间轴：音频先合成、时长实测，画面跟着音频走 =====
const TL = /*__TIMELINE_MARK__*/__TIMELINE__;
const QUIZ = /*__QUIZ_MARK__*/__QUIZ__;

const NS = 'http://www.w3.org/2000/svg';
const el = (t, a) => { const e = document.createElementNS(NS, t);
  for (const k in a) e.setAttribute(k, a[k]); return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = p => p < .5 ? 2*p*p : 1 - Math.pow(-2*p+2, 2)/2;
const lerp = (a, b, p) => a + (b - a) * clamp(p, 0, 1);

function txt(x, y, s, size, color, anchor, weight) {
  const t = el('text', {x, y, 'font-size': size, fill: color || 'var(--ink)',
    'text-anchor': anchor || 'start', 'font-weight': weight || 400,
    'font-family': 'PingFang SC, Microsoft YaHei, sans-serif'});
  t.textContent = s; return t;
}

// ---------- 原语：披萨（等分意象）----------
// —— 入参归一化 ——
// Claude 生成的 spec 里，本该是数组的字段常写成单个数字或 "1,2,3" 这种串。
// 引擎直接 .includes/.forEach 就会在渲染到那一帧时才炸（一次 10 分钟白跑），
// 所以在入口统一归一化，别让类型假设活到渲染期。
function asArr(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(/[,，\s]+/).filter(Boolean);
  return [v];
}
function asNums(v) { return asArr(v).map(Number).filter(x => !isNaN(x)); }

function pizza(g, cx, cy, R, n, opt) {
  opt = opt || {};
  const pulled = asNums(opt.pulled), push = opt.push || 0, hi = asNums(opt.hi);
  g.appendChild(el('circle', {cx, cy, r: R + 9, fill: '#e0a862'}));
  for (let i = 0; i < n; i++) {
    const a1 = -Math.PI/2 + i*2*Math.PI/n, a2 = -Math.PI/2 + (i+1)*2*Math.PI/n;
    const am = (a1 + a2) / 2;
    const dx = pulled.includes(i) ? Math.cos(am)*push : 0;
    const dy = pulled.includes(i) ? Math.sin(am)*push : 0;
    const p1 = [cx + R*Math.cos(a1), cy + R*Math.sin(a1)];
    const p2 = [cx + R*Math.cos(a2), cy + R*Math.sin(a2)];
    const lg = (a2 - a1) > Math.PI ? 1 : 0;
    const d = n === 1
      ? `M ${cx-R} ${cy} A ${R} ${R} 0 1 1 ${cx+R} ${cy} A ${R} ${R} 0 1 1 ${cx-R} ${cy} Z`
      : `M ${cx} ${cy} L ${p1[0]} ${p1[1]} A ${R} ${R} 0 ${lg} 1 ${p2[0]} ${p2[1]} Z`;
    g.appendChild(el('path', {d, fill: hi.includes(i) ? '#f2994a' : '#ffd79a',
      stroke: '#e0a862', 'stroke-width': 3, transform: `translate(${dx},${dy})`}));
    for (let s = 0; s < 2; s++) {
      const rr = R*(0.45 + 0.28*s), aa = am + (s ? 0.16 : -0.16);
      g.appendChild(el('circle', {cx: cx + rr*Math.cos(aa) + dx, cy: cy + rr*Math.sin(aa) + dy,
        r: R*0.075, fill: '#e2574c'}));
    }
  }
}

// ---------- 原语：分数 ----------
function frac(g, x, y, up, down, size, color) {
  color = color || 'var(--ink)';
  g.appendChild(txt(x, y - size*0.22, up, size, color, 'middle', 700));
  g.appendChild(el('line', {x1: x - size*0.42, y1: y, x2: x + size*0.42, y2: y,
    stroke: color, 'stroke-width': Math.max(3, size*0.07), 'stroke-linecap': 'round'}));
  g.appendChild(txt(x, y + size*0.92, down, size, color, 'middle', 700));
}

// ---------- 原语：数轴 ----------
// opt: {min,max,step,dot(值),hi(值数组),labelEvery,zeroMark}
function numberLine(g, x0, x1, y, opt) {
  opt = opt || {};
  const mn = opt.min == null ? 0 : opt.min, mx = opt.max == null ? 10 : opt.max;
  const step = opt.step || 1, hi = asNums(opt.hi);
  const X = v => x0 + (v - mn) / (mx - mn) * (x1 - x0);
  g.appendChild(el('line', {x1: x0 - 26, y1: y, x2: x1 + 26, y2: y,
    stroke: 'var(--ink)', 'stroke-width': 4, 'stroke-linecap': 'round'}));
  g.appendChild(el('path', {d: `M ${x1+26} ${y} l -16 -9 l 0 18 Z`, fill: 'var(--ink)'}));
  g.appendChild(el('path', {d: `M ${x0-26} ${y} l 16 -9 l 0 18 Z`, fill: 'var(--ink)'}));
  for (let v = mn; v <= mx + 1e-9; v += step) {
    const x = X(v), on = hi.includes(v), zero = (v === 0);
    g.appendChild(el('line', {x1: x, y1: y - (zero ? 18 : 12), x2: x, y2: y + (zero ? 18 : 12),
      stroke: zero ? 'var(--red)' : 'var(--ink2)', 'stroke-width': zero ? 5 : 3}));
    if (opt.labels !== false)
      g.appendChild(txt(x, y + 46, String(v), zero ? 30 : 26,
        on ? 'var(--orange)' : (zero ? 'var(--red)' : 'var(--ink2)'), 'middle', on || zero ? 700 : 500));
  }
  if (opt.dot != null)
    g.appendChild(el('circle', {cx: X(opt.dot), cy: y, r: 15, fill: 'var(--orange)',
      stroke: '#fff', 'stroke-width': 3}));
  return X;
}

// ---------- 原语：点阵 / 方块阵（乘法、面积）----------
// opt:{cell, gap, fill, hiRows, hiCols, shape:'dot'|'box', show(个数)}
function grid(g, x, y, rows, cols, opt) {
  opt = opt || {};
  const cell = opt.cell || 46, gap = opt.gap || 8, shape = opt.shape || 'box';
  const show = opt.show == null ? rows*cols : opt.show;
  let k = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (k++ >= show) continue;
    const cx = x + c*(cell + gap), cy = y + r*(cell + gap);
    const on = (opt.hiRow != null && r === opt.hiRow) || (opt.hiCol != null && c === opt.hiCol);
    if (shape === 'dot')
      g.appendChild(el('circle', {cx: cx + cell/2, cy: cy + cell/2, r: cell*0.38,
        fill: on ? 'var(--orange)' : '#7cc0e8'}));
    else
      g.appendChild(el('rect', {x: cx, y: cy, width: cell, height: cell, rx: 7,
        fill: on ? 'var(--orange)' : '#ffd79a', stroke: '#e0a862', 'stroke-width': 2.5}));
  }
  return {w: cols*(cell+gap) - (opt.gap||8), h: rows*(cell+gap) - (opt.gap||8)};
}

// ---------- 原语：数位格子 ----------
function digitBoxes(g, cx, y, digits, labels, size, hiIdx) {
  size = size || 96;
  digits = Array.isArray(digits) ? digits : String(digits == null ? '' : digits).split('');
  labels = asArr(labels);
  const n = digits.length, W = n*size + (n-1)*14;
  let x = cx - W/2;
  digits.forEach((d, i) => {
    const on = (hiIdx === i);
    g.appendChild(el('rect', {x, y, width: size, height: size, rx: 14,
      fill: on ? '#ffe6c2' : '#fff', stroke: on ? 'var(--orange)' : '#d9c7a8',
      'stroke-width': on ? 5 : 3}));
    g.appendChild(txt(x + size/2, y + size*0.72, String(d), size*0.62,
      on ? 'var(--orange)' : 'var(--ink)', 'middle', 800));
    if (labels && labels[i])
      g.appendChild(txt(x + size/2, y + size + 36, labels[i], 24, 'var(--ink2)', 'middle', 600));
    x += size + 14;
  });
}

// ---------- 原语：柱子（平均数等）----------
function bars(g, x0, baseY, vals, opt) {
  opt = opt || {};
  vals = asNums(vals);
  const w = opt.w || 84, gap = opt.gap || 46, unit = opt.unit || 26;
  vals.forEach((v, i) => {
    const h = Math.max(2, v*unit), x = x0 + i*(w + gap);
    g.appendChild(el('rect', {x, y: baseY - h, width: w, height: h, rx: 10,
      fill: (opt.colors && opt.colors[i]) || 'var(--teal)'}));
    g.appendChild(txt(x + w/2, baseY - h - 14, String(Math.round(v)), 30,
      'var(--ink)', 'middle', 700));
    if (opt.names) g.appendChild(txt(x + w/2, baseY + 40, opt.names[i], 26, 'var(--ink2)', 'middle', 600));
  });
  g.appendChild(el('line', {x1: x0 - 26, y1: baseY, x2: x0 + vals.length*(w+gap) - gap + 26, y2: baseY,
    stroke: 'var(--ink)', 'stroke-width': 4, 'stroke-linecap': 'round'}));
}

// ---------- 原语：温度计 ----------
function thermo(g, cx, cy, h, value, opt) {
  opt = opt || {};
  const w = 34, top = cy - h/2, bot = cy + h/2;
  g.appendChild(el('rect', {x: cx - w/2, y: top, width: w, height: h, rx: w/2,
    fill: '#fff', stroke: '#c9b799', 'stroke-width': 4}));
  g.appendChild(el('circle', {cx, cy: bot + 26, r: 30, fill: value < 0 ? '#5aa9e6' : '#eb5757'}));
  const p = clamp((value + 20) / 60, 0, 1);
  const fh = p * h;
  g.appendChild(el('rect', {x: cx - w/2 + 8, y: bot - fh, width: w - 16, height: fh,
    rx: (w-16)/2, fill: value < 0 ? '#5aa9e6' : '#eb5757'}));
  const zeroY = bot - (20/60)*h;
  g.appendChild(el('line', {x1: cx - w, y1: zeroY, x2: cx + w + 14, y2: zeroY,
    stroke: 'var(--ink)', 'stroke-width': 3, 'stroke-dasharray': '7 6'}));
  g.appendChild(txt(cx + w + 22, zeroY + 9, '0°C', 26, 'var(--ink)', 'start', 700));
  if (opt.label) g.appendChild(txt(cx, bot + 88, opt.label, 28, 'var(--ink2)', 'middle', 600));
}

// ---------- 角色：官方形象 + 口型/眨眼/点头 ----------
function charState(t, talking, seed) {
  const blink = (((t + seed) % 3.7) < 0.13);
  const open  = talking ? 0.22 + 0.78*Math.abs(Math.sin((t + seed)*11.5)) : 0;
  const bob   = talking ? Math.sin((t + seed)*6.4)*3.6 : Math.sin((t + seed)*1.7)*2.0;
  const tilt  = talking ? Math.sin((t + seed)*3.1)*2.6 : 0;
  return {open, blink, bob, tilt, talking};
}

function face(G, mood, ey, st) {
  st = st || {open: 0, blink: false};
  [-13, 13].forEach(dx => {
    if (st.blink) {
      G.appendChild(el('path', {d: `M ${dx-6} ${ey} Q ${dx} ${ey+5} ${dx+6} ${ey}`,
        stroke: '#2a2a30', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round'}));
    } else {
      G.appendChild(el('ellipse', {cx: dx, cy: ey, rx: 5.6, ry: 7.2, fill: '#2a2a30'}));
      G.appendChild(el('circle', {cx: dx + 2, cy: ey - 2.6, r: 2.1, fill: '#fff'}));
    }
  });
  [-25, 25].forEach(dx =>
    G.appendChild(el('ellipse', {cx: dx, cy: ey + 12, rx: 8, ry: 5.2, fill: '#ffa8bf',
      opacity: st.talking ? .85 : .72})));
  if (st.open > 0.06) {
    const h = 3.5 + 11*st.open;
    G.appendChild(el('ellipse', {cx: 0, cy: ey + 19, rx: 10.5, ry: h, fill: '#5b3a3d'}));
    G.appendChild(el('ellipse', {cx: 0, cy: ey + 19 + h*0.42, rx: 6, ry: h*0.42, fill: '#ff8fa6'}));
  } else if (mood === 'think') {
    G.appendChild(el('path', {d: `M -8 ${ey+17} Q 0 ${ey+12} 8 ${ey+17}`,
      stroke: '#4a3336', 'stroke-width': 3.2, fill: 'none', 'stroke-linecap': 'round'}));
  } else {
    G.appendChild(el('path', {d: `M -12 ${ey+13} Q 0 ${ey+31} 12 ${ey+13} Z`, fill: '#5b3a3d'}));
    G.appendChild(el('path', {d: `M -6 ${ey+22} Q 0 ${ey+30} 6 ${ey+22} Z`, fill: '#ff8fa6'}));
  }
}

function lingling(g, x, y, s, mood, st) {
  st = st || {open: 0, blink: false, bob: 0, tilt: 0};
  const arm = st.talking ? Math.sin(st.bob)*10 : 0;
  const G = el('g', {transform: `translate(${x},${y + (st.bob||0)}) rotate(${st.tilt||0}) scale(${s})`});
  G.appendChild(el('ellipse', {cx: 0, cy: 4, rx: 39, ry: 43, fill: '#fdfdff', stroke: '#c9dcee', 'stroke-width': 3}));
  G.appendChild(el('ellipse', {cx: -38, cy: 16, rx: 11, ry: 8, fill: '#fdfdff', stroke: '#c9dcee',
    'stroke-width': 2.5, transform: `rotate(${-20 - arm} -38 16)`}));
  G.appendChild(el('ellipse', {cx: 38, cy: 16, rx: 11, ry: 8, fill: '#fdfdff', stroke: '#c9dcee',
    'stroke-width': 2.5, transform: `rotate(${20 + arm} 38 16)`}));
  G.appendChild(el('ellipse', {cx: -15, cy: 46, rx: 12, ry: 7, fill: '#fdfdff', stroke: '#c9dcee', 'stroke-width': 2.5}));
  G.appendChild(el('ellipse', {cx: 15, cy: 46, rx: 12, ry: 7, fill: '#fdfdff', stroke: '#c9dcee', 'stroke-width': 2.5}));
  G.appendChild(el('path', {d: 'M 1 -39 C 1 -52 10 -60 17 -55 C 23 -51 19 -43 12 -45',
    stroke: '#c9dcee', 'stroke-width': 5, fill: '#fdfdff', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}));
  G.appendChild(el('ellipse', {cx: -14, cy: -14, rx: 13, ry: 9, fill: '#eaf4ff', opacity: .9}));
  face(G, mood, -6, st);
  g.appendChild(G);
}

function doudou(g, x, y, s, mood, st) {
  st = st || {open: 0, blink: false, bob: 0, tilt: 0};
  const arm = st.talking ? Math.sin(st.bob + 1)*10 : 0;
  const G = el('g', {transform: `translate(${x},${y + (st.bob||0)}) rotate(${st.tilt||0}) scale(${s})`});
  G.appendChild(el('circle', {cx: 0, cy: 4, r: 41, fill: '#9dcc52', stroke: '#6da634', 'stroke-width': 3}));
  G.appendChild(el('ellipse', {cx: -15, cy: -13, rx: 14, ry: 10, fill: '#c2e37f', opacity: .75}));
  G.appendChild(el('ellipse', {cx: -40, cy: 16, rx: 10, ry: 7.5, fill: '#9dcc52', stroke: '#6da634',
    'stroke-width': 2.5, transform: `rotate(${-20 - arm} -40 16)`}));
  G.appendChild(el('ellipse', {cx: 40, cy: 16, rx: 10, ry: 7.5, fill: '#9dcc52', stroke: '#6da634',
    'stroke-width': 2.5, transform: `rotate(${20 + arm} 40 16)`}));
  G.appendChild(el('ellipse', {cx: -14, cy: 45, rx: 11, ry: 6.5, fill: '#9dcc52', stroke: '#6da634', 'stroke-width': 2.5}));
  G.appendChild(el('ellipse', {cx: 14, cy: 45, rx: 11, ry: 6.5, fill: '#9dcc52', stroke: '#6da634', 'stroke-width': 2.5}));
  G.appendChild(el('path', {d: 'M 4 -40 Q 8 -50 14 -54', stroke: '#6da634', 'stroke-width': 3.4,
    fill: 'none', 'stroke-linecap': 'round'}));
  G.appendChild(el('ellipse', {cx: 22, cy: -56, rx: 12, ry: 7, fill: '#7fc242', stroke: '#5e9a2e',
    'stroke-width': 2, transform: 'rotate(-24 22 -56)'}));
  G.appendChild(el('ellipse', {cx: 3, cy: -60, rx: 10, ry: 6, fill: '#8fd04d', stroke: '#5e9a2e',
    'stroke-width': 2, transform: 'rotate(-62 3 -60)'}));
  face(G, mood, -6, st);
  g.appendChild(G);
}

// ---------- 通用：标题页 ----------
function drawTitleScene(g, p, t, title, sub) {
  const s = lerp(.6, 1, ease(clamp(p*3, 0, 1)));
  g.appendChild(txt(640, 240, '奇妙数学', 92*s, 'var(--orange)', 'middle', 800));
  g.appendChild(txt(640, 330, title, 42, 'var(--ink)', 'middle', 700));
  if (sub) g.appendChild(txt(640, 392, sub, 28, 'var(--ink2)', 'middle', 400));
  lingling(g, 455, 520, 1.75, 'happy', charState(t, CUR_SP === 'L', 0));
  doudou(g, 825, 520, 1.75, 'happy', charState(t, CUR_SP === 'D', 1.3));
  if (p > .55) g.appendChild(txt(640, 668, '适合 8–10 岁', 24, 'var(--ink2)', 'middle', 400));
}


// 文字折行：SVG 的 text 不会自动换行，长句必须自己切，否则会超出画面/互相压
// （2026-08-14 数据驱动分镜首跑就撞到：步骤条冲出右边界、生活例子说明叠在一起）
function txtWrap(g, x, y, s, size, color, anchor, weight, maxChars, maxLines) {
  s = String(s == null ? '' : s);
  const lim = maxChars || 22, ml = maxLines || 3;
  const lines = [];
  for (let i = 0; i < s.length && lines.length < ml; i += lim) lines.push(s.slice(i, i + lim));
  if (lines.length === ml && s.length > lim * ml)
    lines[ml - 1] = lines[ml - 1].slice(0, Math.max(1, lim - 1)) + '…';
  const lh = size * 1.32;
  const y0 = y - (lines.length - 1) * lh / 2;
  lines.forEach((ln, i) => g.appendChild(txt(x, y0 + i * lh, ln, size, color, anchor, weight)));
  return lines.length;
}

// ==================== 声明式分镜（数据驱动，100 集产线用）====================
// 一集 = 若干 scene；scene = {id, kind, title, ...}；不写 JS，只填数据。
// 视觉 visual = {type:'pizza'|'grid'|'numberLine'|'bars'|'digits'|'frac'|'thermo'|'text', ...}

function drawVisual(g, v, cx, cy, scale, p, maxHalfW) {
  if (!v) return;
  const s = scale == null ? 1 : scale;
  // 并排布局里左右各只有一半画面，数轴这类「按半宽画」的视觉必须夹住，否则会互相压字
  const HW = maxHalfW || 1e9;
  const T = v.type;
  if (T === 'pizza') {
    const n = v.n || 4, hi = v.hi || [];
    const show = v.grow ? Math.max(1, Math.ceil(clamp(p / 0.6, 0, 1) * n)) : n;
    pizza(g, cx, cy, (v.r || 130) * s, show, {hi, pulled: v.pulled || [], push: v.push || 0});
  } else if (T === 'grid') {
    const rows = v.rows || 3, cols = v.cols || 4, cell = (v.cell || 60) * s, gap = 10 * s;
    const w = cols * (cell + gap) - gap, h = rows * (cell + gap) - gap;
    const show = v.grow ? Math.ceil(clamp(p / 0.6, 0, 1) * rows * cols) : rows * cols;
    grid(g, cx - w / 2, cy - h / 2, rows, cols,
         {cell, gap, shape: v.shape || 'box', show, hiRow: v.hiRow, hiCol: v.hiCol});
  } else if (T === 'numberLine') {
    const nlHW = Math.min((v.w || 380) * s, HW);
    numberLine(g, cx - nlHW, cx + nlHW, cy,
               {min: v.min == null ? 0 : v.min, max: v.max == null ? 10 : v.max,
                step: v.step || 1, hi: v.hi || [], dot: v.dot});
  } else if (T === 'bars') {
    const vv = asNums(v.vals), vals = vv.length ? vv : [3, 5, 2];
    const w = 84 * s, gap = 46 * s;
    const total = vals.length * (w + gap) - gap;
    // 自动限高：数值跨度大时（如「豆豆8岁 vs 爸爸38岁」）固定 unit 会把柱子顶出画面外，
    // 只缩不放——小数值仍按原 unit，大数值才压缩到可视范围内。
    const mx = Math.max(...vals.map(Math.abs), 1);
    const unit = Math.min((v.unit || 26) * s, (300 * s) / mx);
    bars(g, cx - total / 2, cy + 110 * s, vals,
         {w, gap, unit, names: v.names, colors: v.colors});
  } else if (T === 'digits') {
    digitBoxes(g, cx, cy - 50 * s, v.digits || [1, 0], v.labels, (v.size || 96) * s, v.hi);
  } else if (T === 'frac') {
    frac(g, cx, cy, String(v.up), String(v.down), (v.size || 110) * s, v.color || 'var(--ink)');
  } else if (T === 'thermo') {
    thermo(g, cx, cy, (v.h || 280) * s, v.value == null ? -5 : v.value, {});
  } else if (T === 'text') {
    g.appendChild(txt(cx, cy, v.s || '', (v.size || 90) * s, v.color || 'var(--teal)', 'middle', 800));
  }
}

// 各 kind 的版式（都避开左下/右下主持人区）
const KIND = {
  statement(g, p, t, sc) {
    if (sc.title) txtWrap(g, 640, 100, sc.title, 42, 'var(--ink)', 'middle', 700, 20, 1);
    drawVisual(g, sc.visual, 640, 360, 1, p);
    if (sc.note && p > .45)
      txtWrap(g.appendChild(el('g', {opacity: clamp((p - .45) / .16, 0, 1)})),
        640, 624, sc.note, 32, 'var(--ink2)', 'middle', 600, 30, 2);
  },
  compare(g, p, t, sc) {
    if (sc.title) txtWrap(g, 640, 96, sc.title, 42, 'var(--ink)', 'middle', 700, 20, 1);
    drawVisual(g, sc.left, 400, 350, .82, p, 190);
    if (sc.leftLabel) g.appendChild(txt(400, 560, sc.leftLabel, 32, 'var(--orange)', 'middle', 700));
    if (p > .3) {
      const gg = el('g', {opacity: clamp((p - .3) / .16, 0, 1)});
      drawVisual(gg, sc.right, 880, 350, .82, p, 190);
      if (sc.rightLabel) gg.appendChild(txt(880, 560, sc.rightLabel, 32, 'var(--purple)', 'middle', 700));
      g.appendChild(gg);
    }
    if (sc.verdict && p > .62) {
      const gg = el('g', {opacity: clamp((p - .62) / .18, 0, 1)});
      gg.appendChild(el('rect', {x: 240, y: 620, width: 800, height: 66, rx: 16,
        fill: '#fff2d8', stroke: 'var(--gold)', 'stroke-width': 3}));
      txtWrap(gg, 640, 655, sc.verdict, 32, '#a06a12', 'middle', 700, 26, 2);
      g.appendChild(gg);
    }
  },
  build(g, p, t, sc) {
    if (sc.title) txtWrap(g, 640, 96, sc.title, 42, 'var(--ink)', 'middle', 700, 20, 1);
    drawVisual(g, sc.visual, 470, 360, .92, p);
    (sc.steps || []).forEach((s, i) => {
      const at = .2 + i * .22;
      if (p > at) {
        const gg = el('g', {opacity: clamp((p - at) / .12, 0, 1)});
        gg.appendChild(el('circle', {cx: 830, cy: 250 + i * 92, r: 17, fill: 'var(--teal)'}));
        gg.appendChild(txt(830, 259 + i * 92, String(i + 1), 22, '#fff', 'middle', 700));
        txtWrap(gg, 866, 258 + i * 92, s, 29, 'var(--ink)', 'start', 600, 13, 2);
        g.appendChild(gg);
      }
    });
  },
  formula(g, p, t, sc) {
    if (sc.title) g.appendChild(txt(640, 110, sc.title, 42, 'var(--ink)', 'middle', 700));
    if (sc.visual) drawVisual(g, sc.visual, 640, 300, .8, p);
    const y = sc.visual ? 500 : 330;
    if (p > .2) {
      const gg = el('g', {opacity: clamp((p - .2) / .18, 0, 1)});
      gg.appendChild(el('rect', {x: 260, y: y - 56, width: 760, height: 96, rx: 20,
        fill: '#fff2d8', stroke: 'var(--gold)', 'stroke-width': 4}));
      gg.appendChild(txt(640, y + 8, sc.formula || '', 46, '#a06a12', 'middle', 800));
      g.appendChild(gg);
    }
    if (sc.note && p > .55)
      txtWrap(g.appendChild(el('g', {opacity: clamp((p - .55) / .16, 0, 1)})),
        640, y + 114, sc.note, 31, 'var(--ink2)', 'middle', 600, 30, 2);
  },
  mythbust(g, p, t, sc) {
    g.appendChild(txt(640, 96, sc.title || '很多人会这样想', 42, 'var(--ink)', 'middle', 700));
    const box = (x, w, col, head, body, o) => {
      const gg = el('g', {opacity: o});
      gg.appendChild(el('rect', {x, y: 190, width: w, height: 300, rx: 18, fill: '#fff',
        stroke: col, 'stroke-width': 4}));
      gg.appendChild(txt(x + w / 2, 250, head, 32, col, 'middle', 700));
      let yy = 316;
      (body || '').split('|').slice(0, 3).forEach(ln => {
        yy += txtWrap(gg, x + w / 2, yy, ln, 28, 'var(--ink)', 'middle', 500, 15, 2) * 38;
      });
      return gg;
    };
    g.appendChild(box(120, 480, 'var(--red)', '❌ ' + (sc.wrongHead || '错觉'), sc.wrong, 1));
    if (p > .38) g.appendChild(box(680, 480, 'var(--green)', '✅ ' + (sc.rightHead || '其实是'),
      sc.right, clamp((p - .38) / .18, 0, 1)));
    if (sc.visual && p > .66) {
      const gg = el('g', {opacity: clamp((p - .66) / .18, 0, 1)});
      drawVisual(gg, sc.visual, 640, 590, .5, p); g.appendChild(gg);
    }
  },
  life(g, p, t, sc) {
    g.appendChild(txt(640, 100, sc.title || '生活里的它', 42, 'var(--ink)', 'middle', 700));
    (sc.items || []).forEach((it, i) => {
      const at = .12 + i * .24, n = (sc.items || []).length;
      if (p <= at) return;
      const gg = el('g', {opacity: clamp((p - at) / .14, 0, 1)});
      const x = 640 + (i - (n - 1) / 2) * 360;
      gg.appendChild(el('circle', {cx: x, cy: 320, r: 86, fill: '#fff', stroke: '#e0cdae', 'stroke-width': 5}));
      gg.appendChild(txt(x, 345, it.big || '', 56, 'var(--orange)', 'middle', 800));
      txtWrap(gg, x, 474, it.text || '', 27, 'var(--ink2)', 'middle', 600, 11, 3);
      g.appendChild(gg);
    });
    if (sc.note && p > .78)
      txtWrap(g.appendChild(el('g', {opacity: clamp((p - .78) / .16, 0, 1)})),
        640, 606, sc.note, 32, 'var(--green)', 'middle', 700, 28, 2);
  },
  quiz(g, p, t, sc) {
    g.appendChild(txt(640, 116, '动动脑', 42, 'var(--orange)', 'middle', 800));
      txtWrap(g, 640, 200, sc.q || '', 38, 'var(--ink)', 'middle', 700, 26, 2);
    if (sc.visual) drawVisual(g, sc.visual, 640, 380, .72, p);
    if (p > .28 && p < .52)
      g.appendChild(txt(640, 600, '想一想' + '.'.repeat(1 + Math.floor((t * 2) % 3)),
        36, 'var(--ink2)', 'middle', 600));
    if (p >= .52) {
      const gg = el('g', {opacity: clamp((p - .52) / .14, 0, 1)});
      txtWrap(gg, 640, 604, sc.answer || '', 42, 'var(--green)', 'middle', 800, 22, 2);
      g.appendChild(gg);
    }
  },
};

// 由 SPEC 自动生成 DRAW：title 页固定，其余按 kind 走版式
function buildDraw(spec) {
  const D = {title: (g, p, t) => drawTitleScene(g, p, t, spec.title, spec.sub)};
  (spec.scenes || []).forEach(sc => {
    const fn = KIND[sc.kind] || KIND.statement;
    D[sc.id] = (g, p, t) => fn(g, p, t, sc);
  });
  return D;
}

let CUR_SP = null;

const SC = {};
__SCENE_IDS__.forEach(k => { SC[k] = document.getElementById('sc-' + k); });
const CH = document.getElementById('chars');
const DECO = document.getElementById('deco');
function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }

// ===================== 本集场景 =====================
__SCENES__
// ====================================================

function seek(t) {
  t = clamp(t, 0, TL.duration);
  clear(DECO); clear(CH);
  for (let i = 0; i < 14; i++) {
    const x = (i*137 + Math.sin(t*0.3 + i)*18) % 1280;
    const y = 40 + ((i*91) % 640) + Math.cos(t*0.25 + i)*12;
    DECO.appendChild(el('circle', {cx: x, cy: y, r: 5 + (i % 3)*2,
      fill: ['#ffe0b8','#cdeafc','#ffd6e6'][i % 3], opacity: .55}));
  }
  for (const k in SC) { clear(SC[k]); SC[k].setAttribute('display', 'none'); }
  let cur = TL.scenes[0];
  for (const s of TL.scenes) if (t >= s.start) cur = s;
  CUR_SP = null;
  for (const L of TL.lines) if (t >= L.start && t < L.start + L.dur) CUR_SP = L.sp;
  const g = SC[cur.id];
  if (g) {
    g.setAttribute('display', '');
    const p = clamp((t - cur.start) / Math.max(.001, cur.end - cur.start), 0, 1);
    (DRAW[cur.id])(g, p, t);
  }
  if (cur.id !== 'title') {
    lingling(CH, 95, 646, .74, 'happy', charState(t, CUR_SP === 'L', 0));
    doudou(CH, 1185, 646, .74, 'happy', charState(t, CUR_SP === 'D', 1.3));
  }
}
window.seek = seek;

const params = new URLSearchParams(location.search);
if (params.get('record') === '1') {
  document.getElementById('stage').classList.add('record');
  document.getElementById('ui').style.display = 'none';
  document.getElementById('au').remove();
  seek(0);
} else {
  const au = document.getElementById('au'), play = document.getElementById('play');
  const bar = document.getElementById('bar'), fill = document.getElementById('fill');
  const time = document.getElementById('time'), quiz = document.getElementById('quiz');
  const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  document.getElementById('qq').textContent = QUIZ.q;
  const optBox = document.getElementById('opts');
  QUIZ.options.forEach((o, i) => {
    const b = document.createElement('button');
    b.className = 'opt'; b.textContent = o;
    b.addEventListener('click', () => {
      const ok = (i === QUIZ.answer);
      b.classList.add(ok ? 'right' : 'wrong');
      document.getElementById('qres').textContent = ok ? QUIZ.right : QUIZ.wrong;
    });
    optBox.appendChild(b);
  });
  let raf = null;
  const tick = () => {
    seek(au.currentTime);
    fill.style.width = (au.currentTime / (au.duration || TL.duration) * 100) + '%';
    time.textContent = `${fmt(au.currentTime)} / ${fmt(au.duration || TL.duration)}`;
    if (au.currentTime > TL.duration*0.9) quiz.style.display = 'block';
    raf = requestAnimationFrame(tick);
  };
  play.addEventListener('click', () => {
    if (au.paused) { au.play(); play.textContent = '❚❚'; if (!raf) tick(); }
    else { au.pause(); play.textContent = '▶'; cancelAnimationFrame(raf); raf = null; }
  });
  au.addEventListener('ended', () => { play.textContent = '▶';
    cancelAnimationFrame(raf); raf = null; quiz.style.display = 'block'; });
  bar.addEventListener('click', e => {
    const r = bar.getBoundingClientRect();
    au.currentTime = (e.clientX - r.left)/r.width*(au.duration || TL.duration);
    seek(au.currentTime);
  });
  seek(0);
}
</script>
</body>
</html>
"""
