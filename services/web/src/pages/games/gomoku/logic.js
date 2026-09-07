export const N    = 15
export const CELL = 36
export const PAD  = 22
export const SR   = 15
export const BOARD_PX = (N - 1) * CELL + PAD * 2

export const STAR_POINTS = [[3,3],[3,11],[7,7],[11,3],[11,11]]

export function initBoard() {
  return Array.from({ length: N }, () => Array(N).fill(null))
}

export function checkWin(board, col, row, side) {
  const dirs = [[1,0],[0,1],[1,1],[1,-1]]
  for (const [dc, dr] of dirs) {
    let cnt = 1
    for (let i = 1; i <= 4; i++) {
      const c = col+dc*i, r = row+dr*i
      if (c<0||c>=N||r<0||r>=N||board[r][c]!==side) break
      cnt++
    }
    for (let i = 1; i <= 4; i++) {
      const c = col-dc*i, r = row-dr*i
      if (c<0||c>=N||r<0||r>=N||board[r][c]!==side) break
      cnt++
    }
    if (cnt >= 5) return true
  }
  return false
}

function evalCell(board, col, row, side) {
  const opp = 1 - side
  let score = 0
  const dirs = [[1,0],[0,1],[1,1],[1,-1]]
  for (const [dc, dr] of dirs) {
    for (const who of [side, opp]) {
      let cnt = 1, open = 0
      for (const sign of [1, -1]) {
        for (let i = 1; i <= 5; i++) {
          const c = col+dc*sign*i, r = row+dr*sign*i
          if (c<0||c>=N||r<0||r>=N) break
          if (board[r][c] === who) cnt++
          else { if (board[r][c] === null) open++; break }
        }
      }
      const weight = who === side ? 1.0 : 0.92
      const s = cnt >= 5 ? 1e7
              : cnt === 4 ? (open > 0 ? 5e4 : 5e3)
              : cnt === 3 ? (open === 2 ? 5e3 : 500)
              : cnt === 2 ? (open === 2 ? 500  : 50)
              : 10
      score += s * weight
    }
  }
  return score
}

export function aiMove(board, side, level) {
  const mid = Math.floor(N / 2)
  let hasStone = false
  for (let r = 0; r < N && !hasStone; r++)
    for (let c = 0; c < N && !hasStone; c++)
      if (board[r][c] !== null) hasStone = true
  if (!hasStone) {
    const off = level <= 3 ? (Math.floor(Math.random()*3)-1) : 0
    return [mid+off, mid+(level<=3?Math.floor(Math.random()*3)-1:0)]
  }

  const cands = []
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (board[r][c] !== null) continue
      let near = false
      for (let dr = -2; dr <= 2 && !near; dr++)
        for (let dc = -2; dc <= 2 && !near; dc++)
          if (r+dr>=0&&r+dr<N&&c+dc>=0&&c+dc<N&&board[r+dr][c+dc]!==null) near=true
      if (!near) continue
      cands.push({ c, r, score: evalCell(board, c, r, side) })
    }
  }
  if (!cands.length) return [mid, mid]

  const noise = level <= 2 ? 1e6 : level <= 4 ? 1e4 : level <= 6 ? 1e2 : 0
  if (noise > 0) cands.forEach(cd => cd.score += Math.random() * noise)
  cands.sort((a, b) => b.score - a.score)

  const pickFrom = Math.min(cands.length, level <= 3 ? 8 : level <= 6 ? 3 : 1)
  const { c, r } = cands[Math.floor(Math.random() * pickFrom)]
  return [c, r]
}
