// =====================================================
// pages/forum/CategoryPage.jsx —— 论坛板块页
// 路由：/forum/c/:slug
// 职责：展示某个板块下的帖子列表（分页），支持发帖
// =====================================================

import React, { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { getThreads, createThread } from '../../api/forum'
import useAuthStore from '../../store/authStore'
import useToastStore from '../../store/toastStore'
import MediaEditor from '../../components/forum/MediaEditor'
import timeAgo from '../../utils/timeAgo'
import pageRange from '../../utils/pageRange'

const PAGE_SIZE = 30

export default function CategoryPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const toast = useToastStore(s => s.toast)

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ title: '', content: '' })
  const [submitting, setSubmitting] = useState(false)

  const load = (p = page) => {
    setLoading(true)
    getThreads(slug, p)
      .then(r => { setData(r.data); setPage(p) })
      .catch(() => toast('板块不存在', true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(1) }, [slug])

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1

  const handleCreate = async () => {
    if (!form.title.trim()) return toast('请填写标题', true)
    if (!form.content.trim()) return toast('请填写内容', true)
    setSubmitting(true)
    try {
      const r = await createThread({ categoryId: data.category.id, title: form.title, content: form.content })
      toast('发帖成功', )
      setShowCreate(false)
      setForm({ title: '', content: '' })
      navigate(`/forum/t/${r.data.threadId}`)
    } catch (e) {
      toast(e.message || '发帖失败', true)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && !data) return <div style={{ padding: '3rem', color: 'var(--muted)' }}>加载中…</div>
  if (!data) return null

  const cat = data.category
  const threads = data.threads

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1rem' }}>
      {/* 面包屑 */}
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: '1rem' }}>
        <Link to="/forum" style={{ color: 'var(--muted)', textDecoration: 'none' }}>论坛</Link>
        <span style={{ margin: '0 6px' }}>›</span>
        <span>{cat.name}</span>
      </div>

      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{cat.icon} {cat.name}</h1>
          {cat.description && <p style={{ margin: '0.3rem 0 0', color: 'var(--muted)', fontSize: 13 }}>{cat.description}</p>}
        </div>
        {user ? (
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? '取消' : '+ 发帖'}
          </button>
        ) : (
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>登录后发帖</span>
        )}
      </div>

      {/* 发帖表单 */}
      {showCreate && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '1.25rem', marginBottom: '1.25rem' }}>
          <div style={{ marginBottom: '0.75rem' }}>
            <input
              className="input"
              placeholder="帖子标题（2-100字）"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              style={{ width: '100%', boxSizing: 'border-box' }}
              maxLength={100}
            />
          </div>
          <MediaEditor
            value={form.content}
            onChange={v => setForm(f => ({ ...f, content: v }))}
            placeholder="帖子内容（可插入图片/视频，至少5个字）"
            rows={6}
            toast={toast}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem', gap: '0.5rem' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>取消</button>
            <button className="btn btn-primary btn-sm" onClick={handleCreate} disabled={submitting}>
              {submitting ? '发布中…' : '发布'}
            </button>
          </div>
        </div>
      )}

      {/* 帖子列表 */}
      {loading ? (
        <div style={{ color: 'var(--muted)', padding: '2rem 0' }}>加载中…</div>
      ) : threads.length === 0 ? (
        <div style={{ color: 'var(--muted)', padding: '3rem 0', textAlign: 'center' }}>暂无帖子，来发第一帖吧！</div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {/* 表头（手机自动隐藏） */}
          <div className="forum-thread-header" style={{ background: 'var(--surface2)', fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            <span>标题</span>
            <span style={{ textAlign: 'center' }}>浏览</span>
            <span style={{ textAlign: 'center' }}>回复</span>
            <span>最后回复</span>
          </div>

          {threads.map(t => (
            <div
              key={t.id}
              className="forum-thread-row"
              style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', cursor: 'pointer', transition: 'background .15s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
              onClick={() => navigate(`/forum/t/${t.id}`)}
            >
              {/* 标题列 */}
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: 2 }}>
                  {t.isPinned && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--accent)', color: '#fff', fontWeight: 700, flexShrink: 0 }}>置顶</span>}
                  {t.isLocked && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--border)', color: 'var(--muted)', fontWeight: 700, flexShrink: 0 }}>锁定</span>}
                  <span style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 11, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span>{t.author.username} · {timeAgo(t.createdAt)}</span>
                  {/* 手机上在副标题行显示浏览/回复数 */}
                  <span className="forum-thread-stats">
                    <span>浏览 {t.viewCount}</span>
                    <span>回复 {t.replyCount}</span>
                  </span>
                </div>
              </div>
              {/* 以下三列手机隐藏 */}
              <div className="forum-thread-meta-col" style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>{t.viewCount}</div>
              <div className="forum-thread-meta-col" style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>{t.replyCount}</div>
              <div className="forum-thread-meta-col" style={{ fontSize: 11, color: 'var(--muted)', minWidth: 0 }}>
                {t.lastReplyUser ? (
                  <>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.lastReplyUser.username}</div>
                    <div>{timeAgo(t.lastReplyAt)}</div>
                  </>
                ) : <span>{timeAgo(t.lastReplyAt)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', alignItems: 'center', marginTop: '1.5rem', flexWrap: 'wrap' }}>
          {pageRange(page, totalPages).map((p, i) => (
            p === '…'
              ? <span key={`gap${i}`} style={{ color: 'var(--muted)', padding: '0 4px' }}>…</span>
              : <button
                  key={p}
                  className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => load(p)}
                >{p}</button>
          ))}
        </div>
      )}
    </div>
  )
}
