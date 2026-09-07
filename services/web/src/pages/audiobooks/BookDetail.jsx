// =====================================================
// pages/audiobooks/BookDetail.jsx —— 听书详情 + 播放器
// 路由：/audiobooks/:id
// 职责：书详情 + 章节列表 + 播放器（音频/视频自适应 · 倍速 · 断点续播 · 上下章）
//   续播：登录用户每章进度上报后端，再次进入自动跳到上次位置；"继续收听"跳最近章。
// =====================================================

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getBook, getBookProgress, saveProgress, playBook, getReadProgress } from '../../api/audiobooks'
import useAuthStore from '../../store/authStore'

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0))
  const m = Math.floor(sec / 60), s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function BookDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)

  const [book, setBook] = useState(null)
  const [progress, setProgress] = useState({})   // chapterId -> { positionSec, finished }
  const [curIdx, setCurIdx] = useState(-1)        // 当前播放的章节下标
  const [speed, setSpeed] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState({ cur: 0, dur: 0 })
  const [readPct, setReadPct] = useState(null)   // 文字版阅读进度（null=未读/未登录）
  const [portrait, setPortrait] = useState(false) // 竖屏视频（抖音向的短片）走另一套尺寸

  const mediaRef = useRef(null)
  const lastSaveRef = useRef(0)
  const seekDoneRef = useRef(false)   // 本章是否已完成"跳到上次位置"

  // 加载书 + 进度
  useEffect(() => {
    getBook(id).then(setBook).catch(() => setBook(null))
    if (user) {
      getBookProgress(id).then(d => {
        const map = {}
        ;(d.chapters || []).forEach(c => { map[c.chapterId] = { positionSec: c.positionSec, finished: c.finished } })
        setProgress(map)
      }).catch(() => {})
      getReadProgress(id).then(d => setReadPct(d.cfi ? (d.percent || 0) : null)).catch(() => {})
    } else {
      setReadPct(localStorage.getItem(`read-cfi-${id}`) ? 0 : null)   // 未登录用本地记录判断是否读过
    }
  }, [id, user])

  const chapters = book?.chapters || []
  const cur = curIdx >= 0 ? chapters[curIdx] : null

  // 上报进度（节流 + 关键时机）
  const report = useCallback((finished = false) => {
    if (!user || !cur) return
    const m = mediaRef.current
    const pos = finished ? 0 : Math.floor(m?.currentTime || 0)
    saveProgress({ audiobookId: Number(id), chapterId: cur.id, positionSec: pos, finished }).catch(() => {})
    setProgress(p => ({ ...p, [cur.id]: { positionSec: pos, finished } }))
  }, [user, cur, id])

  // 选择并播放某章
  const playChapter = (idx) => {
    if (idx < 0 || idx >= chapters.length) return
    seekDoneRef.current = false
    setCurIdx(idx)
    playBook(id).catch(() => {})   // 播放计数（每次开播 +1，无所谓幂等）
  }

  // 切章后：等媒体元数据就绪，跳到上次位置 + 应用倍速 + 自动播放
  useEffect(() => {
    const m = mediaRef.current
    if (!m || !cur) return
    const onLoaded = () => {
      if (!seekDoneRef.current) {
        const saved = progress[cur.id]
        if (saved && !saved.finished && saved.positionSec > 0 && saved.positionSec < m.duration - 2) m.currentTime = saved.positionSec
        seekDoneRef.current = true
      }
      m.playbackRate = speed
      m.play().catch(() => {})
    }
    m.addEventListener('loadedmetadata', onLoaded)
    if (m.readyState >= 1) onLoaded()
    return () => m.removeEventListener('loadedmetadata', onLoaded)
  }, [curIdx]) // eslint-disable-line

  // 倍速变化即时应用
  useEffect(() => { if (mediaRef.current) mediaRef.current.playbackRate = speed }, [speed])

  const onTimeUpdate = () => {
    const m = mediaRef.current; if (!m) return
    setTime({ cur: m.currentTime, dur: m.duration || 0 })
    const now = Date.now()
    if (now - lastSaveRef.current > 10000) { lastSaveRef.current = now; report(false) }
  }
  const onEnded = () => {
    report(true)
    if (curIdx + 1 < chapters.length) playChapter(curIdx + 1)   // 自动下一章
    else setPlaying(false)
  }

  if (book === null) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>书不存在或已下架</div>
  if (!book) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>加载中…</div>

  const resumeIdx = chapters.findIndex(c => progress[c.id] && !progress[c.id].finished && progress[c.id].positionSec > 0)

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '1rem', paddingBottom: cur ? 150 : 24 }}>
      {/* 返回 */}
      <button onClick={() => { report(false); navigate(-1) }} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0, marginBottom: '1rem' }}>
        <span style={{ color: 'var(--muted)', fontSize: 26, lineHeight: 1, padding: '0 4px' }}>‹</span>
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>返回</span>
      </button>

      {/* 书头 */}
      <div style={{ display: 'flex', gap: 16, marginBottom: '1.25rem' }}>
        <div style={{ width: 110, flexShrink: 0 }}>
          {book.coverUrl
            ? <img src={book.coverUrl} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', borderRadius: 12 }} />
            : <div style={{ width: '100%', aspectRatio: '3/4', borderRadius: 12, background: 'linear-gradient(135deg,#ec4899,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>🎧</div>}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>{book.title}</h1>
          {book.author && <div style={{ fontSize: 14, color: 'var(--muted)' }}>作者：{book.author}</div>}
          {book.narrator && <div style={{ fontSize: 14, color: 'var(--muted)' }}>主播：{book.narrator}</div>}
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{book.category} · {chapters.length} 章 · {book.playCount} 播放</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {resumeIdx >= 0 && curIdx < 0 && (
              <button onClick={() => playChapter(resumeIdx)} style={{ padding: '0.5rem 1.1rem', borderRadius: 999, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#ec4899,#db2777)', color: '#fff', fontWeight: 600, fontSize: 14 }}>▶ 继续收听</button>
            )}
            {book.epubUrl && (
              <button onClick={() => navigate(`/audiobooks/${id}/read`)} style={{ padding: '0.5rem 1.1rem', borderRadius: 999, cursor: 'pointer', border: '1px solid #ec4899', background: 'transparent', color: '#ec4899', fontWeight: 600, fontSize: 14 }}>
                📖 {readPct != null ? `继续阅读${readPct > 0 ? ' ' + Math.round(readPct * 100) + '%' : ''}` : '阅读文字版'}
              </button>
            )}
          </div>
        </div>
      </div>

      {book.description && <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.6, marginBottom: '1.25rem', whiteSpace: 'pre-wrap' }}>{book.description}</p>}

      {/* 章节列表 */}
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>章节</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {chapters.map((c, i) => {
          const pr = progress[c.id]
          const active = i === curIdx
          return (
            <div key={c.id} onClick={() => playChapter(i)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '0.6rem 0.75rem', borderRadius: 10, cursor: 'pointer',
              background: active ? 'rgba(236,72,153,0.12)' : 'var(--surface)', border: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: 16, color: active ? '#ec4899' : 'var(--muted)' }}>{active && playing ? '⏸' : '▶'}</span>
              <span style={{ fontSize: 16 }}>{c.mediaType === 'video' ? '🎬' : '🎧'}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: active ? '#ec4899' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || `第 ${i + 1} 章`}</span>
              {pr?.finished && <span style={{ fontSize: 11, color: 'var(--muted)' }}>已听完</span>}
              {!pr?.finished && pr?.positionSec > 0 && <span style={{ fontSize: 11, color: '#ec4899' }}>{fmt(pr.positionSec)}</span>}
              {c.duration > 0 && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmt(c.duration)}</span>}
              {user?.role === 'admin' && c.mediaUrl && (
                <a href={c.mediaUrl} download={`${c.title || ('第' + (i + 1) + '集')}.mp3`}
                  onClick={(e) => e.stopPropagation()} title="下载音频（管理员）"
                  style={{ fontSize: 16, color: 'var(--muted)', textDecoration: 'none', padding: '0 4px', lineHeight: 1 }}>⬇</a>
              )}
              {user?.role === 'admin' && c.subtitleUrl && (
                <a href={c.subtitleUrl} download={`${c.title || ('第' + (i + 1) + '集')}.lrc`}
                  onClick={(e) => e.stopPropagation()} title="下载字幕 LRC（管理员）"
                  style={{ fontSize: 11, color: 'var(--muted)', textDecoration: 'none', padding: '1px 4px', lineHeight: 1, border: '1px solid var(--border)', borderRadius: 5 }}>字幕</a>
              )}
            </div>
          )
        })}
      </div>

      {/* ===== 底部播放器（选了章才出现，固定底部）===== */}
      {cur && (
        <div className="audiobook-player" style={{ position: 'fixed', left: 0, right: 0, background: 'var(--surface)', borderTop: '1px solid var(--border)', padding: '0.6rem 1rem', boxShadow: '0 -4px 20px rgba(0,0,0,0.25)', zIndex: 250 }}>
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{cur.title || `第 ${curIdx + 1} 章`}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>{fmt(time.cur)} / {fmt(time.dur)}</span>
            </div>

            {cur.mediaType === 'video'
              ? <video ref={mediaRef} src={cur.mediaUrl} controls playsInline
                  onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); if (!mediaRef.current?.ended) report(false) }}
                  onTimeUpdate={onTimeUpdate} onEnded={onEnded}
                  onLoadedMetadata={e => setPortrait(e.target.videoHeight > e.target.videoWidth)}
                  /* 竖屏片（1080×1920）塞进 maxHeight:220 的横盒子会被压成中间一条、两边全黑边，
                     字完全读不了。按实际画幅切尺寸：竖片给高度、宽度自适应并居中。 */
                  style={portrait
                    ? { height: '46vh', width: 'auto', maxWidth: '100%', display: 'block',
                        margin: '0 auto 6px', borderRadius: 8, background: '#000' }
                    : { width: '100%', maxHeight: 220, borderRadius: 8, background: '#000', marginBottom: 6 }} />
              : <audio ref={mediaRef} src={cur.mediaUrl} controls
                  onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); if (!mediaRef.current?.ended) report(false) }}
                  onTimeUpdate={onTimeUpdate} onEnded={onEnded}
                  style={{ width: '100%', marginBottom: 6 }} />}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => playChapter(curIdx - 1)} disabled={curIdx <= 0} style={{ background: 'none', border: 'none', cursor: curIdx <= 0 ? 'default' : 'pointer', color: curIdx <= 0 ? 'var(--border)' : 'var(--text)', fontSize: 14 }}>⏮ 上一章</button>
              <div style={{ display: 'flex', gap: 4 }}>
                {SPEEDS.map(sp => (
                  <button key={sp} onClick={() => setSpeed(sp)} style={{
                    padding: '2px 8px', borderRadius: 8, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)',
                    background: speed === sp ? '#ec4899' : 'transparent', color: speed === sp ? '#fff' : 'var(--muted)',
                  }}>{sp}x</button>
                ))}
              </div>
              <button onClick={() => playChapter(curIdx + 1)} disabled={curIdx + 1 >= chapters.length} style={{ background: 'none', border: 'none', cursor: curIdx + 1 >= chapters.length ? 'default' : 'pointer', color: curIdx + 1 >= chapters.length ? 'var(--border)' : 'var(--text)', fontSize: 14 }}>下一章 ⏭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
