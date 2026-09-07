import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as signalR from '@microsoft/signalr'
import useAuthStore from '../../store/authStore'
import { confirmDialog } from '../../store/confirmStore'
import { recordResult } from '../../api/games'
import { N, initBoard, checkWin, aiMove } from './gomoku/logic'
import GomokuBoard from './gomoku/GomokuBoard'
import TableCard from './gomoku/TableCard'

export default function GomokuRoom() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const mode = searchParams.get('mode') || 'pvp'
  const user = useAuthStore(s => s.user)

  const connRef = useRef(null)
  const [connected, setConnected] = useState(false)
  const [tables,    setTables]    = useState([])
  const [mySeat,    setMySeat]    = useState(null)

  const [phase,        setPhase]        = useState('lobby')
  const [mySide,       setMySide]       = useState(1)
  const [opponentName, setOpponentName] = useState('')
  const [currentTurn,  setCurrentTurn]  = useState(0)
  const [winner,       setWinner]       = useState(null)
  const [winReason,    setWinReason]    = useState('')
  const [msg,          setMsg]          = useState('')
  const [aiLevel,      setAiLevel]      = useState(5)

  const [board,    setBoard]    = useState(initBoard)
  const boardRef = useRef(board)
  boardRef.current = board

  const [lastMove, setLastMove] = useState(null)
  const aiTimer   = useRef(null)
  const mySideRef = useRef(mySide)
  mySideRef.current = mySide

  // ── SignalR ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'pvp') return
    const token = localStorage.getItem('token')
    const conn = new signalR.HubConnectionBuilder()
      .withUrl('/hubs/game', token ? { accessTokenFactory: () => token } : {})
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build()

    conn.on('TableList',    list    => setTables(list))
    conn.on('TableUpdated', updated => setTables(prev => prev.map(t => t.id === updated.id ? updated : t)))
    conn.on('YouSat', ({ tableId, seatIndex }) => setMySeat({ tableId, seatIndex }))

    conn.on('GomokuStarted', ({ yourSide, firstTurn, opponentName: oName }) => {
      setMySide(yourSide); mySideRef.current = yourSide
      setOpponentName(oName)
      setBoard(initBoard()); setLastMove(null)
      setPhase('playing'); setCurrentTurn(firstTurn)
      setMsg(firstTurn === yourSide ? '你先走（黑棋）' : '等待对手先走（黑棋）…')
    })

    conn.on('GomokuRejoined', ({ yourSide, opponentName: oName, currentTurn: ct, board: bMap }) => {
      const nb = initBoard()
      Object.entries(bMap).forEach(([key, side]) => {
        const [c, r] = key.split(',').map(Number)
        nb[r][c] = side
      })
      setMySide(yourSide); mySideRef.current = yourSide
      setOpponentName(oName)
      setBoard(nb); setLastMove(null)
      setPhase('playing'); setCurrentTurn(ct)
      setMsg(ct === yourSide ? '轮到你落子' : '等待对手落子…')
    })

    conn.on('StoneResult', ({ col, row, side, currentTurn: ct, winnerSide, winnerUsername }) => {
      setBoard(prev => { const nb = prev.map(r => [...r]); nb[row][col] = side; return nb })
      setLastMove({ col, row })
      if (winnerSide != null) {
        const iWon = winnerSide === mySideRef.current
        setPhase('ended'); setWinner(winnerSide)
        setMsg(iWon ? '你获胜了！' : `${winnerUsername} 获胜`)
        recordResult('gomoku', 'pvp', iWon).catch(() => {})
      } else if (ct != null) {
        setCurrentTurn(ct)
        setMsg(ct === mySideRef.current ? '轮到你落子' : '对手落子中…')
      }
    })

    conn.on('GameEnded', d => {
      const myS = mySideRef.current
      setPhase('ended'); setWinner(d.winnerSide); setWinReason(d.reason || '')
      setMsg(d.winnerSide === myS ? '你获胜了！' : `${d.winnerUsername} 获胜`)
      recordResult('gomoku', 'pvp', d.winnerSide === myS).catch(() => {})
    })

    conn.on('OpponentLeft', () => {
      setPhase('ended'); setWinner(mySideRef.current); setMsg('对手已离开，你获胜！')
    })

    conn.onclose(() => setConnected(false))
    conn.onreconnected(() => {
      setConnected(true); setMySeat(null)
      conn.invoke('JoinLobby', 'gomoku').catch(() => {})
    })
    conn.start()
      .then(() => { setConnected(true); conn.invoke('JoinLobby', 'gomoku').catch(() => {}) })
      .catch(() => setConnected(false))

    connRef.current = conn
    return () => conn.stop()
  }, [mode])

  const invoke = (method, ...args) => {
    if (!connRef.current || !connected) return
    connRef.current.invoke(method, ...args).catch(e => setMsg(`操作失败：${e.message}`))
  }

  // ── PvE 开始 ─────────────────────────────────────────────────────────────
  function startPVE() {
    setMySide(1); mySideRef.current = 1
    setOpponentName(`AI Lv.${aiLevel}`)
    setBoard(initBoard()); setLastMove(null)
    setPhase('playing'); setCurrentTurn(0)
    setMsg(`AI Lv.${aiLevel} 先落子（黑棋）…`)
  }

  // ── 落子 ─────────────────────────────────────────────────────────────────
  function handlePlace(col, row) {
    if (phase !== 'playing' || currentTurn !== mySide) return
    if (board[row][col] !== null) return

    if (mode === 'pvp') { invoke('PlaceStone', col, row); return }

    const nb = board.map(r => [...r])
    nb[row][col] = mySide
    setBoard(nb); setLastMove({ col, row })

    if (checkWin(nb, col, row, mySide)) {
      setPhase('ended'); setWinner(mySide); setMsg('你获胜了！')
      recordResult('gomoku', 'pve', true).catch(() => {})
      return
    }
    let full = true
    for (let r = 0; r < N && full; r++)
      for (let c = 0; c < N && full; c++)
        if (nb[r][c] === null) full = false
    if (full) { setPhase('ended'); setWinner(-1); setMsg('平局！棋盘已满'); return }

    setCurrentTurn(1 - mySide); setMsg('AI走棋中…')
  }

  // ── AI 走棋 ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'pve' || phase !== 'playing' || currentTurn === mySide) return
    const aiSide = 1 - mySide
    aiTimer.current = setTimeout(() => {
      const b = boardRef.current
      const move = aiMove(b, aiSide, aiLevel)
      if (!move) return
      const [col, row] = move
      const nb = b.map(r => [...r])
      nb[row][col] = aiSide
      setBoard(nb); setLastMove({ col, row })

      if (checkWin(nb, col, row, aiSide)) {
        setPhase('ended'); setWinner(aiSide); setMsg('AI获胜！')
        recordResult('gomoku', 'pve', false).catch(() => {})
        return
      }
      setCurrentTurn(mySide); setMsg('轮到你落子')
    }, 300 + Math.random() * 500)
    return () => clearTimeout(aiTimer.current)
  }, [currentTurn, phase, mode, mySide, aiLevel])

  // ── 投降 / 返回 ───────────────────────────────────────────────────────────
  function surrender() {
    if (mode === 'pvp') { invoke('Surrender'); recordResult('gomoku', 'pvp', false).catch(() => {}) }
    else { setPhase('ended'); setWinner(1 - mySide); setMsg('你投降了。') }
  }

  function returnToLobby() {
    if (mode === 'pvp' && mySeat) invoke('StandUp')
    setPhase('lobby'); setBoard(initBoard()); setWinner(null); setWinReason('')
    setMsg(''); setLastMove(null); setMySeat(null)
  }

  const isMyTurn = phase === 'playing' && currentTurn === mySide

  // ── 渲染 ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/games')}>← 返回</button>
        <h2 style={{ fontWeight: 700, flex: 1 }}>五子棋对战室</h2>
        {mode === 'pvp' && (
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4,
            background: connected ? '#0a3a1a' : '#3a0a0a', color: connected ? '#4f4' : '#f44', fontFamily: 'var(--mono)' }}>
            {connected ? '● 已连接' : '○ 连接中'}
          </span>
        )}
        {mode === 'pvp' && phase === 'lobby' && (
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/games/gomoku?mode=pve')}>挑战AI</button>
        )}
      </div>

      {/* 状态条 */}
      {msg && (
        <div style={{ padding: '0.5rem 1rem', background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, fontSize: 13, color: isMyTurn ? 'var(--accent2)' : 'var(--muted)', fontWeight: isMyTurn ? 600 : 400 }}>
          {msg}
        </div>
      )}

      {/* PvE 大厅 */}
      {phase === 'lobby' && mode === 'pve' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.5rem', maxWidth: 400 }}>
          <h3 style={{ marginBottom: '0.75rem' }}>人机对战难度</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
            {[1,2,3,4,5,6,7,8,9,10].map(l => (
              <button key={l} style={{
                width: 38, height: 32, borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer',
                border: '1px solid var(--border)',
                background: aiLevel === l ? 'var(--accent)' : 'transparent',
                color: aiLevel === l ? '#fff' : 'var(--muted)',
              }} onClick={() => setAiLevel(l)}>{l}</button>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: '1.25rem' }}>
            {aiLevel <= 3 ? '随机落子，适合入门' : aiLevel <= 6 ? '有一定策略，中等难度' : '强力对手，慎重应对'}
          </p>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={startPVE}>开始游戏</button>
        </div>
      )}

      {/* PvP 桌子大厅 */}
      {phase === 'lobby' && mode === 'pvp' && (
        <>
          {!connected && <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)', fontSize: 13 }}>连接服务器中…</div>}
          {connected && (
            <>
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                {mySeat ? `你坐在 桌${mySeat.tableId}，等待对手入座…` : '点击空位入座，等对手坐下即可开始'}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: '0.75rem' }}>
                {tables.map(t => (
                  <TableCard key={t.id} table={t} mySeat={mySeat}
                    disabled={!!mySeat && mySeat.tableId !== t.id}
                    onSit={(tid, seat) => invoke('SitDown', 'gomoku', tid, seat)}
                    onStand={() => { invoke('StandUp'); setMySeat(null) }}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* 对局中 + 结束 */}
      {(phase === 'playing' || phase === 'ended') && (
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 6,
              padding: '0.3rem 0.6rem', background: 'var(--surface)', borderRadius: 6, fontSize: 12 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%',
                background: mySide===1?'#111':'#eee', border:'1px solid #888', flexShrink:0 }} />
              <span style={{ fontWeight: 600 }}>{opponentName || (mode==='pve'?`AI Lv.${aiLevel}`:'对手')}</span>
              <span style={{ color: 'var(--muted)', fontSize: 10 }}>（{mySide===1?'黑':'白'}）</span>
              {phase==='playing'&&currentTurn!==mySide&&<span style={{ color:'var(--warn)', marginLeft:'auto', fontSize:10 }}>落子中…</span>}
            </div>

            <GomokuBoard board={board} canPlace={isMyTurn} lastMove={lastMove} onPlace={handlePlace} />

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 6,
              padding: '0.3rem 0.6rem', background: 'var(--surface)', borderRadius: 6, fontSize: 12 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%',
                background: mySide===0?'#111':'#eee', border:'1px solid #888', flexShrink:0 }} />
              <span style={{ fontWeight: 600 }}>{user?.username || '我'}</span>
              <span style={{ color: 'var(--muted)', fontSize: 10 }}>（{mySide===0?'黑':'白'}）</span>
              {isMyTurn&&<span style={{ color:'var(--accent2)', marginLeft:'auto', fontSize:10, fontWeight:600 }}>你的回合</span>}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 140, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {phase === 'playing' && (
              <>
                <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'0.75rem', fontSize:12, color:'var(--muted)', lineHeight:1.8 }}>
                  <div style={{ fontWeight:700, color:'var(--text)', marginBottom:'0.3rem', fontSize:11, fontFamily:'var(--mono)' }}>规则</div>
                  黑棋先走<br />连续 5 子获胜<br />15 × 15 棋盘<br />红点 = 最后一手
                </div>
                <button className="btn btn-danger btn-sm"
                  onClick={async () => { if (await confirmDialog('确定投降？', { danger: true, confirmText: '投降' })) surrender() }}>投降</button>
              </>
            )}

            {phase === 'ended' && (
              <div style={{ textAlign:'center', padding:'1.5rem', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12 }}>
                <div style={{ fontSize:'2.5rem', marginBottom:'0.5rem' }}>
                  {winner===mySide?'🏆':winner===-1?'🤝':'😞'}
                </div>
                <div style={{ fontSize:'1.1rem', fontWeight:700, marginBottom:'0.25rem' }}>
                  {winner===mySide?'你获胜了！':winner===-1?'平局':'你输了'}
                </div>
                {winReason&&<div style={{ fontSize:12, color:'var(--muted)', marginBottom:'1rem' }}>{winReason}</div>}
                <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                  <button className="btn btn-primary" onClick={returnToLobby}>
                    {mode==='pvp'?'返回大厅':'再来一局'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => navigate('/games')}>返回游戏中心</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
