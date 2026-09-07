// =====================================================
// pages/forum/ThreadPage.jsx —— 帖子详情页
// 路由：/forum/t/:id
// 职责：展示帖子全部楼层（分页），支持回复、编辑、删除、点赞；管理员可置顶/锁定
// =====================================================

import React, { useEffect, useState, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  getThread, reply, editPost, deletePost, deleteThread,
  toggleLike, togglePin, toggleLock
} from '../../api/forum'
import useAuthStore from '../../store/authStore'
import useToastStore from '../../store/toastStore'
import { confirmDialog } from '../../store/confirmStore'
import MediaEditor from '../../components/forum/MediaEditor'
import timeAgo from '../../utils/timeAgo'
import pageRange from '../../utils/pageRange'
import PostFloor from './PostFloor'

const PAGE_SIZE = 20

export default function ThreadPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const toast = useToastStore(s => s.toast)

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [replyContent, setReplyContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editContent, setEditContent] = useState('')
  const replyRef = useRef(null)

  const load = (p = 1) => {
    setLoading(true)
    getThread(id, p)
      .then(r => { setData(r.data); setPage(p) })
      .catch(() => toast('帖子不存在', true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(1) }, [id])

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1
  const thread = data?.thread

  const handleReply = async () => {
    if (!replyContent.trim()) return toast('回复不能为空', true)
    setSubmitting(true)
    try {
      await reply(id, replyContent)
      toast('回复成功', )
      setReplyContent('')
      load(totalPages + (data.total % PAGE_SIZE === 0 ? 1 : 0))
    } catch (e) {
      toast(e.message || '回复失败', true)
    } finally {
      setSubmitting(false)
    }
  }

  const handleLike = async (postId) => {
    if (!user) return toast('请先登录', true)
    try {
      const r = await toggleLike(postId)
      setData(prev => ({
        ...prev,
        posts: prev.posts.map(p => p.id === postId
          ? { ...p, liked: r.data.liked, likeCount: r.data.likeCount }
          : p)
      }))
    } catch {}
  }

  const handleSaveEdit = async (postId) => {
    if (!editContent.trim()) return toast('内容不能为空', true)
    try {
      await editPost(postId, editContent)
      toast('修改成功', )
      setEditingId(null)
      load(page)
    } catch (e) {
      toast(e.message || '修改失败', true)
    }
  }

  const handleDeletePost = async (postId) => {
    if (!await confirmDialog('确定删除这条回复？', { danger: true, confirmText: '删除' })) return
    try {
      await deletePost(postId)
      toast('已删除', )
      load(page)
    } catch {}
  }

  const handleDeleteThread = async () => {
    if (!await confirmDialog('确定删除整个帖子？此操作不可恢复', { danger: true, confirmText: '删除' })) return
    try {
      await deleteThread(id)
      toast('帖子已删除', )
      navigate(`/forum/c/${thread.category.slug}`)
    } catch {}
  }

  const handlePin = async () => {
    try {
      const r = await togglePin(id)
      toast(r.data.isPinned ? '已置顶' : '已取消置顶', )
      load(page)
    } catch {}
  }

  const handleLock = async () => {
    try {
      const r = await toggleLock(id)
      toast(r.data.isLocked ? '已锁定' : '已解锁', )
      load(page)
    } catch {}
  }

  const copyLink = (url) => {
    navigator.clipboard.writeText(url).then(() => toast('链接已复制')).catch(() => toast('复制失败', true))
  }

  const handleQuote = (post) => {
    setReplyContent(`@${post.author.username}（#${post.floorNumber}楼）\n`)
    replyRef.current?.scrollIntoView({ behavior: 'smooth' })
    setTimeout(() => replyRef.current?.querySelector('textarea')?.focus(), 300)
  }

  if (loading && !data) return <div style={{ padding: '3rem', color: 'var(--muted)' }}>加载中…</div>
  if (!data) return null

  const isAdmin = user?.role === 'admin'
  const threadUrl = `${window.location.origin}/forum/t/${id}`

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '2rem 1rem' }}>
      {/* 面包屑 */}
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: '1rem' }}>
        <Link to="/forum" style={{ color: 'var(--muted)', textDecoration: 'none' }}>论坛</Link>
        <span style={{ margin: '0 6px' }}>›</span>
        <Link to={`/forum/c/${thread.category.slug}`} style={{ color: 'var(--muted)', textDecoration: 'none' }}>{thread.category.name}</Link>
        <span style={{ margin: '0 6px' }}>›</span>
        <span style={{ maxWidth: 300, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom', whiteSpace: 'nowrap' }}>{thread.title}</span>
      </div>

      {/* 帖子标题 */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '1.25rem 1.5rem', marginBottom: '1rem' }}>
        <div className="thread-header">
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 6, flexWrap: 'wrap' }}>
              {thread.isPinned && <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, background: 'var(--accent)', color: '#fff', fontWeight: 700, flexShrink: 0 }}>置顶</span>}
              {thread.isLocked && <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, background: 'var(--border)', color: 'var(--muted)', fontWeight: 700, flexShrink: 0 }}>锁定</span>}
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>{thread.title}</h1>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              {thread.author.username} · {timeAgo(thread.createdAt)} · {thread.viewCount} 浏览 · {thread.replyCount} 回复
            </div>
          </div>
          {/* 操作按钮：手机上换到标题下方 */}
          <div className="thread-header-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => copyLink(threadUrl)}>🔗 分享</button>
            {isAdmin && (
              <>
                <button className="btn btn-ghost btn-sm" onClick={handlePin}>{thread.isPinned ? '取消置顶' : '置顶'}</button>
                <button className="btn btn-ghost btn-sm" onClick={handleLock}>{thread.isLocked ? '解锁' : '锁定'}</button>
                <button className="btn btn-ghost btn-sm" style={{ color: '#e55' }} onClick={handleDeleteThread}>删帖</button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 楼层列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {data.posts.map(post => (
          <PostFloor
            key={post.id}
            post={post} user={user} isAdmin={isAdmin}
            threadLocked={thread.isLocked} threadUrl={threadUrl}
            editingId={editingId} editContent={editContent}
            setEditContent={setEditContent} setEditingId={setEditingId}
            onLike={handleLike} onSaveEdit={handleSaveEdit}
            onDeletePost={handleDeletePost} onQuote={handleQuote}
            copyLink={copyLink} toast={toast}
          />
        ))}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', alignItems: 'center', margin: '1.5rem 0', flexWrap: 'wrap' }}>
          {pageRange(page, totalPages).map((p, i) => (
            p === '…'
              ? <span key={`gap${i}`} style={{ color: 'var(--muted)', padding: '0 4px' }}>…</span>
              : <button key={p} className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-ghost'}`} onClick={() => load(p)}>{p}</button>
          ))}
        </div>
      )}

      {/* 回复框 */}
      <div ref={replyRef} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '1.25rem', marginTop: '1.25rem' }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: '0.75rem' }}>
          {thread.isLocked ? '帖子已锁定，禁止回复' : '发表回复'}
        </div>
        {!user ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>请先登录后回复</div>
        ) : thread.isLocked ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>管理员已锁定此帖</div>
        ) : (
          <>
            <MediaEditor
              value={replyContent}
              onChange={setReplyContent}
              placeholder="写下你的回复…"
              rows={5}
              toast={toast}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <button className="btn btn-primary btn-sm" onClick={handleReply} disabled={submitting}>
                {submitting ? '发送中…' : '发表回复'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* 删帖（非管理员自己的帖子） */}
      {user && user.userId === thread.author.id && !isAdmin && (
        <div style={{ marginTop: '1rem', textAlign: 'right' }}>
          <button className="btn btn-ghost btn-sm" style={{ color: '#e55' }} onClick={handleDeleteThread}>删除帖子</button>
        </div>
      )}
    </div>
  )
}
