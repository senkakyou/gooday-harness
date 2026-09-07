import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useToastStore from '../../store/toastStore'
import { myBookings, cancelBooking } from '../../api/courses'
import { ymd } from '../../utils/localDate'

const STATUS_LABEL = { pending: '待确认', confirmed: '已确认', cancelled: '已取消', completed: '已完成' }
const STATUS_COLOR = { pending: '#f59e0b', confirmed: '#10b981', cancelled: '#6b7280', completed: '#6366f1' }
const STATUS_BG    = { pending: 'rgba(245,158,11,0.1)', confirmed: 'rgba(16,185,129,0.1)', cancelled: 'rgba(107,114,128,0.1)', completed: 'rgba(99,102,241,0.1)' }

const TABS = [
  { key: 'upcoming', label: '即将上课' },
  { key: 'all',      label: '全部记录' },
]

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
function fmtDate(d) {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  if (isNaN(dt)) return d
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((dt - today) / 86400000)
  const rel = diff === 0 ? '今天' : diff === 1 ? '明天' : diff === 2 ? '后天' : ''
  const md = `${dt.getMonth() + 1}月${dt.getDate()}日`
  return `${md} ${WEEKDAYS[dt.getDay()]}${rel ? ' · ' + rel : ''}`
}

function BookingCard({ b, onCancel }) {
  const today = ymd()
  const isPast = b.slot?.date < today
  const canCancel = (b.status === 'pending' || b.status === 'confirmed') && !isPast
  const subjects = (b.teacher?.subjects || []).map(s => s.name).join(' · ')

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 16, overflow: 'hidden',
    }}>
      {/* 顶部色条 */}
      <div style={{ height: 3, background: STATUS_COLOR[b.status] }} />
      <div style={{ padding: '1rem 1rem 1rem' }}>
        {/* 头部：老师信息 + 状态 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {b.teacher?.avatarUrl
              ? <img src={b.teacher.avatarUrl} alt="" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
              : <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>👤</div>
            }
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{b.teacher?.username} 老师</div>
              {subjects && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{subjects}</div>
              )}
            </div>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLOR[b.status], background: STATUS_BG[b.status], padding: '4px 10px', borderRadius: 20 }}>
            {STATUS_LABEL[b.status]}
          </span>
        </div>

        {/* 时间信息 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px', borderRadius: 10, background: 'var(--bg)', marginBottom: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 9, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>📅</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{fmtDate(b.slot?.date)}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {b.slot?.startTime}–{b.slot?.endTime}
              {b.slot?.durationMinutes ? ` · ${b.slot.durationMinutes} 分钟` : ''}
            </div>
          </div>
        </div>

        {/* 科目 */}
        {b.subject?.name && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '4px 10px', borderRadius: 20, marginBottom: 10 }}>
            📚 {b.subject.name}
          </div>
        )}

        {/* 课程主题 */}
        {b.slot?.note && (
          <div style={{ fontSize: 13, padding: '10px 12px', borderRadius: 10, background: 'var(--bg)', marginBottom: 10, display: 'flex', gap: 6 }}>
            <span style={{ flexShrink: 0, color: 'var(--muted)' }}>📖 课程主题：</span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{b.slot.note}</span>
          </div>
        )}

        {/* 备注 */}
        {b.note && (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0 0', borderTop: 'none', display: 'flex', gap: 6 }}>
            <span style={{ flexShrink: 0 }}>我的备注：</span>
            <span style={{ color: 'var(--text)' }}>{b.note}</span>
          </div>
        )}
        {b.teacherNote && (
          <div style={{ fontSize: 13, padding: '8px 10px', borderRadius: 8, background: 'rgba(16,185,129,0.08)', marginTop: 8, display: 'flex', gap: 6 }}>
            <span style={{ flexShrink: 0, color: '#10b981' }}>老师回复：</span>
            <span style={{ color: 'var(--text)' }}>{b.teacherNote}</span>
          </div>
        )}

        {/* 操作按钮 */}
        {canCancel && (
          <button onClick={() => onCancel(b.id)}
            style={{ marginTop: 12, width: '100%', padding: '10px 0', borderRadius: 10, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.06)', color: '#ef4444', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            取消预约
          </button>
        )}

        {/* 预约时间 */}
        {b.createdAt && (
          <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right', marginTop: 10 }}>
            预约于 {b.createdAt.slice(0, 16).replace('T', ' ')}
          </div>
        )}
      </div>
    </div>
  )
}

function Tips() {
  const items = [
    '预约提交后请等待老师确认，状态变为「已确认」即可按时上课。',
    '如需调整，请在上课前取消预约，逾期将无法取消。',
    '上课方式与具体安排可在「我的备注」与「老师回复」中沟通。',
  ]
  return (
    <div style={{ marginTop: 14, padding: '14px 16px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>💡</span> 上课须知
      </div>
      {items.map((t, i) => (
        <div key={i} style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, display: 'flex', gap: 6 }}>
          <span style={{ flexShrink: 0 }}>·</span><span>{t}</span>
        </div>
      ))}
    </div>
  )
}

export default function MyBookingsPage() {
  const navigate = useNavigate()
  const toast = useToastStore(s => s.toast)
  const [allBookings, setAllBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('upcoming')

  const load = () => {
    setLoading(true)
    myBookings().then(r => setAllBookings(r.data)).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const cancel = async (id) => {
    if (!confirm('确定取消这次预约？')) return
    try { await cancelBooking(id); toast('预约已取消'); load() }
    catch (e) { toast(e.response?.data || '操作失败', true) }
  }

  const today = ymd()
  const upcoming = allBookings.filter(b => b.slot?.date >= today && (b.status === 'pending' || b.status === 'confirmed'))
    .sort((a, b) => (a.slot?.date + a.slot?.startTime).localeCompare(b.slot?.date + b.slot?.startTime))
  const displayed = tab === 'upcoming' ? upcoming : [...allBookings].sort((a, b) => (b.slot?.date + b.slot?.startTime).localeCompare(a.slot?.date + a.slot?.startTime))

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 0 5rem' }}>
      {/* 顶部导航 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg)', borderBottom: '1px solid var(--border)',
        padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={() => navigate('/courses')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flex: 1, padding: 0, minWidth: 0 }}>
          <span style={{ color: 'var(--muted)', fontSize: 26, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>‹</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>我的预约</span>
        </button>
        <button onClick={() => navigate('/courses/timetable')}
          style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '6px 12px', borderRadius: 9 }}>📅 课表</button>
      </div>

      {/* 标签栏 */}
      <div style={{ padding: '0.875rem 1rem 0' }}>
        <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 4, marginBottom: '1rem' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', fontSize: 14, fontWeight: tab === t.key ? 700 : 400,
                background: tab === t.key ? 'var(--accent)' : 'transparent',
                color: tab === t.key ? '#fff' : 'var(--muted)', cursor: 'pointer', transition: 'background .15s, color .15s' }}>
              {t.label}
              {t.key === 'upcoming' && upcoming.length > 0 && (
                <span style={{ marginLeft: 5, fontSize: 11, background: tab === t.key ? 'rgba(255,255,255,0.25)' : 'var(--accent)', color: '#fff', padding: '1px 6px', borderRadius: 10 }}>
                  {upcoming.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ height: 140, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--border)' }} />
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '4rem 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{tab === 'upcoming' ? '📅' : '📋'}</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>
              {tab === 'upcoming' ? '暂无即将上课的课程' : '暂无预约记录'}
            </div>
            <div style={{ fontSize: 13, marginBottom: 20 }}>
              {tab === 'upcoming' ? '快去找老师预约一节课吧' : '还没有任何预约记录'}
            </div>
            <button onClick={() => navigate('/courses')}
              style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
              去预约课程
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {displayed.map(b => <BookingCard key={b.id} b={b} onCancel={cancel} />)}
            <Tips />
          </div>
        )}
      </div>
    </div>
  )
}
