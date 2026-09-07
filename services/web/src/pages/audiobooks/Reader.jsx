// =====================================================
// pages/audiobooks/Reader.jsx —— 听书·文字版 EPUB 阅读器
// 路由：/audiobooks/:id/read（懒加载，仅读文字版时才拉 epub.js）
// 职责：epub.js 渲染 + 目录 + 翻页(按钮/点击/键盘/滑动) + 字号 + 日间/夜间 + 进度条 + 续读(CFI)
//   续读：登录用户进度云端同步(后端)；未登录用 localStorage 兜底。
// =====================================================

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ePub from 'epubjs'
import { getBook, getReadProgress, saveReadProgress } from '../../api/audiobooks'
import useAuthStore from '../../store/authStore'

const FONT_SIZES = [80, 90, 100, 110, 125, 150, 175, 200]
const lsKey = (id) => `read-cfi-${id}`

export default function Reader() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)

  const viewerRef = useRef(null)
  const bookRef = useRef(null)
  const rendRef = useRef(null)
  const lastSaveRef = useRef(0)
  const percentRef = useRef(0)   // 实时阅读百分比（避免 cleanup stale closure 把云端进度覆盖成 0）

  const [title, setTitle] = useState('')
  const [toc, setToc] = useState([])
  const [showToc, setShowToc] = useState(false)
  const [showSet, setShowSet] = useState(false)
  const [fontIdx, setFontIdx] = useState(2)      // 100%
  const [night, setNight] = useState(false)
  const [percent, setPercent] = useState(0)
  const [err, setErr] = useState('')

  // 主题应用
  const applyTheme = useCallback((rend, isNight, fIdx) => {
    rend.themes.fontSize(`${FONT_SIZES[fIdx]}%`)
    rend.themes.override('color', isNight ? '#cfcfd4' : '#1a1a1a')
    rend.themes.override('background', isNight ? '#15151b' : '#fdfdfb')
  }, [])

  useEffect(() => {
    let cancelled = false
    let book, rend
    ;(async () => {
      try {
        const b = await getBook(id)
        if (cancelled) return
        if (!b?.epubUrl) { setErr('这本书暂无文字版'); return }
        setTitle(b.title)

        book = ePub(b.epubUrl); bookRef.current = book
        rend = book.renderTo(viewerRef.current, { width: '100%', height: '100%', flow: 'paginated', spread: 'none', allowScriptedContent: false })
        rendRef.current = rend
        applyTheme(rend, night, fontIdx)

        // 续读位置：登录用云端，否则 localStorage
        let cfi = ''
        if (user) { try { cfi = (await getReadProgress(id)).cfi || '' } catch {} }
        if (!cfi) cfi = localStorage.getItem(lsKey(id)) || ''
        await rend.display(cfi || undefined)

        book.loaded.navigation.then(nav => { if (!cancelled) setToc(nav.toc || []) })
        book.ready.then(() => book.locations.generate(1600)).then(() => {
          if (cancelled) return
          const loc = rend.currentLocation()
          if (loc?.start) { const pp = book.locations.percentageFromCfi(loc.start.cfi) || 0; setPercent(pp); percentRef.current = pp }
        }).catch(() => {})

        rend.on('relocated', (location) => {
          const c = location?.start?.cfi; if (!c) return
          let pct = 0
          try { pct = book.locations.length() ? (book.locations.percentageFromCfi(c) || 0) : 0 } catch {}
          setPercent(pct); percentRef.current = pct
          localStorage.setItem(lsKey(id), c)
          const now = Date.now()
          if (user && now - lastSaveRef.current > 8000) {
            lastSaveRef.current = now
            saveReadProgress({ audiobookId: Number(id), cfi: c, percent: pct }).catch(() => {})
          }
        })

        // 键盘翻页
        rend.on('keyup', e => { if (e.key === 'ArrowLeft') rend.prev(); if (e.key === 'ArrowRight') rend.next() })
      } catch (e) { if (!cancelled) setErr('文字版加载失败：' + (e?.message || e)) }
    })()
    const onKey = e => { if (e.key === 'ArrowLeft') rendRef.current?.prev(); if (e.key === 'ArrowRight') rendRef.current?.next() }
    window.addEventListener('keyup', onKey)
    return () => {
      cancelled = true; window.removeEventListener('keyup', onKey)
      // 退出前存最后位置
      try {
        const loc = rendRef.current?.currentLocation()
        const c = loc?.start?.cfi
        if (c && user) saveReadProgress({ audiobookId: Number(id), cfi: c, percent: percentRef.current }).catch(() => {})
      } catch {}
      try { bookRef.current?.destroy() } catch {}
    }
  }, [id]) // eslint-disable-line

  // 字号/夜间变化即时应用
  useEffect(() => { if (rendRef.current) applyTheme(rendRef.current, night, fontIdx) }, [night, fontIdx, applyTheme])

  const bg = night ? '#15151b' : '#fdfdfb'
  const fg = night ? '#cfcfd4' : '#1a1a1a'

  if (err) return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: bg, color: fg }}>
      <p>{err}</p>
      <button onClick={() => navigate(-1)} style={{ padding: '0.5rem 1.2rem', borderRadius: 999, border: '1px solid #888', background: 'none', color: fg, cursor: 'pointer' }}>返回</button>
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: bg, color: fg, display: 'flex', flexDirection: 'column', zIndex: 1000 }}>
      {/* 顶栏（zIndex 抬到 1000：盖住全局 Navbar(100) 与底部 BottomTabBar(200)，否则阅读器底部控制条被底栏遮住） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.8rem', borderBottom: `1px solid ${night ? '#2a2a33' : '#eee'}` }}>
        {/* 返回：箭头+标题整体可点（CLAUDE.md 规范，单独小箭头点不到） */}
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg, display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, padding: 0 }}>
          <span style={{ fontSize: 26, lineHeight: 1, padding: '0 4px' }}>‹</span>
          <span style={{ minWidth: 0, fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        </button>
        <button onClick={() => { setShowToc(t => !t); setShowSet(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg, fontSize: 18 }} title="目录">☰</button>
        <button onClick={() => { setShowSet(s => !s); setShowToc(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg, fontSize: 18 }} title="设置">Aa</button>
      </div>

      {/* 阅读区 + 左右点击翻页 */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div ref={viewerRef} style={{ position: 'absolute', inset: 0 }} />
        <div onClick={() => rendRef.current?.prev()} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '30%', cursor: 'w-resize' }} />
        <div onClick={() => rendRef.current?.next()} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '30%', cursor: 'e-resize' }} />
      </div>

      {/* 底栏进度 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.4rem 0.9rem', borderTop: `1px solid ${night ? '#2a2a33' : '#eee'}`, fontSize: 12, color: night ? '#888' : '#999' }}>
        <button onClick={() => rendRef.current?.prev()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg }}>‹ 上一页</button>
        <div style={{ flex: 1, height: 3, borderRadius: 2, background: night ? '#2a2a33' : '#eee', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(percent * 100)}%`, background: '#ec4899', borderRadius: 2 }} />
        </div>
        <span>{Math.round(percent * 100)}%</span>
        <button onClick={() => rendRef.current?.next()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg }}>下一页 ›</button>
      </div>

      {/* 目录抽屉 */}
      {showToc && (
        <div onClick={() => setShowToc(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 10 }}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '78%', maxWidth: 320, background: bg, overflowY: 'auto', padding: '1rem', boxShadow: '4px 0 20px rgba(0,0,0,.3)' }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>目录</div>
            {toc.length === 0 && <div style={{ color: '#999', fontSize: 13 }}>（此书无目录）</div>}
            {toc.map((t, i) => (
              <div key={i} onClick={() => { rendRef.current?.display(t.href); setShowToc(false) }}
                style={{ padding: '0.5rem 0', borderBottom: `1px solid ${night ? '#2a2a33' : '#f0f0f0'}`, cursor: 'pointer', fontSize: 14 }}>{t.label?.trim()}</div>
            ))}
          </div>
        </div>
      )}

      {/* 设置面板 */}
      {showSet && (
        <div onClick={() => setShowSet(false)} style={{ position: 'absolute', inset: 0, zIndex: 10 }}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', right: 12, top: 50, background: bg, border: `1px solid ${night ? '#2a2a33' : '#eee'}`, borderRadius: 12, padding: '1rem', width: 220, boxShadow: '0 8px 30px rgba(0,0,0,.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 14 }}>字号</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => setFontIdx(i => Math.max(0, i - 1))} style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${night ? '#3a3a44' : '#ddd'}`, background: 'none', color: fg, cursor: 'pointer', fontSize: 16 }}>A-</button>
                <span style={{ fontSize: 12, minWidth: 38, textAlign: 'center' }}>{FONT_SIZES[fontIdx]}%</span>
                <button onClick={() => setFontIdx(i => Math.min(FONT_SIZES.length - 1, i + 1))} style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${night ? '#3a3a44' : '#ddd'}`, background: 'none', color: fg, cursor: 'pointer', fontSize: 16 }}>A+</button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14 }}>夜间模式</span>
              <button onClick={() => setNight(n => !n)} style={{ padding: '4px 14px', borderRadius: 999, border: `1px solid ${night ? '#3a3a44' : '#ddd'}`, background: night ? '#ec4899' : 'none', color: night ? '#fff' : fg, cursor: 'pointer', fontSize: 13 }}>{night ? '开' : '关'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
