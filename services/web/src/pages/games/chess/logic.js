// ─── 棋盘常量 ─────────────────────────────────────────────────────────────────
export const COLS = 9, ROWS = 10
export const CELL = 56, PAD = 36, PR = 21
export const BW = (COLS - 1) * CELL + PAD * 2   // 520
export const BH = (ROWS - 1) * CELL + PAD * 2   // 576
export const GC = '#8B6B1A'

export const px = c => PAD + c * CELL
export const py = r => PAD + r * CELL

const PIECE_LABEL = {
  K: ['帅','将'], A: ['仕','士'], E: ['相','象'],
  R: ['车','车'], H: ['马','马'], C: ['炮','炮'], P: ['兵','卒'],
}
export const pname = (type, side) => PIECE_LABEL[type]?.[side] ?? type

// ─── 初始布局 ─────────────────────────────────────────────────────────────────
export function initPieces() {
  let uid = 0
  const mk = (type, side, col, row) => ({ id: uid++, type, side, col, row, alive: true })
  return [
    mk('R',1,0,0), mk('H',1,1,0), mk('E',1,2,0), mk('A',1,3,0),
    mk('K',1,4,0), mk('A',1,5,0), mk('E',1,6,0), mk('H',1,7,0), mk('R',1,8,0),
    mk('C',1,1,2), mk('C',1,7,2),
    mk('P',1,0,3), mk('P',1,2,3), mk('P',1,4,3), mk('P',1,6,3), mk('P',1,8,3),
    mk('R',0,0,9), mk('H',0,1,9), mk('E',0,2,9), mk('A',0,3,9),
    mk('K',0,4,9), mk('A',0,5,9), mk('E',0,6,9), mk('H',0,7,9), mk('R',0,8,9),
    mk('C',0,1,7), mk('C',0,7,7),
    mk('P',0,0,6), mk('P',0,2,6), mk('P',0,4,6), mk('P',0,6,6), mk('P',0,8,6),
  ]
}

// ─── 棋盘工具 ─────────────────────────────────────────────────────────────────
export const getAt = (pieces, col, row) =>
  pieces.find(p => p.alive && p.col === col && p.row === row) ?? null

const inB = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS

const inPalace = (c, r, side) =>
  c >= 3 && c <= 5 && (side === 1 ? r >= 0 && r <= 2 : r >= 7 && r <= 9)

const crossed = (side, row) => side === 0 ? row <= 4 : row >= 5

// ─── 走法生成 ─────────────────────────────────────────────────────────────────
function rawMoves(pieces, piece) {
  const { type, side, col, row } = piece
  const opp = 1 - side
  const moves = []

  switch (type) {
    case 'K':
      for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const [nc, nr] = [col+dc, row+dr]
        if (!inPalace(nc, nr, side)) continue
        const t = getAt(pieces, nc, nr)
        if (!t || t.side === opp) moves.push([nc, nr])
      }
      break
    case 'A':
      for (const [dc, dr] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
        const [nc, nr] = [col+dc, row+dr]
        if (!inPalace(nc, nr, side)) continue
        const t = getAt(pieces, nc, nr)
        if (!t || t.side === opp) moves.push([nc, nr])
      }
      break
    case 'E':
      for (const [dc, dr] of [[2,2],[2,-2],[-2,2],[-2,-2]]) {
        const [nc, nr] = [col+dc, row+dr]
        if (!inB(nc, nr)) continue
        if (side === 0 && nr < 5) continue
        if (side === 1 && nr > 4) continue
        if (getAt(pieces, col+dc/2, row+dr/2)) continue
        const t = getAt(pieces, nc, nr)
        if (!t || t.side === opp) moves.push([nc, nr])
      }
      break
    case 'H':
      for (const [bc,br,dc,dr] of [
        [1,0,2,1],[1,0,2,-1],[-1,0,-2,1],[-1,0,-2,-1],
        [0,1,1,2],[0,1,-1,2],[0,-1,1,-2],[0,-1,-1,-2],
      ]) {
        if (getAt(pieces, col+bc, row+br)) continue
        const [nc, nr] = [col+dc, row+dr]
        if (!inB(nc, nr)) continue
        const t = getAt(pieces, nc, nr)
        if (!t || t.side === opp) moves.push([nc, nr])
      }
      break
    case 'R':
      for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        let [nc, nr] = [col+dc, row+dr]
        while (inB(nc, nr)) {
          const t = getAt(pieces, nc, nr)
          if (t) { if (t.side === opp) moves.push([nc, nr]); break }
          moves.push([nc, nr])
          nc += dc; nr += dr
        }
      }
      break
    case 'C':
      for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        let [nc, nr] = [col+dc, row+dr]
        let platform = false
        while (inB(nc, nr)) {
          const t = getAt(pieces, nc, nr)
          if (!platform) {
            if (t) platform = true
            else moves.push([nc, nr])
          } else {
            if (t) { if (t.side === opp) moves.push([nc, nr]); break }
          }
          nc += dc; nr += dr
        }
      }
      break
    case 'P': {
      const fwd = side === 0 ? -1 : 1
      const cr = crossed(side, row)
      const cands = [[col, row+fwd]]
      if (cr) cands.push([col-1, row], [col+1, row])
      for (const [nc, nr] of cands) {
        if (!inB(nc, nr)) continue
        const t = getAt(pieces, nc, nr)
        if (!t || t.side === opp) moves.push([nc, nr])
      }
      break
    }
    default: break
  }
  return moves
}

// ─── 将军检测 ─────────────────────────────────────────────────────────────────
export function inCheck(pieces, side) {
  const king = pieces.find(p => p.alive && p.type === 'K' && p.side === side)
  if (!king) return false
  const oppKing = pieces.find(p => p.alive && p.type === 'K' && p.side !== side)
  if (oppKing && oppKing.col === king.col) {
    const [r1, r2] = [Math.min(king.row, oppKing.row), Math.max(king.row, oppKing.row)]
    if (!pieces.some(p => p.alive && p.col === king.col && p.row > r1 && p.row < r2))
      return true
  }
  return pieces
    .filter(p => p.alive && p.side !== side)
    .some(p => rawMoves(pieces, p).some(([c,r]) => c === king.col && r === king.row))
}

export function applyMove(pieces, piece, tc, tr) {
  return pieces.map(p => {
    if (p.id === piece.id) return { ...p, col: tc, row: tr }
    if (p.alive && p.col === tc && p.row === tr && p.side !== piece.side)
      return { ...p, alive: false }
    return p
  })
}

export function legalMoves(pieces, piece) {
  return rawMoves(pieces, piece).filter(([tc, tr]) =>
    !inCheck(applyMove(pieces, piece, tc, tr), piece.side)
  )
}

export function hasLegalMoves(pieces, side) {
  return pieces.filter(p => p.alive && p.side === side)
    .some(p => legalMoves(pieces, p).length > 0)
}

// ─── AI ───────────────────────────────────────────────────────────────────────
const VAL = { K: 10000, R: 900, C: 500, H: 400, E: 220, A: 220, P: 120 }

function posBonus(p) {
  const r = p.side === 0 ? 9 - p.row : p.row
  if (p.type === 'P') return crossed(p.side, p.row) ? 60 + r * 15 : 0
  if (p.type === 'H') return (4 - Math.abs(p.col - 4)) * 6
  if (p.type === 'C') return (4 - Math.abs(p.col - 4)) * 3
  return 0
}

function evaluate(pieces, side) {
  return pieces.filter(p => p.alive).reduce((s, p) => {
    const v = (VAL[p.type] ?? 0) + posBonus(p)
    return s + (p.side === side ? v : -v)
  }, 0)
}

function minimax(pieces, depth, alpha, beta, maxing, side) {
  if (depth === 0) return evaluate(pieces, side)
  const cur = maxing ? side : 1 - side
  const all = []
  for (const p of pieces.filter(p => p.alive && p.side === cur))
    for (const [tc, tr] of legalMoves(pieces, p))
      all.push([p, tc, tr])
  if (all.length === 0) return maxing ? -9999 : 9999
  if (maxing) {
    let best = -Infinity
    for (const [p, tc, tr] of all) {
      best = Math.max(best, minimax(applyMove(pieces, p, tc, tr), depth-1, alpha, beta, false, side))
      alpha = Math.max(alpha, best)
      if (beta <= alpha) break
    }
    return best
  } else {
    let best = Infinity
    for (const [p, tc, tr] of all) {
      best = Math.min(best, minimax(applyMove(pieces, p, tc, tr), depth-1, alpha, beta, true, side))
      beta = Math.min(beta, best)
      if (beta <= alpha) break
    }
    return best
  }
}

export function aiThink(pieces, side, depth) {
  let best = -Infinity, bestMove = null
  for (const p of pieces.filter(p => p.alive && p.side === side)) {
    for (const [tc, tr] of legalMoves(pieces, p)) {
      const s = minimax(applyMove(pieces, p, tc, tr), depth-1, -Infinity, Infinity, false, side)
      if (s > best) { best = s; bestMove = [p, tc, tr] }
    }
  }
  return bestMove
}

// ─── 走棋记录格式化 ──────────────────────────────────────────────────────────
const COL_LABEL = ['一','二','三','四','五','六','七','八','九']
export function fmtLog(piece, toCol, toRow) {
  const n = pname(piece.type, piece.side)
  const fc = piece.side === 0 ? 8 - piece.col : piece.col
  const tc = piece.side === 0 ? 8 - toCol : toCol
  const dr = piece.side === 0 ? piece.row - toRow : toRow - piece.row
  return `${n}${COL_LABEL[fc]}${dr > 0 ? '进'+dr : dr < 0 ? '退'+Math.abs(dr) : '平'+COL_LABEL[tc]}`
}
