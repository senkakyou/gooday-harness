// =====================================================
// pages/audiobooks/AudiobooksHome.jsx —— 听书首页
// 路由：/audiobooks
// 职责：书库（分类筛选 + 搜索 + 封面网格） + 我的书架（续播入口）
// =====================================================

import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listBooks, getShelf, getReadShelf } from '../../api/audiobooks'
import useAuthStore from '../../store/authStore'

const CATEGORIES = ['全部', '小说', '历史', '商业', '儿童', '科普', '人文', '其他']

function Cover({ url, size = '100%' }) {
  return url
    ? <img src={url} style={{ width: size, aspectRatio: '3/4', objectFit: 'cover', borderRadius: 12, background: 'var(--surface2)' }} />
    : <div style={{ width: size, aspectRatio: '3/4', borderRadius: 12, background: 'linear-gradient(135deg,#ec4899,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34 }}>🎧</div>
}

export default function AudiobooksHome() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const [tab, setTab] = useState('library')   // library | shelf
  const [category, setCategory] = useState('全部')
  const [keyword, setKeyword] = useState('')
  const [books, setBooks] = useState([])
  const [shelf, setShelf] = useState([])
  const [readShelf, setReadShelf] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    listBooks({ category, keyword }).then(d => setBooks(d.items || [])).finally(() => setLoading(false))
  }, [category, keyword])

  useEffect(() => {
    if (tab === 'shelf' && user) {
      getShelf().then(setShelf).catch(() => setShelf([]))
      getReadShelf().then(setReadShelf).catch(() => setReadShelf([]))
    }
  }, [tab, user])

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1rem' }}>
      {/* 顶部：返回 + 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flex: 1, padding: 0 }}>
          <span style={{ color: 'var(--muted)', fontSize: 26, lineHeight: 1, padding: '0 4px' }}>‹</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>🎧 听书</span>
        </button>
      </div>

      {/* 书库 / 我的书架 切换 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
        {[['library', '书库'], ['shelf', '我的书架']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: '0.5rem 1.1rem', borderRadius: 999, cursor: 'pointer', fontSize: 14, fontWeight: 600,
            border: '1px solid var(--border)',
            background: tab === k ? 'linear-gradient(135deg,#ec4899,#db2777)' : 'var(--surface)',
            color: tab === k ? '#fff' : 'var(--text)',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'library' && (
        <>
          {/* 搜索 */}
          <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="搜书名 / 作者 / 主播"
            className="input"
            style={{ width: '100%', marginBottom: '0.75rem', fontSize: 16, padding: '0.6rem 0.9rem', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }} />
          {/* 分类 */}
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: '1rem', scrollbarWidth: 'none' }}>
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => setCategory(c)} style={{
                padding: '0.35rem 0.85rem', borderRadius: 999, whiteSpace: 'nowrap', cursor: 'pointer', fontSize: 13,
                border: '1px solid var(--border)',
                background: category === c ? 'rgba(236,72,153,0.15)' : 'var(--surface)',
                color: category === c ? '#ec4899' : 'var(--muted)',
              }}>{c}</button>
            ))}
          </div>

          {loading ? <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>加载中…</p>
            : books.length === 0 ? <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>暂无听书</p>
            : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: '1rem' }}>
                {books.map(b => (
                  <div key={b.id} onClick={() => navigate(`/audiobooks/${b.id}`)} style={{ cursor: 'pointer' }}>
                    <Cover url={b.coverUrl} />
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.author || b.narrator || ''}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{b.chapterCount} 章 · {b.playCount} 播放</div>
                  </div>
                ))}
              </div>
            )}
        </>
      )}

      {tab === 'shelf' && (
        !user ? <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>登录后可同步收听 / 阅读进度</p>
          : (shelf.length === 0 && readShelf.length === 0)
            ? <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>书架还是空的，去书库挑一本听 / 读吧</p>
            : (
              <>
                {shelf.length > 0 && <ShelfSection title="🎧 继续收听" items={shelf} action="▶ 继续收听"
                  to={b => `/audiobooks/${b.id}`} navigate={navigate} />}
                {readShelf.length > 0 && <ShelfSection title="📖 继续阅读" items={readShelf} action="📖 继续阅读"
                  to={b => `/audiobooks/${b.id}/read`} navigate={navigate} pct />}
              </>
            )
      )}
    </div>
  )
}

function ShelfSection({ title, items, action, to, navigate, pct }) {
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {items.map(s => (
          <div key={s.book.id} onClick={() => navigate(to(s.book))}
            style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '0.6rem', cursor: 'pointer' }}>
            <div style={{ width: 56, flexShrink: 0 }}><Cover url={s.book.coverUrl} /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.book.title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.book.author || s.book.narrator}</div>
              <div style={{ fontSize: 12, color: '#ec4899', marginTop: 2 }}>{action}{pct && s.percent > 0 ? ` · ${Math.round(s.percent * 100)}%` : ''}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
