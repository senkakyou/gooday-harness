import React from 'react'
import { BW, BH, PAD, CELL, PR, GC, px, py, pname, getAt } from './logic'

function CrossMark({ cx, cy, left=true, right=true }) {
  const d = 4, L = 8
  return <>
    {left  && <line x1={cx-d-L} y1={cy-d} x2={cx-d} y2={cy-d} stroke={GC} strokeWidth={1}/>}
    {left  && <line x1={cx-d-L} y1={cy+d} x2={cx-d} y2={cy+d} stroke={GC} strokeWidth={1}/>}
    {left  && <line x1={cx-d}   y1={cy-d-L} x2={cx-d} y2={cy-d} stroke={GC} strokeWidth={1}/>}
    {left  && <line x1={cx-d}   y1={cy+d} x2={cx-d} y2={cy+d+L} stroke={GC} strokeWidth={1}/>}
    {right && <line x1={cx+d}   y1={cy-d} x2={cx+d+L} y2={cy-d} stroke={GC} strokeWidth={1}/>}
    {right && <line x1={cx+d}   y1={cy+d} x2={cx+d+L} y2={cy+d} stroke={GC} strokeWidth={1}/>}
    {right && <line x1={cx+d}   y1={cy-d-L} x2={cx+d} y2={cy-d} stroke={GC} strokeWidth={1}/>}
    {right && <line x1={cx+d}   y1={cy+d} x2={cx+d} y2={cy+d+L} stroke={GC} strokeWidth={1}/>}
  </>
}

// props: pieces, selected, hints, checkSide, lastMove, flip, onCellClick
export default function ChessBoard({ pieces, selected, hints, checkSide, lastMove, flip, onCellClick }) {
  const svgX = c => px(flip ? 8-c : c)
  const svgY = r => py(flip ? 9-r : r)
  const riverMidY = (svgY(flip?5:4) + svgY(flip?4:5)) / 2

  return (
    <svg viewBox={`0 0 ${BW} ${BH}`} width="100%"
      style={{ display:'block', cursor:'pointer', borderRadius:4, boxShadow:'0 4px 16px #0003' }}
      onClick={e => {
        const rect = e.currentTarget.getBoundingClientRect()
        const sx = BW / rect.width, sy = BH / rect.height
        let sc = Math.round(((e.clientX - rect.left) * sx - PAD) / CELL)
        let sr = Math.round(((e.clientY - rect.top) * sy - PAD) / CELL)
        sc = Math.max(0, Math.min(8, sc))
        sr = Math.max(0, Math.min(9, sr))
        onCellClick(flip ? 8-sc : sc, flip ? 9-sr : sr)
      }}
    >
      <rect x={0} y={0} width={BW} height={BH} fill="#D4A96A" rx={4}/>

      <rect x={PAD-14} y={PAD-14} width={(9-1)*CELL+28} height={(10-1)*CELL+28}
        fill="none" stroke={GC} strokeWidth={3} rx={3}/>
      <rect x={PAD-8} y={PAD-8} width={(9-1)*CELL+16} height={(10-1)*CELL+16}
        fill="none" stroke={GC} strokeWidth={1.5} rx={2}/>

      {Array.from({length:10},(_,r) => r).filter(r=>r!==4&&r!==5).map(r=>(
        <line key={`h${r}`} x1={px(0)} y1={py(r)} x2={px(8)} y2={py(r)} stroke={GC} strokeWidth={1}/>
      ))}
      {Array.from({length:9},(_,c)=>(
        <React.Fragment key={`v${c}`}>
          <line x1={px(c)} y1={py(0)} x2={px(c)} y2={py(4)} stroke={GC} strokeWidth={1}/>
          <line x1={px(c)} y1={py(5)} x2={px(c)} y2={py(9)} stroke={GC} strokeWidth={1}/>
          {(c===0||c===8) && <line x1={px(c)} y1={py(4)} x2={px(c)} y2={py(5)} stroke={GC} strokeWidth={1}/>}
        </React.Fragment>
      ))}

      <line x1={px(3)} y1={py(0)} x2={px(5)} y2={py(2)} stroke={GC} strokeWidth={1}/>
      <line x1={px(5)} y1={py(0)} x2={px(3)} y2={py(2)} stroke={GC} strokeWidth={1}/>
      <line x1={px(3)} y1={py(7)} x2={px(5)} y2={py(9)} stroke={GC} strokeWidth={1}/>
      <line x1={px(5)} y1={py(7)} x2={px(3)} y2={py(9)} stroke={GC} strokeWidth={1}/>

      <rect x={px(0)} y={py(4)+1} width={px(8)-px(0)} height={py(5)-py(4)-2}
        fill="#C49555" opacity={0.5}/>
      <text x={(px(0)+px(8))*0.25} y={riverMidY+6}
        textAnchor="middle" fontSize={20} fontFamily="serif"
        fontWeight="bold" fill="#7A4B16" opacity={0.9} style={{userSelect:'none'}}>楚 河</text>
      <text x={(px(0)+px(8))*0.75} y={riverMidY+6}
        textAnchor="middle" fontSize={20} fontFamily="serif"
        fontWeight="bold" fill="#7A4B16" opacity={0.9} style={{userSelect:'none'}}>汉 界</text>

      {[[0,3],[2,3],[4,3],[6,3],[8,3],[0,6],[2,6],[4,6],[6,6],[8,6]].map(([c,r],i)=>(
        <CrossMark key={i} cx={px(c)} cy={py(r)} left={c>0} right={c<8}/>
      ))}
      {[[1,2],[7,2],[1,7],[7,7]].map(([c,r],i)=>(
        <CrossMark key={`p${i}`} cx={px(c)} cy={py(r)} left right/>
      ))}

      {lastMove && (
        <>
          <rect
            x={svgX(lastMove.fromCol) - PR + 2} y={svgY(lastMove.fromRow) - PR + 2}
            width={(PR-2)*2} height={(PR-2)*2} rx={4}
            fill="#FFD70030" stroke="#FFD70070" strokeWidth={1.5}/>
        </>
      )}

      {hints.map(([c,r],i)=>{
        const t = getAt(pieces, c, r)
        return t ? (
          <circle key={i} cx={svgX(c)} cy={svgY(r)} r={PR+3}
            fill="none" stroke="#22CC55" strokeWidth={3} opacity={0.7}/>
        ) : (
          <circle key={i} cx={svgX(c)} cy={svgY(r)} r={7}
            fill="#22CC55" opacity={0.5}/>
        )
      })}

      {pieces.filter(p=>p.alive).map(p=>{
        const x = svgX(p.col), y = svgY(p.row)
        const isSel = p.id === selected
        const isRed = p.side === 0
        const isKingCheck = checkSide === p.side && p.type === 'K'
        const isLastMoved = p.id === lastMove?.pieceId
        return (
          <g key={p.id}>
            {isLastMoved && !isSel && (
              <circle cx={x} cy={y} r={PR+7}
                fill="none" stroke="#00CCFF" strokeWidth={2.5} opacity={0.8}/>
            )}
            {(isSel || isKingCheck) && (
              <circle cx={x} cy={y} r={PR+5}
                fill={isSel?'#FFD70033':'#FF222222'}
                stroke={isSel?'#FFD700':'#FF2222'}
                strokeWidth={2.5}/>
            )}
            <circle cx={x+2} cy={y+2.5} r={PR} fill="#00000025"/>
            <circle cx={x} cy={y} r={PR}
              fill="#EDD28A"
              stroke={isRed?'#9B3010':'#3A2200'}
              strokeWidth={isSel?2.5:1.8}/>
            <circle cx={x} cy={y} r={PR-5}
              fill="none"
              stroke={isRed?'#CC1100':'#2A1800'}
              strokeWidth={1} opacity={0.45}/>
            <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
              fontSize={17} fontWeight="bold" fontFamily="'Noto Serif SC',serif"
              fill={isRed?'#CC1100':'#1A0900'}
              style={{userSelect:'none', pointerEvents:'none'}}>
              {pname(p.type, p.side)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
