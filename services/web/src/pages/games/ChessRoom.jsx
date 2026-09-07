import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as signalR from '@microsoft/signalr'
import useAuthStore from '../../store/authStore'
import { recordResult } from '../../api/games'
import {
  BW, initPieces, getAt, legalMoves, inCheck, applyMove,
  hasLegalMoves, aiThink, fmtLog,
} from './chess/logic'
import ChessBoard from './chess/ChessBoard'

export default function ChessRoom() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const user = useAuthStore(s => s.user)
  const mode = params.get('mode') || 'pve'
  const aiDepth = parseInt(params.get('level') || '2')

  const [pieces, setPieces]       = useState(initPieces)
  const [selected, setSelected]   = useState(null)
  const [hints, setHints]         = useState([])
  const [turn, setTurn]           = useState(0)
  const [mySide, setMySide]       = useState(0)
  const [status, setStatus]       = useState('playing')
  const [winner, setWinner]       = useState(null)
  const [checkSide, setCheckSide] = useState(null)
  const [moveLog, setMoveLog]     = useState([])
  const [aiWorking, setAiWorking] = useState(false)

  const [lastMove, setLastMove]  = useState(null)

  const [pvpPhase, setPvpPhase] = useState('lobby')
  const [tables, setTables]     = useState([])
  const [tableId, setTableId]   = useState(null)
  const [oppName, setOppName]   = useState('')
  const connRef   = useRef(null)
  const piecesRef = useRef(pieces)
  useEffect(() => { piecesRef.current = pieces }, [pieces])

  // ── SignalR（PvP）────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'pvp') return
    const token = localStorage.getItem('token')
    const hub = new signalR.HubConnectionBuilder()
      .withUrl('/hubs/game', token ? { accessTokenFactory: () => token } : {})
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build()
    connRef.current = hub

    hub.on('TableList',    list => setTables(list.filter(t => t.gameType === 'chess')))
    hub.on('TableUpdated', t    => { if (t.gameType === 'chess') setTables(p => p.map(x => x.id===t.id?t:x)) })
    hub.on('YouSat', ({ tableId: tid, seatIndex }) => { setTableId(tid); setMySide(seatIndex); setPvpPhase('waiting') })
    hub.on('ChessStarted', ({ yourSide, opponentName: on }) => {
      setMySide(yourSide); setOppName(on)
      setPieces(initPieces()); setTurn(0); setSelected(null); setHints([])
      setStatus('playing'); setWinner(null); setCheckSide(null); setMoveLog([])
      setLastMove(null); setPvpPhase('playing')
    })
    hub.on('ChessMoveResult', ({ pieceId, toCol, toRow, capturedId, nextTurn, checkSide: cs, winnerSide, winnerUsername }) => {
      setPieces(prev => {
        const moved = prev.find(p => p.id === pieceId)
        if (moved) setLastMove({ pieceId, fromCol: moved.col, fromRow: moved.row })
        return prev.map(p => {
          if (p.id === pieceId) return { ...p, col: toCol, row: toRow }
          if (capturedId != null && p.id === capturedId) return { ...p, alive: false }
          return p
        })
      })
      setTurn(nextTurn)
      setCheckSide(cs ?? null)
      setSelected(null); setHints([])
      if (winnerSide != null) {
        setWinner({ side: winnerSide, username: winnerUsername })
        setStatus('ended')
      }
    })
    hub.on('OpponentLeft', () => { setWinner({ side: mySide, username: user?.username??'' }); setStatus('ended') })
    hub.on('GameEnded',   ({ winnerSide, winnerUsername }) => { setWinner({ side: winnerSide, username: winnerUsername }); setStatus('ended') })

    hub.start().then(() => hub.invoke('JoinLobby', 'chess'))
    return () => hub.stop()
  }, [mode])

  // ── AI 回合 ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'pve' || status !== 'playing' || turn === mySide) return
    setAiWorking(true)
    const t = setTimeout(() => {
      const move = aiThink(piecesRef.current, 1 - mySide, aiDepth)
      if (move) execMove(move[0], move[1], move[2])
      else { setWinner({ side: mySide, username: user?.username??'玩家' }); setStatus('ended') }
      setAiWorking(false)
    }, 80)
    return () => clearTimeout(t)
  }, [turn, status, mode])

  // ── 执行落子 ─────────────────────────────────────────────────────────────────
  function execMove(piece, tc, tr) {
    setLastMove({ pieceId: piece.id, fromCol: piece.col, fromRow: piece.row })
    setPieces(prev => {
      const next = applyMove(prev, piece, tc, tr)
      const nt = 1 - piece.side
      setCheckSide(inCheck(next, nt) ? nt : null)
      setMoveLog(l => [...l.slice(-29), { side: piece.side, text: fmtLog(piece, tc, tr) }])
      if (!hasLegalMoves(next, nt)) {
        setWinner({ side: piece.side, username: piece.side === mySide ? (user?.username??'玩家') : 'AI' })
        setStatus('ended')
        if (mode === 'pve') recordResult('chess','pve', piece.side === mySide).catch(()=>{})
      } else {
        setTurn(nt)
      }
      return next
    })
    setSelected(null); setHints([])
  }

  // ── 点击棋盘 ─────────────────────────────────────────────────────────────────
  function handleClick(col, row) {
    if (status !== 'playing' || turn !== mySide) return
    if (mode === 'pve' && aiWorking) return

    const clicked = getAt(pieces, col, row)
    if (selected !== null) {
      const selPiece = pieces.find(p => p.id === selected)
      if (hints.some(([c,r]) => c===col && r===row) && selPiece) {
        if (mode === 'pvp') connRef.current?.invoke('ChessMove', selected, col, row)
        else execMove(selPiece, col, row)
        return
      }
    }
    if (clicked && clicked.side === mySide) {
      setSelected(clicked.id)
      setHints(legalMoves(pieces, clicked))
    } else {
      setSelected(null); setHints([])
    }
  }

  function handleSurrender() {
    if (mode === 'pvp') connRef.current?.invoke('Surrender')
    else { setWinner({ side: 1-mySide, username: 'AI' }); setStatus('ended') }
  }

  function handleRestart() {
    setPieces(initPieces()); setTurn(0); setSelected(null); setHints([])
    setStatus('playing'); setWinner(null); setCheckSide(null); setMoveLog([])
    setLastMove(null)
  }

  const flip = mySide === 1

  // ── PvP 大厅 ──────────────────────────────────────────────────────────────────
  if (mode === 'pvp' && pvpPhase === 'lobby') {
    return (
      <div style={{ maxWidth:700, margin:'2rem auto', padding:'0 1rem' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'1rem', marginBottom:'1.5rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/games')}>← 返回</button>
          <h2 style={{ fontWeight:700, fontSize:'1.3rem' }}>中国象棋 · 联机大厅</h2>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(210px,1fr))', gap:'0.75rem' }}>
          {tables.map(t => (
            <div key={t.id} style={{
              background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:10, padding:'1rem', display:'flex', flexDirection:'column', gap:'0.5rem'
            }}>
              <div style={{ fontWeight:600, fontSize:13 }}>棋桌 {t.id}</div>
              {[0,1].map(si => (
                <div key={si} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:12, color:'var(--muted)' }}>
                    {si===0 ? '🔴 红方' : '⚫ 黑方'}：
                    {(si===0 ? t.seat0 : t.seat1)?.username ?? '空位'}
                  </span>
                  {!(si===0?t.seat0:t.seat1) && t.state!=='playing' && (
                    <button className="btn btn-primary" style={{ fontSize:11, padding:'2px 8px' }}
                      onClick={() => connRef.current?.invoke('SitDown','chess',t.id,si)}>
                      入座
                    </button>
                  )}
                </div>
              ))}
              <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>
                {t.state==='playing'?'对局中':t.state==='open'?'等待中':'准备中'}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (mode === 'pvp' && pvpPhase === 'waiting') {
    return (
      <div style={{ maxWidth:360, margin:'5rem auto', textAlign:'center', padding:'0 1rem' }}>
        <div style={{ fontSize:56 }}>♟</div>
        <h3 style={{ marginTop:'1rem', fontWeight:700 }}>等待对手入座…</h3>
        <p style={{ color:'var(--muted)', fontSize:13 }}>棋桌 {tableId}</p>
        <button className="btn btn-ghost btn-sm" style={{ marginTop:'1.5rem' }}
          onClick={() => { connRef.current?.invoke('StandUp'); setPvpPhase('lobby') }}>
          取消
        </button>
      </div>
    )
  }

  // ── 对局页 ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth:860, margin:'0 auto', padding:'1rem', display:'flex', gap:'1.5rem', flexWrap:'wrap', justifyContent:'center' }}>

      {/* 左：棋盘区 */}
      <div style={{ flex:'1 1 auto', minWidth:0, maxWidth: BW }}>
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'0.6rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/games')}>← 返回</button>
          <span style={{ fontWeight:700 }}>中国象棋</span>
          {mode==='pve' && (
            <span style={{ fontSize:11, color:'var(--muted)', background:'var(--surface2)', padding:'2px 8px', borderRadius:4 }}>
              人机对战 Lv.{aiDepth}
            </span>
          )}
          {aiWorking && <span style={{ fontSize:12, color:'var(--accent)' }}>AI 思考中…</span>}
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', padding:'0 2px', marginBottom:4 }}>
          <span style={{ fontSize:13, fontWeight:600 }}>
            {flip ? '🔴 红方' : '⚫ 黑方'}
            {mode==='pvp' ? `：${oppName}` : '：AI'}
            {turn!==mySide && status==='playing' && (
              <span style={{ color:'var(--accent)', marginLeft:6, fontSize:11 }}>行棋中</span>
            )}
          </span>
          {checkSide === (flip?0:1) && (
            <span style={{ color:'#e44', fontSize:12, fontWeight:700 }}>⚠ 将军！</span>
          )}
        </div>

        <ChessBoard
          pieces={pieces}
          selected={selected}
          hints={hints}
          checkSide={checkSide}
          lastMove={lastMove}
          flip={flip}
          onCellClick={handleClick}
        />

        <div style={{ display:'flex', justifyContent:'space-between', padding:'0 2px', marginTop:4 }}>
          <span style={{ fontSize:13, fontWeight:600 }}>
            {flip ? '⚫ 黑方' : '🔴 红方'}
            {mode==='pvp' ? `：${user?.username??'我'}` : '：玩家'}
            {turn===mySide && status==='playing' && (
              <span style={{ color:'var(--accent)', marginLeft:6, fontSize:11 }}>← 你的回合</span>
            )}
          </span>
          {checkSide === mySide && (
            <span style={{ color:'#e44', fontSize:12, fontWeight:700 }}>⚠ 将军！</span>
          )}
        </div>

        <div style={{ display:'flex', gap:'0.5rem', marginTop:'0.75rem', flexWrap:'wrap' }}>
          {status==='playing' && (
            <button className="btn btn-ghost btn-sm" onClick={handleSurrender}>🏳 投降</button>
          )}
          {status==='ended' && mode==='pve' && (
            <button className="btn btn-primary btn-sm" onClick={handleRestart}>再来一局</button>
          )}
          {status==='ended' && mode==='pvp' && (
            <button className="btn btn-ghost btn-sm" onClick={()=>navigate('/games')}>返回大厅</button>
          )}
          {mode==='pve' && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={()=>navigate('/games/chess?mode=pve&level=1')}>简单</button>
              <button className="btn btn-ghost btn-sm" onClick={()=>navigate('/games/chess?mode=pve&level=2')}>中等</button>
              <button className="btn btn-ghost btn-sm" onClick={()=>navigate('/games/chess?mode=pve&level=3')}>困难</button>
            </>
          )}
        </div>
      </div>

      {/* 右：信息面板 */}
      <div style={{ flex:'1 1 180px', maxWidth:260, display:'flex', flexDirection:'column', gap:'0.75rem' }}>
        {status==='ended' && winner && (
          <div style={{
            background: winner.side===mySide?'#22CC4418':'#CC222218',
            border:`2px solid ${winner.side===mySide?'#22CC44':'#CC2222'}`,
            borderRadius:8, padding:'0.9rem', textAlign:'center'
          }}>
            <div style={{fontSize:36}}>{winner.side===mySide?'🏆':'💀'}</div>
            <div style={{fontWeight:700, marginTop:4}}>
              {winner.side===mySide?'你赢了！':'对手获胜'}
            </div>
            <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>{winner.username}</div>
          </div>
        )}

        {status==='playing' && (
          <div style={{
            background:'var(--surface)', border:'1px solid var(--border)',
            borderRadius:8, padding:'0.75rem', textAlign:'center'
          }}>
            <div style={{fontSize:11,color:'var(--muted)',marginBottom:6}}>当前行棋</div>
            <div style={{
              width:34, height:34, borderRadius:'50%', margin:'0 auto',
              background: turn===0?'#CC1100':'#1A0900',
              border:'3px solid #EDD28A',
              boxShadow: turn===0?'0 0 8px #CC110066':'0 0 8px #33333366',
            }}/>
            <div style={{fontSize:13,fontWeight:600,marginTop:6,
              color: turn===0?'#CC1100':'var(--fg)'}}>
              {turn===0?'红方':'黑方'}
              {turn===mySide?'（你）': mode==='pve'?'（AI）':`（${oppName}）`}
            </div>
          </div>
        )}

        <div style={{
          background:'var(--surface)', border:'1px solid var(--border)',
          borderRadius:8, padding:'0.75rem', flex:1, minHeight:200
        }}>
          <div style={{fontSize:11,color:'var(--muted)',marginBottom:6}}>走棋记录</div>
          <div style={{ display:'flex', flexDirection:'column', gap:3, maxHeight:320, overflowY:'auto' }}>
            {moveLog.length===0
              ? <span style={{fontSize:12,color:'var(--muted)'}}>暂无记录</span>
              : [...moveLog].reverse().map((m,i)=>(
                <span key={i} style={{
                  fontSize:12, fontFamily:'var(--mono)',
                  color: i===0?'var(--fg)':'var(--muted)',
                  paddingLeft: 4,
                  borderLeft: `2px solid ${m.side===0?'#CC1100':'var(--muted)'}`,
                }}>
                  {m.side===0?'红':'黑'} {m.text}
                </span>
              ))
            }
          </div>
        </div>

        <div style={{
          background:'var(--surface)', border:'1px solid var(--border)',
          borderRadius:8, padding:'0.75rem'
        }}>
          <div style={{fontSize:11,color:'var(--muted)',marginBottom:6}}>棋子速查</div>
          {[['车','直线任意'],['炮','跳一子吃'],['马','日字跳'],
            ['兵','过河可横走'],['象','田字不过河'],['仕','九宫斜走']].map(([n,d])=>(
            <div key={n} style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:2}}>
              <span style={{fontWeight:600}}>{n}</span>
              <span style={{color:'var(--muted)'}}>{d}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
