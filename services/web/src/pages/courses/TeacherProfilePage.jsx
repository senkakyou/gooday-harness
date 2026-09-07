import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import useAuthStore from '../../store/authStore'
import useToastStore from '../../store/toastStore'
import AuthModal from '../../components/AuthModal'
import { getTeacher, getAvailableDays, getSlotsByDate, createBooking } from '../../api/courses'
import { ymd } from '../../utils/localDate'

function DateStrip({ days, selectedDate, onSelect }) {
  const scrollRef = useRef(null)
  const today = ymd()
  const weekDays = ['日','一','二','三','四','五','六']

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const idx = days.findIndex(d => d.dateStr === selectedDate)
    if (idx < 0) return
    const btn = el.children[idx]
    if (btn) btn.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' })
  }, [selectedDate, days])

  return (
    <div ref={scrollRef} style={{
      display: 'flex', gap: 8, overflowX: 'auto', padding: '4px 1rem 8px',
      scrollbarWidth: 'none', msOverflowStyle: 'none',
    }}>
      {days.map(d => {
        const isSelected = d.dateStr === selectedDate
        const isToday = d.dateStr === today
        return (
          <button key={d.dateStr} onClick={() => onSelect(d.dateStr)}
            disabled={!d.hasSlot}
            style={{
              flexShrink: 0, width: 52, padding: '8px 0', borderRadius: 14,
              border: isSelected ? '2px solid var(--accent)' : '2px solid var(--border)',
              background: isSelected ? 'var(--accent)' : d.hasSlot ? 'var(--surface)' : 'transparent',
              color: isSelected ? '#fff' : d.hasSlot ? 'var(--text)' : 'var(--muted)',
              cursor: d.hasSlot ? 'pointer' : 'default',
              opacity: d.hasSlot ? 1 : 0.4,
              textAlign: 'center', transition: 'border-color .12s, background .12s',
              position: 'relative',
            }}>
            <div style={{ fontSize: 11, color: isSelected ? 'rgba(255,255,255,0.75)' : 'var(--muted)', marginBottom: 2 }}>
              {isToday ? '今天' : weekDays[d.weekday]}
            </div>
            <div style={{ fontSize: 16, fontWeight: isSelected ? 700 : d.hasSlot ? 600 : 400 }}>
              {d.day}
            </div>
            <div style={{ fontSize: 9, color: isSelected ? 'rgba(255,255,255,0.7)' : 'var(--muted)', marginTop: 2 }}>
              {d.monthStr}
            </div>
            {d.hasSlot && !isSelected && (
              <span style={{ position: 'absolute', bottom: 5, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', display: 'block' }} />
            )}
          </button>
        )
      })}
    </div>
  )
}

export default function TeacherProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const toast = useToastStore(s => s.toast)

  const [authModal, setAuthModal] = useState(null)
  const [teacher, setTeacher] = useState(null)
  const [availableDays, setAvailableDays] = useState([])
  const [selectedDate, setSelectedDate] = useState(null)
  const [slots, setSlots] = useState([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [bookingSlot, setBookingSlot] = useState(null)
  const [note, setNote] = useState('')
  const [subjectId, setSubjectId] = useState(null)   // 本节课科目（老师只教一科则自动选中）
  const [submitting, setSubmitting] = useState(false)
  const [showPanel, setShowPanel] = useState(false)

  useEffect(() => {
    getTeacher(id).then(r => {
      setTeacher(r.data)
      const subs = r.data.subjects || []
      if (subs.length === 1) setSubjectId(subs[0].id)   // 单科目自动选中
    }).catch(() => navigate('/courses'))
    // load next 2 months of available days
    const now = new Date()
    const promises = [0, 1].map(offset => {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
      return getAvailableDays(id, d.getFullYear(), d.getMonth() + 1)
    })
    Promise.all(promises).then(results => {
      const all = results.flatMap(r => r.data)
      setAvailableDays(all)
    }).catch(() => {})
  }, [id])

  // Build 30-day strip
  const days = []
  const today = new Date()
  for (let i = 0; i < 30; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const dateStr = ymd(d)
    const mo = d.getMonth() + 1
    const day = d.getDate()
    days.push({
      dateStr,
      weekday: d.getDay(),
      day,
      monthStr: `${mo}月`,
      hasSlot: availableDays.includes(dateStr),
    })
  }

  const selectDate = useCallback((date) => {
    setSelectedDate(date)
    setBookingSlot(null)
    setSlotsLoading(true)
    getSlotsByDate(id, date).then(r => setSlots(r.data)).catch(() => setSlots([])).finally(() => setSlotsLoading(false))
  }, [id])

  const doBook = async () => {
    if (!user) { toast('请先登录', true); return }
    if (!bookingSlot) return
    setSubmitting(true)
    try {
      await createBooking({ slotId: bookingSlot.id, note, subjectId })
      toast('预约成功，等待老师确认')
      setBookingSlot(null); setNote(''); setShowPanel(false)
      selectDate(selectedDate)
    } catch (e) {
      toast(e.response?.data || '预约失败', true)
    } finally { setSubmitting(false) }
  }

  if (!teacher) return (
    <div style={{ textAlign: 'center', padding: '5rem 1rem', color: 'var(--muted)' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>加载中…
    </div>
  )

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 0 6rem' }}>
      {/* 顶部导航 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg)', borderBottom: '1px solid var(--border)',
        padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flex: 1, padding: 0, minWidth: 0 }}>
          <span style={{ color: 'var(--muted)', fontSize: 26, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>‹</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>预约课程</span>
        </button>
        <button onClick={() => navigate('/courses/my-bookings')}
          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>
          我的预约
        </button>
      </div>

      {/* 老师信息卡 */}
      <div style={{ padding: '1rem 1rem 0' }}>
        <div style={{
          background: 'linear-gradient(135deg, #1e0d4e 0%, #0f1c46 60%, #080a18 100%)',
          border: '1px solid rgba(124,108,255,0.25)', borderRadius: 20, padding: '1.25rem',
          marginBottom: '1.25rem', display: 'flex', gap: 16, alignItems: 'flex-start',
        }}>
          {teacher.avatarUrl
            ? <img src={teacher.avatarUrl} alt="" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid rgba(124,108,255,0.4)' }} />
            : <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(124,108,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0 }}>👤</div>
          }
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#fff', marginBottom: 4 }}>{teacher.username} 老师</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {teacher.subjects?.map(s => (
                <span key={s.id} style={{ fontSize: 11, color: 'rgba(196,168,255,0.9)', background: 'rgba(124,108,255,0.2)', padding: '2px 8px', borderRadius: 10 }}>{s.name}</span>
              ))}
            </div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', margin: 0, lineHeight: 1.55,
              display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {teacher.bio || '该老师暂未填写简介'}
            </p>
          </div>
        </div>
      </div>

      {/* 日期选择区 */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ padding: '0 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>选择日期</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>蓝点表示有空档</span>
        </div>
        {days.some(d => d.hasSlot) ? (
          <DateStrip days={days} selectedDate={selectedDate} onSelect={selectDate} />
        ) : (
          <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
            最近30天暂无可预约时间，请稍后再来
          </div>
        )}
      </div>

      {/* 时间段列表 */}
      {selectedDate && (
        <div style={{ padding: '0 1rem' }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>
            {selectedDate} 可选时段
          </div>
          {slotsLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1,2,3].map(i => (
                <div key={i} style={{ height: 64, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }} />
              ))}
            </div>
          ) : slots.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem 0', fontSize: 14 }}>当天暂无时间段</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {slots.map(s => {
                const isSelected = bookingSlot?.id === s.id
                // 我已约过该时段：置灰显示「已预约」，不可再点（后端也会挡重复预约）
                const mineBooked = !!s.mineBooked
                // 群课：available 与 booked(已有人报名) 都可报名，只有已取消/我已约的不可选
                const bookable = s.status !== 'cancelled' && !mineBooked
                const isGroup = s.status === 'booked'
                return (
                  <button key={s.id}
                    disabled={!bookable}
                    onClick={() => {
                      setBookingSlot(isSelected ? null : s)
                      if (!isSelected) { setNote(''); setShowPanel(true) }
                      else setShowPanel(false)
                    }}
                    style={{
                      border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 14, padding: '14px 16px', cursor: bookable ? 'pointer' : 'not-allowed',
                      background: isSelected ? 'var(--accent-soft)' : 'var(--surface)',
                      textAlign: 'left', opacity: bookable ? 1 : 0.5, width: '100%',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      transition: 'border-color .12s, background .12s',
                    }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16, color: isSelected ? 'var(--accent)' : 'var(--text)' }}>
                        {s.startTime} – {s.endTime}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                        {s.durationMinutes}分钟
                        {s.note && ` · ${s.note}`}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20,
                      background: !bookable ? 'rgba(107,114,128,0.12)' : isSelected ? 'rgba(124,108,255,0.2)' : isGroup ? 'rgba(245,158,11,0.14)' : 'var(--green-soft)',
                      color: !bookable ? '#6b7280' : isSelected ? 'var(--accent)' : isGroup ? '#f59e0b' : '#10b981',
                    }}>
                      {mineBooked ? '已预约' : !bookable ? '已取消' : isSelected ? '已选' : isGroup ? '可拼班' : '可预约'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 底部预约确认面板 */}
      {showPanel && bookingSlot && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1100,
          background: 'var(--surface)', borderTop: '1px solid var(--border)',
          borderRadius: '20px 20px 0 0',
          // 底部留出移动端安全区，避免「确认预约」被底栏/home 指示条遮住、点不到
          padding: '1.25rem 1rem calc(1.5rem + env(safe-area-inset-bottom, 0px))',
          maxHeight: '85vh', overflowY: 'auto',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.25)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 3 }}>确认预约</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                {selectedDate} {bookingSlot.startTime}–{bookingSlot.endTime} · {bookingSlot.durationMinutes}分钟
              </div>
            </div>
            <button className="modal-x" onClick={() => { setShowPanel(false); setBookingSlot(null) }}>×</button>
          </div>

          {teacher.subjects?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>选择科目{teacher.subjects.length > 1 ? '（可选）' : ''}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {teacher.subjects.map(s => (
                  <button key={s.id} onClick={() => setSubjectId(subjectId === s.id ? null : s.id)}
                    style={{ padding: '7px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                      border: `1px solid ${subjectId === s.id ? 'var(--accent)' : 'var(--border)'}`,
                      background: subjectId === s.id ? 'var(--accent-soft)' : 'var(--bg)',
                      color: subjectId === s.id ? 'var(--accent)' : 'var(--text)', fontWeight: subjectId === s.id ? 700 : 400 }}>
                    {s.iconEmoji ? `${s.iconEmoji} ` : ''}{s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>备注给老师（可选）</div>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="告诉老师你的学习需求、希望讲的内容…"
              style={{ width: '100%', height: 72, borderRadius: 10, border: '1px solid var(--border)',
                padding: '10px 12px', fontSize: 16, resize: 'none', boxSizing: 'border-box',
                background: 'var(--bg)', color: 'var(--text)', outline: 'none', fontFamily: 'var(--sans)' }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          {!user ? (
            <button onClick={() => setAuthModal('login')}
              style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
              登录后预约
            </button>
          ) : (
            <button onClick={doBook} disabled={submitting}
              style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: 'none',
                background: submitting ? 'var(--muted)' : 'var(--accent)',
                color: '#fff', fontWeight: 700, fontSize: 15, cursor: submitting ? 'not-allowed' : 'pointer',
                transition: 'background .15s' }}>
              {submitting ? '提交中…' : '确认预约'}
            </button>
          )}
        </div>
      )}

      {authModal && <AuthModal initialMode={authModal} onClose={() => setAuthModal(null)} />}
    </div>
  )
}
