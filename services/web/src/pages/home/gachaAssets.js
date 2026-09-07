// =====================================================
// pages/home/gachaAssets.js —— 首页开箱抽卡的静态资源与音效
// 纯数据 + Web Audio 音效函数，从 Home.jsx 抽离，无 React 依赖
// =====================================================

// 背景星点位置配置（固定随机感，避免每次渲染位置变化）
export const STARS = [
  { x: '6%',  y: '20%', d: '2.5s', delay: '0s'   },
  { x: '20%', y: '65%', d: '3.5s', delay: '0.5s'  },
  { x: '40%', y: '10%', d: '2.1s', delay: '1s'    },
  { x: '58%', y: '72%', d: '4s',   delay: '0.3s'  },
  { x: '72%', y: '22%', d: '3s',   delay: '1.5s'  },
  { x: '85%', y: '50%', d: '2.8s', delay: '0.8s'  },
  { x: '92%', y: '12%', d: '3.2s', delay: '0.2s'  },
  { x: '12%', y: '85%', d: '2.4s', delay: '1.2s'  },
  { x: '48%', y: '40%', d: '3.8s', delay: '0.6s'  },
  { x: '30%', y: '30%', d: '2.6s', delay: '1.8s'  },
]

// 首页模块导航配置（非工具类模块：需求、论坛、游戏、二手）
export const MODULE_ITEMS = [
  { label: '需求', icon: '📋', sub: '发布需求',  path: '/requests',   iconBg: 'linear-gradient(135deg,#7c6cff,#5a4fe0)' },
  { label: '论坛', icon: '💬', sub: '交流讨论',  path: '/forum',      iconBg: 'linear-gradient(135deg,#00b4d8,#0096b7)' },
  { label: '课程', icon: '🎓', sub: '一对一/小班', path: '/courses',    iconBg: 'linear-gradient(135deg,#8b5cf6,#7c3aed)' },
  { label: '听书', icon: '🎧', sub: '免费畅听',    path: '/audiobooks', iconBg: 'linear-gradient(135deg,#ec4899,#db2777)' },
  { label: '游戏', icon: '🎮', sub: '精选游戏',  path: '/games',      iconBg: 'linear-gradient(135deg,#10b981,#059669)' },
  { label: '二手', icon: '🛍️', sub: '闲置交易', path: '/secondhand', iconBg: 'linear-gradient(135deg,#f97316,#ea580c)' },
  { label: '投资', icon: '📈', sub: '买点评分', path: '/invest',     iconBg: 'linear-gradient(135deg,#0ea5e9,#0369a1)' },
]

export const CAT_ICONS = { '系统':'🖥', '教育':'📚', '效率':'⚡', '开发':'💻', '设计':'🎨', '娱乐':'🎵', '工具':'🤖', '脚本':'📝' }
export const RANK_COLORS = ['#ef4444', '#f97316', '#eab308', 'var(--muted)']

const RARITY = [
  { stars: 2, label: '普通工具', color: '#9ca3af', weight: 60 },
  { stars: 3, label: '热门工具', color: '#f59e0b', weight: 25 },
  { stars: 4, label: '神级工具', color: '#c084fc', weight: 12 },
  { stars: 5, label: '隐藏工具', color: '#f472b6', weight:  3 },
]
// 卡片从 banner 中心向上半圆烟花式散开，0=中奖卡置顶，左右对称
export const CARD_W = 52, CARD_H = 62
export const BURST_ANGLES = [-90, -40, -140, -8, -172]
const PARTICLE_COLORS = ['#9bf0ff', '#ffffff', '#ff9be0', '#c4b0ff', '#7df0ff', '#ffd98a']
export const BURST_PARTICLES = Array.from({ length: 16 }, (_, i) => {
  const angle = (i * 22.5) * Math.PI / 180
  const dist = 30 + (i % 4) * 16
  return {
    px: Math.cos(angle) * dist,
    py: Math.sin(angle) * dist,
    size: i % 3 === 0 ? 4 : i % 3 === 1 ? 3 : 2.2,
    color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
  }
})
// 星光（✦）位置，相对于箱子中心
export const BURST_STARS = [
  { ox: -30, oy: -46, size: 15, delay: 0    },
  { ox:  24, oy: -52, size: 12, delay: 0.06 },
  { ox: -58, oy: -26, size: 13, delay: 0.03 },
  { ox:  42, oy: -38, size: 11, delay: 0.09 },
  { ox:   6, oy: -62, size: 14, delay: 0.05 },
  { ox: -18, oy: -14, size: 10, delay: 0.08 },
  { ox:  52, oy: -18, size: 11, delay: 0.02 },
]
// 电流闪电（折线），角度 = 相对箱子中心方向
export const LIGHT_RAYS = [
  { angle: -90,  length: 78, width: 3.5, color: '#eafdff' },
  { angle: -68,  length: 62, width: 2.8, color: '#a8ecff' },
  { angle: -112, length: 64, width: 2.8, color: '#cdb6ff' },
  { angle: -46,  length: 52, width: 2.2, color: '#7df0ff' },
  { angle: -134, length: 54, width: 2.2, color: '#ff9be0' },
  { angle: -25,  length: 40, width: 1.8, color: '#b58bff' },
  { angle: -155, length: 42, width: 1.8, color: '#8fd8ff' },
  { angle:  -8,  length: 32, width: 1.5, color: '#ff9be0' },
  { angle: -172, length: 34, width: 1.5, color: '#a78bfa' },
  { angle: -50,  length: 46, width: 2,   color: '#d8eaff' },
  { angle: -130, length: 48, width: 2,   color: '#e0b0ff' },
  { angle: -180, length: 30, width: 1.4, color: '#9bf0ff' },
  { angle:   0,  length: 28, width: 1.4, color: '#ff9be0' },
]

// 按 weight 权重随机抽取一个稀有度等级（加权随机算法）
export function pickRarity() {
  let r = Math.random() * 100
  for (const rr of RARITY) { r -= rr.weight; if (r <= 0) return rr }
  return RARITY[0]
}

// ── Web Audio 声效 ──────────────────────────────────────────
let _ac = null
function ac() {
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)()
  if (_ac.state === 'suspended') _ac.resume()
  return _ac
}
export function sfxClick() {
  try {
    const c = ac(), t = c.currentTime
    const o = c.createOscillator(), g = c.createGain()
    o.type = 'square'
    o.frequency.setValueAtTime(1100, t)
    o.frequency.exponentialRampToValueAtTime(160, t + 0.07)
    g.gain.setValueAtTime(0.28, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07)
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.07)
  } catch {}
}
export function sfxCharge() {
  try {
    const c = ac(), t = c.currentTime
    const o = c.createOscillator(), g = c.createGain()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(120, t)
    o.frequency.exponentialRampToValueAtTime(820, t + 0.42)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.13, t + 0.3)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.46)
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.48)
  } catch {}
}
export function sfxBurst() {
  try {
    const c = ac(), t = c.currentTime
    const n = Math.floor(c.sampleRate * 0.24)
    const b = c.createBuffer(1, n, c.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 1.8)
    const s = c.createBufferSource(); s.buffer = b
    const g = c.createGain()
    g.gain.setValueAtTime(0.38, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.24)
    s.connect(g); g.connect(c.destination); s.start(t)
  } catch {}
}
export function sfxWhoosh(delay = 0) {
  try {
    const c = ac(), t = c.currentTime + delay
    const o = c.createOscillator(), g = c.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(680, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.18)
    g.gain.setValueAtTime(0.10, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.2)
  } catch {}
}
export function sfxReveal(stars = 2) {
  try {
    const c = ac(), t = c.currentTime
    ;[523, 659, 784, 1047, 1319].slice(0, stars).forEach((freq, i) => {
      const o = c.createOscillator(), g = c.createGain()
      o.type = 'sine'; o.frequency.value = freq
      const st = t + i * 0.1
      g.gain.setValueAtTime(0, st)
      g.gain.linearRampToValueAtTime(0.18, st + 0.025)
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.34)
      o.connect(g); g.connect(c.destination); o.start(st); o.stop(st + 0.38)
    })
  } catch {}
}

// 8 particles orbiting all four sides of the box
export const BOX_PARTICLES = [
  { top: '-10%', left: '22%',  size: 2.5, color: '#e879f9', dur: '3.2s', delay: '0s',   dx: '3px',  dy: '-7px'  },
  { top: '-13%', left: '68%',  size: 2,   color: '#818cf8', dur: '4.1s', delay: '0.6s', dx: '-2px', dy: '-9px'  },
  { top: '18%',  left: '-15%', size: 3,   color: '#c084fc', dur: '2.9s', delay: '0.2s', dx: '-6px', dy: '-4px'  },
  { top: '62%',  left: '-13%', size: 2,   color: '#60a5fa', dur: '3.7s', delay: '0.9s', dx: '-5px', dy: '4px'   },
  { top: '16%',  left: '108%', size: 2.5, color: '#a78bfa', dur: '3.1s', delay: '1.2s', dx: '6px',  dy: '-5px'  },
  { top: '68%',  left: '106%', size: 2,   color: '#7dd3fc', dur: '2.7s', delay: '0.4s', dx: '5px',  dy: '5px'   },
  { top: '104%', left: '26%',  size: 2,   color: '#c084fc', dur: '3.9s', delay: '0.7s', dx: '-3px', dy: '7px'   },
  { top: '107%', left: '70%',  size: 1.5, color: '#60a5fa', dur: '3.5s', delay: '1.4s', dx: '2px',  dy: '6px'   },
]
