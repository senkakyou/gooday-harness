// =====================================================
// pages/forum/PostFloor.jsx —— 帖子楼层（单条回复）
// 从 ThreadPage.jsx 抽离的展示组件；数据与回调由父组件传入
// =====================================================

import React from 'react'
import MediaContent from '../../components/forum/MediaContent'
import MediaEditor from '../../components/forum/MediaEditor'
import timeAgo from '../../utils/timeAgo'

export default function PostFloor({
  post, user, isAdmin, threadLocked, threadUrl,
  editingId, editContent, setEditContent, setEditingId,
  onLike, onSaveEdit, onDeletePost, onQuote, copyLink, toast,
}) {
  // 复制本楼正文（含章名），可直接粘贴到各发布平台
  const copyText = async (text) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus(); ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      toast && toast('已复制，可直接粘贴发布')
    } catch {
      toast && toast('复制失败，请手动选中复制', true)
    }
  }

  return (
    <div id={`post-${post.id}`} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      {/* 楼层头 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.7rem 1.25rem', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
            {post.author.username[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{post.author.username}</div>
            <div style={{ color: 'var(--muted)', fontSize: 11 }}>{timeAgo(post.createdAt)}{post.updatedAt && ' (已编辑)'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            title="复制楼层链接"
            onClick={() => copyLink(`${threadUrl}#post-${post.id}`)}
            style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--mono)', cursor: 'pointer', userSelect: 'none' }}
          >#{post.floorNumber}</span>
        </div>
      </div>

      {/* 楼层内容 */}
      <div style={{ padding: '1rem 1.25rem' }}>
        {editingId === post.id ? (
          <div>
            <MediaEditor
              value={editContent}
              onChange={setEditContent}
              placeholder="编辑内容…"
              rows={5}
              toast={toast}
            />
            <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>取消</button>
              <button className="btn btn-primary btn-sm" onClick={() => onSaveEdit(post.id)}>保存</button>
            </div>
          </div>
        ) : post.isDeleted ? (
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>（该内容已被删除）</div>
        ) : (
          <MediaContent content={post.content} style={{ fontSize: 14, lineHeight: 1.75 }} />
        )}
      </div>

      {/* 底栏：点赞 + 操作 */}
      {!post.isDeleted && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 1.25rem', borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => onLike(post.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', color: post.liked ? 'var(--accent)' : 'var(--muted)', fontSize: 13, padding: '4px 8px', borderRadius: 4 }}
          >
            <span>{post.liked ? '👍' : '👍'}</span>
            <span style={{ fontWeight: post.liked ? 600 : 400 }}>{post.likeCount}</span>
          </button>

          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {/* 复制本楼正文（含章名），可直接粘贴到各平台发布 */}
            <button className="btn btn-ghost btn-sm" title="复制本章正文" onClick={() => copyText(post.content)}>📋 复制</button>
            {/* 回复引用：定位到回复框 */}
            {user && !threadLocked && (
              <button className="btn btn-ghost btn-sm" onClick={() => onQuote(post)}>回复</button>
            )}
            {/* 编辑（本人或管理员） */}
            {user && (user.userId === post.author.id || isAdmin) && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setEditingId(post.id); setEditContent(post.content) }}>编辑</button>
            )}
            {/* 删除（本人或管理员） */}
            {user && (user.userId === post.author.id || isAdmin) && (
              <button className="btn btn-ghost btn-sm" style={{ color: '#e55' }} onClick={() => onDeletePost(post.id)}>删除</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
