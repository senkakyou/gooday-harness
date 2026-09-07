// utils/pageRange.js —— 生成带省略号的分页页码
// 返回如 [1, '…', 4, 5, 6, '…', 20]：首页 + 当前页±2 + 尾页
export default function pageRange(current, total) {
  const out = []
  const push = (p) => { if (!out.includes(p)) out.push(p) }
  push(1)
  for (let p = current - 2; p <= current + 2; p++) if (p >= 1 && p <= total) push(p)
  push(total)
  const withGaps = []
  for (let i = 0; i < out.length; i++) {
    if (i > 0 && out[i] - out[i - 1] > 1) withGaps.push('…')
    withGaps.push(out[i])
  }
  return withGaps
}
