// =====================================================
// pages/forum/ForumHome.jsx —— 论坛首页
// 路由：/forum
// 职责：展示所有论坛板块列表，点击进入对应板块的帖子列表
// =====================================================

import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCategories } from '../../api/forum'

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(/(Z|[+-]\d\d:?\d\d)$/.test(dateStr) ? dateStr : dateStr + 'Z')) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`
  return new Date(/(Z|[+-]\d\d:?\d\d)$/.test(dateStr) ? dateStr : dateStr + 'Z').toLocaleDateString('zh-CN')
}

export default function ForumHome() {
  const [cats, setCats] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    getCategories()
      .then(r => setCats(r.data))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1rem' }}>
      {/* 标题栏 */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>论坛</h1>
        <p style={{ margin: '0.4rem 0 0', color: 'var(--muted)', fontSize: 13 }}>
          交流讨论，分享经验
        </p>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', padding: '2rem 0' }}>加载中…</div>
      ) : cats.length === 0 ? (
        <div style={{ color: 'var(--muted)', padding: '2rem 0' }}>暂无板块，管理员可在后台创建</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {cats.map(cat => (
            <div
              key={cat.id}
              className="forum-cat-row"
              style={{ background: 'var(--surface)', cursor: 'pointer', transition: 'background .15s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
              onClick={() => navigate(`/forum/c/${cat.slug}`)}
            >
              {/* 板块信息 */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', minWidth: 0 }}>
                <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>{cat.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: cat.description ? 3 : 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {cat.name}
                    {/* 仅管理员板块：接口对普通用户压根不返回这些行，这里的标只给管理员自己看，
                        免得在别人旁边点开私密板块还以为是公开的 */}
                    {cat.adminOnly && (
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 4, background: 'rgba(230,120,60,.18)', color: '#e8874b' }}>🔒 仅管理员</span>
                    )}
                  </div>
                  {cat.description && (
                    <div style={{ color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {cat.description}
                    </div>
                  )}
                </div>
              </div>

              {/* 统计 */}
              <div className="forum-cat-stats">
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{cat.threadCount}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 11 }}>帖子</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{cat.postCount}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 11 }}>回复</div>
                </div>
              </div>

              {/* 最新帖子 */}
              <div className="forum-cat-last" style={{ minWidth: 0 }}>
                {cat.lastThread ? (
                  <>
                    <div style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 2 }}>
                      {cat.lastThread.title}
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                      {cat.lastThread.lastUser} · {timeAgo(cat.lastThread.lastReplyAt)}
                    </div>
                  </>
                ) : (
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>暂无帖子</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
