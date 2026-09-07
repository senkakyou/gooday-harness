// 学科图标视觉：每个学科按 id 映射一个稳定的专属主色（配色方案见论坛 #48 设计稿）。
// 用于深色渐变卡片 + 悬浮发光，统一视觉、便于识别。

const PALETTE = [
  '#10b981', // emerald
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f59e0b', // amber
  '#84cc16', // lime
  '#14b8a6', // teal
  '#06b6d4', // cyan
]

// 稳定取色：同一 id 永远同一主色
export function subjectColor(s) {
  const id = (s && Number(s.id)) || 0
  return PALETTE[Math.abs(id) % PALETTE.length]
}

// #RRGGBB + alpha → rgba()
export function withAlpha(hex, a) {
  const h = (hex || '#000000').replace('#', '')
  const n = parseInt(h, 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return `rgba(${r},${g},${b},${a})`
}

// 朝白色提亮 amt(0~1)，用于图标顶部高光渐变，营造 3D 光泽
export function lighten(hex, amt) {
  const h = (hex || '#000000').replace('#', '')
  const n = parseInt(h, 16)
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  r = Math.round(r + (255 - r) * amt)
  g = Math.round(g + (255 - g) * amt)
  b = Math.round(b + (255 - b) * amt)
  return `rgb(${r},${g},${b})`
}
