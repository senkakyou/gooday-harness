import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useToastStore from '../store/toastStore'
import { listNotifications, readNotification, readAllNotifications, deleteNotification } from '../api/notifications'

const TYPE_META = {
  booking:       { icon: '📅', color: '#10b981' },
  teacher_audit: { icon: '🎓', color: '#6366f1' },
  request:       { icon: '🛠', color: '#f59e0b' },
  announcement:  { icon: '📢', color: '#ef4444' },
  system:        { icon: '🔔', color: '#6b7280' },
}

function timeAgo(iso) {
  const d = new Date(iso); const s = (Date.now() - d.getTime()) / 1000
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} 天前`
  return iso.slice(0, 10)
}

export default function Notifications() {
  const navigate = useNavigate()
  const toast = useToastStore(s => s.toast)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => listNotifications().then(setItems).catch(() => setItems([])).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const hasUnread = items.some(n => !n.isRead)

  const open = async (n) => {
    if (!n.isRead) {
      try { await readNotification(n.id) } catch {}
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x))
    }
    if (n.linkUrl) navigate(n.linkUrl)
  }

  const markAll = async () => {
    try { await readAllNotifications(); setItems(prev => prev.map(x => ({ ...x, isRead: true }))); toast('已全部标为已读') }
    catch { toast('操作失败', true) }
  }

  const remove = async (e, id) => {
    e.stopPropagation()
    try { await deleteNotification(id); setItems(prev => prev.filter(x => x.id !== id)) }
    catch { toast('删除失败', true) }
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 0 5rem' }}>
      {/* 顶部导航 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)', borderBottom: '1px solid var(--border)', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate('/')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flex: 1, padding: 0, minWidth: 0 }}>
          <span style={{ color: 'var(--muted)', fontSize: 26, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>‹</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>通知</span>
        </button>
        {hasUnread && (
          <button onClick={markAll}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, padding: '6px 12px', borderRadius: 9 }}>全部已读</button>
        )}
      </div>

      <div style={{ padding: '1rem' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3].map(i => <div key={i} style={{ height: 72, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }} />)}
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '4rem 0' }}>
            <div style={{ fontSize: 46, marginBottom: 12 }}>🔔</div>
            <div style={{ fontSize: 14 }}>暂无通知</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map(n => {
              const meta = TYPE_META[n.type] || TYPE_META.system
              return (
                <div key={n.id} onClick={() => open(n)}
                  style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '0.875rem 1rem', cursor: n.linkUrl ? 'pointer' : 'default', display: 'flex', gap: 12, alignItems: 'flex-start', opacity: n.isRead ? 0.7 : 1 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: `${meta.color}1f`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{meta.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {!n.isRead && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#e55', flexShrink: 0 }} />}
                      <span style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
                    </div>
                    {n.body && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>{n.body}</div>}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>{timeAgo(n.createdAt)}</div>
                  </div>
                  <button onClick={(e) => remove(e, n.id)} title="删除"
                    style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 15, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}>✕</button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
