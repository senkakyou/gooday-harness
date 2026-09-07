import React from 'react'
import { N, CELL, PAD, SR, BOARD_PX, STAR_POINTS } from './logic'

// props: board, canPlace, lastMove, onPlace
export default function GomokuBoard({ board, canPlace, lastMove, onPlace }) {
  const scale = Math.min(1, (window.innerWidth - 32) / BOARD_PX)
  const boardSize = Math.round(BOARD_PX * scale)

  return (
    <div style={{
      width: boardSize, height: boardSize,
      overflow: 'hidden', userSelect: 'none', flexShrink: 0,
    }}>
      <div style={{
        position: 'relative',
        width: BOARD_PX, height: BOARD_PX,
        background: '#C8941A',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
        transformOrigin: 'top left',
        transform: `scale(${scale})`,
      }}>
        <svg style={{ position:'absolute', inset:0, pointerEvents:'none' }} width={BOARD_PX} height={BOARD_PX}>
          {Array.from({length: N}, (_, i) => (
            <line key={`h${i}`}
              x1={PAD} y1={PAD+i*CELL} x2={PAD+(N-1)*CELL} y2={PAD+i*CELL}
              stroke="rgba(0,0,0,0.6)" strokeWidth={0.8} />
          ))}
          {Array.from({length: N}, (_, i) => (
            <line key={`v${i}`}
              x1={PAD+i*CELL} y1={PAD} x2={PAD+i*CELL} y2={PAD+(N-1)*CELL}
              stroke="rgba(0,0,0,0.6)" strokeWidth={0.8} />
          ))}
          {STAR_POINTS.map(([c,r]) => (
            <circle key={`sp${c}${r}`} cx={PAD+c*CELL} cy={PAD+r*CELL} r={3.5} fill="rgba(0,0,0,0.55)" />
          ))}
        </svg>

        {Array.from({length: N}, (_, r) =>
          Array.from({length: N}, (_, c) => (
            <div key={`hit${c},${r}`}
              onClick={() => canPlace && board[r][c] === null && onPlace(c, r)}
              style={{
                position: 'absolute',
                left: PAD + c*CELL - CELL/2,
                top:  PAD + r*CELL - CELL/2,
                width: CELL, height: CELL,
                cursor: canPlace && board[r][c] === null ? 'pointer' : 'default',
                zIndex: 2,
              }}
            />
          ))
        )}

        {Array.from({length: N}, (_, r) =>
          Array.from({length: N}, (_, c) => {
            const stone = board[r][c]
            if (stone === null) return null
            const isLast = lastMove?.col === c && lastMove?.row === r
            return (
              <div key={`stone${c},${r}`} style={{
                position: 'absolute',
                left: PAD + c*CELL - SR,
                top:  PAD + r*CELL - SR,
                width: SR*2, height: SR*2,
                borderRadius: '50%',
                background: stone === 0
                  ? 'radial-gradient(circle at 38% 32%, #666, #0a0a0a)'
                  : 'radial-gradient(circle at 38% 32%, #fff, #c8c8c8)',
                border: stone === 0 ? '1px solid #111' : '1px solid #aaa',
                boxShadow: isLast ? '0 0 0 2.5px #FF4400, 1px 2px 6px rgba(0,0,0,0.55)' : '1px 2px 6px rgba(0,0,0,0.55)',
                zIndex: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {isLast && (
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: stone === 0 ? '#FF6600' : '#CC0000',
                  }} />
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
