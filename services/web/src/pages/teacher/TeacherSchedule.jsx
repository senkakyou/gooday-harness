import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import useToastStore from '../../store/toastStore'
import { teacherSlots, createSlot, createSlotsBatch, deleteSlot, teacherBookings, teacherStudents, addStudentToSlot, addOfflineStudentToSlot, teacherCancelBooking } from '../../api/courses'
import PhotoScheduleModal from './PhotoScheduleModal'
import { ymd } from '../../utils/localDate'

// 群课状态标签
const BK_STATE = {
  pending:   { label: '待确认', color: '#f59e0b' },
  confirmed: { label: '已确认', color: 'var(--accent)' },
  completed: { label: '已上课', color: '#10b981' },
}

const pad = (n) => String(n).padStart(2, '0')
const weekDays = ['日','一','二','三','四','五','六']
const hhmmToMin = (t) => { const [h, m] = (t || '').split(':').map(Number); return Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null }
const minToHhmm = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`

// 由 "HH:mm" 起止时间算出时长（分钟），非法或非正返回 null
const calcDuration = (start, end) => {
  const toMin = (t) => { const [h, m] = (t || '').split(':').map(Number); return Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null }
  const s = toMin(start), e = toMin(end)
  if (s == null || e == null) return null
  const d = e - s
  return d > 0 ? d : null
}

// 时间区间 [s,e) 是否与当日已有时段重叠（HH:mm 字符串可直接比较；忽略已取消）
const overlaps = (s, e, list) => list.some(sl => sl.status !== 'cancelled' && s < sl.endTime && e > sl.startTime)

export default function TeacherSchedule() {
  const navigate = useNavigate()
  const toast = useToastStore(s => s.toast)
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [slots, setSlots] = useState([])
  const [selectedDate, setSelectedDate] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ startTime: '09:00', endTime: '10:00', note: '' })
  const [submitting, setSubmitting] = useState(false)
  const [bookings, setBookings] = useState([])     // 未取消的预约（用于显示报名学生）
  const [roster, setRoster] = useState([])         // 名单（加学生用，仅平台学生）
  const [addSlot, setAddSlot] = useState(null)     // 正在加学生的 slot
  const [addTab, setAddTab] = useState('online')   // 加学生弹窗：'online' | 'offline'
  const [picked, setPicked] = useState([])         // 多选待批量添加的时段 ["HH:mm-HH:mm", ...]
  const [batchNote, setBatchNote] = useState('')   // 批量添加的统一备注
  const [copyTo, setCopyTo] = useState('')         // 复制本日排班的目标日期
  const [showPhoto, setShowPhoto] = useState(false)
  const slotsRef = useRef(null)

  const today = ymd()

  const load = useCallback(() => {
    teacherSlots({ year, month }).then(r => setSlots(r.data)).catch(() => {})
    teacherBookings('all').then(r => setBookings((r.data || []).filter(b => b.status !== 'cancelled'))).catch(() => {})
  }, [year, month])

  useEffect(() => { load() }, [load])
  useEffect(() => { teacherStudents(false).then(r => setRoster(r.data || [])).catch(() => {}) }, [])

  // 某 slot 的报名学生（按 日期|开始时间 匹配）
  const studentsOf = (s) => bookings.filter(b => b.slot?.date === s.date && b.slot?.startTime === s.startTime)

  const firstDay = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const slotsByDate = {}
  slots.forEach(s => { if (!slotsByDate[s.date]) slotsByDate[s.date] = []; slotsByDate[s.date].push(s) })

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1) }

  const selectDate = (ds) => {
    setSelectedDate(ds)
    setShowAdd(false)
    setTimeout(() => slotsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const doAdd = async () => {
    if (!selectedDate) { toast('请先选择日期', true); return }
    if (form.startTime >= form.endTime) { toast('结束时间必须晚于开始时间', true); return }
    if (overlaps(form.startTime, form.endTime, daySlots)) { toast('该时段与当日已有排班冲突', true); return }
    setSubmitting(true)
    try {
      await createSlot({ date: selectedDate, ...form })
      toast('时间段已添加')
      setShowAdd(false)
      setForm({ startTime: '09:00', endTime: '10:00', note: '' })
      load()
    } catch (e) { toast(e.response?.data || '添加失败', true) }
    finally { setSubmitting(false) }
  }

  const doDelete = async (id) => {
    if (!confirm('确定删除该时间段？')) return
    try { await deleteSlot(id); toast('已删除'); load() }
    catch (e) { toast(e.response?.data || '删除失败', true) }
  }

  const doAddStudent = async (studentUserId) => {
    if (!addSlot) return
    try {
      await addStudentToSlot(addSlot.id, { studentUserId })
      toast('已加入该课')
      setAddSlot(null)
      load()
    } catch (e) { toast(e.response?.data || '添加失败', true) }
  }

  const doAddOfflineStudent = async (offlineStudentId) => {
    if (!addSlot) return
    try {
      await addOfflineStudentToSlot(addSlot.id, { offlineStudentId })
      toast('已加入该课')
      setAddSlot(null)
      load()
    } catch (e) { toast(e.response?.data || '添加失败', true) }
  }

  const doRemoveStudent = async (bookingId) => {
    if (!confirm('确定从这节课移除该学生？')) return
    try {
      await teacherCancelBooking(bookingId, { note: '老师移除' })
      toast('已移除')
      load()
    } catch (e) { toast(e.response?.data || '移除失败', true) }
  }

  // 时长快捷：按当前开始时间 + N 分钟设置结束时间（论坛#52：一节课1/2小时快速完成）
  const setDuration = (mins) => setForm(f => {
    const s = hhmmToMin(f.startTime)
    return s == null ? f : { ...f, endTime: minToHhmm(Math.min(s + mins, 23 * 60 + 59)) }
  })

  // 批量添加多选时段（论坛#52：一天多节课快速完成）
  const togglePick = (key) => setPicked(p => p.includes(key) ? p.filter(k => k !== key) : [...p, key])
  const doBatchAdd = async () => {
    if (!selectedDate || picked.length === 0) return
    const slots = picked.map(k => { const [s, e] = k.split('-'); return { date: selectedDate, startTime: s, endTime: e, note: batchNote } })
    try {
      const r = await createSlotsBatch(slots)
      const sk = r.data.skipped?.length || 0
      toast(`已添加 ${r.data.createdCount} 节${sk ? `，跳过 ${sk} 节（冲突）` : ''}`)
      setPicked([]); setBatchNote(''); setShowAdd(false); load()
    } catch (e) { toast(e.message || '批量添加失败', true) }
  }

  // 复制本日排班到目标日期（论坛#52：参照排完的某天直接复制）
  const doCopyDay = async () => {
    if (!copyTo) { toast('请选择目标日期', true); return }
    if (copyTo === selectedDate) { toast('目标日期不能是当天', true); return }
    const src = daySlots.filter(s => s.status !== 'cancelled')
    if (src.length === 0) { toast('本日没有可复制的排班', true); return }
    const slots = src.map(s => ({ date: copyTo, startTime: s.startTime, endTime: s.endTime, note: s.note }))
    try {
      const r = await createSlotsBatch(slots)
      const sk = r.data.skipped?.length || 0
      toast(`已复制 ${r.data.createdCount} 节到 ${copyTo}${sk ? `，跳过 ${sk} 节（冲突）` : ''}`)
      setCopyTo(''); load()
    } catch (e) { toast(e.message || '复制失败', true) }
  }

  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  const daySlots = selectedDate ? (slotsByDate[selectedDate] || []).sort((a, b) => a.startTime.localeCompare(b.startTime)) : []

  const QUICK_SLOTS = [
    { label: '上午', slots: [{ s: '08:00', e: '09:00' }, { s: '09:00', e: '10:00' }, { s: '10:00', e: '11:00' }, { s: '11:00', e: '12:00' }] },
    { label: '下午', slots: [{ s: '14:00', e: '15:00' }, { s: '15:00', e: '16:00' }, { s: '16:00', e: '17:00' }, { s: '17:00', e: '18:00' }] },
    { label: '晚上', slots: [{ s: '19:00', e: '20:00' }, { s: '20:00', e: '21:00' }] },
    { label: '两小时整段', slots: [{ s: '08:00', e: '10:00' }, { s: '10:00', e: '12:00' }, { s: '14:00', e: '16:00' }, { s: '16:00', e: '18:00' }, { s: '19:00', e: '21:00' }] },
  ]

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 0 5rem' }}>
      {/* 顶部导航 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg)', borderBottom: '1px solid var(--border)',
        padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={() => navigate('/teacher/dashboard')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, flex: 1, padding: 0, minWidth: 0 }}>
          <span style={{ color: 'var(--muted)', fontSize: 22, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>‹</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>排班管理</span>
        </button>
        <button onClick={() => setShowPhoto(true)}
          style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '6px 12px', borderRadius: 9, marginRight: 8 }}>📷 拍照排课</button>
        <button onClick={() => navigate('/teacher/timetable')}
          style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '6px 12px', borderRadius: 9 }}>📅 课表</button>
      </div>

      <div style={{ padding: '1rem' }}>
        {/* ── 月历 ── */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '1.25rem', marginBottom: 16 }}>
          {/* 月导航 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <button onClick={prevMonth}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--muted)', padding: '0 8px', lineHeight: 1 }}>
              ‹
            </button>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{year}年{month}月</span>
            <button onClick={nextMonth}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--muted)', padding: '0 8px', lineHeight: 1 }}>
              ›
            </button>
          </div>
          {/* 星期行 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
            {weekDays.map(w => (
              <div key={w} style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', padding: '4px 0' }}>{w}</div>
            ))}
          </div>
          {/* 日期格 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} />
              const ds = `${year}-${pad(month)}-${pad(d)}`
              const count = (slotsByDate[ds] || []).length
              const isPast = ds < today
              const isSelected = ds === selectedDate
              const isToday = ds === today
              return (
                <button key={ds}
                  onClick={() => selectDate(ds)}
                  style={{
                    border: isSelected ? '2px solid var(--accent)' : isToday ? '2px solid rgba(124,108,255,0.4)' : '2px solid transparent',
                    borderRadius: 10, padding: '8px 0', fontSize: 14, cursor: isPast ? 'default' : 'pointer',
                    background: isSelected ? 'var(--accent)' : count > 0 ? 'var(--accent-soft)' : 'transparent',
                    color: isSelected ? '#fff' : isPast ? 'var(--muted)' : count > 0 ? 'var(--accent)' : 'var(--text)',
                    opacity: isPast ? 0.4 : 1, fontWeight: isSelected || isToday ? 700 : 400, position: 'relative',
                    textAlign: 'center',
                  }}>
                  {d}
                  {count > 0 && !isSelected && (
                    <span style={{ position: 'absolute', top: 2, right: 3, fontSize: 9, color: 'var(--accent)', fontWeight: 700 }}>{count}</span>
                  )}
                </button>
              )
            })}
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 16 }}>
            <span>🟣 已有时间段</span>
            <span>点击日期管理排班</span>
          </div>
        </div>

        {/* ── 选中日期的时间段 ── */}
        {selectedDate && (
          <div ref={slotsRef} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{selectedDate}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {weekDays[new Date(selectedDate + 'T00:00:00').getDay()]}曜日 · {daySlots.length} 个时段
                </div>
              </div>
              {selectedDate >= today && (
                <button onClick={() => setShowAdd(v => !v)}
                  style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: showAdd ? 'var(--border)' : 'var(--accent)', color: showAdd ? 'var(--text)' : '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'background .15s' }}>
                  {showAdd ? '收起' : '+ 新增时段'}
                </button>
              )}
            </div>

            {/* 复制本日排班到其它日期（论坛#52：参照排完的某天直接复制）*/}
            {daySlots.some(s => s.status !== 'cancelled') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14, padding: '10px 12px', borderRadius: 12, background: 'var(--bg)', border: '1px dashed var(--border)' }}>
                <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>📋 复制本日排班到</span>
                <input type="date" value={copyTo} min={today} onChange={e => setCopyTo(e.target.value)}
                  style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 16, background: 'var(--surface)', color: 'var(--text)' }} />
                <button onClick={doCopyDay} disabled={!copyTo}
                  style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: copyTo ? 'pointer' : 'not-allowed', opacity: copyTo ? 1 : 0.5 }}>复制</button>
              </div>
            )}

            {/* 新增表单 */}
            {showAdd && selectedDate >= today && (
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '1rem', marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>添加时间段</div>

                {/* 快速选择：可多选，一次性批量添加（一天多节课快速完成）*/}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>快速选择（可多选，下方一键批量添加；单选则填入下方表单）</div>
                  {QUICK_SLOTS.map(group => (
                    <div key={group.label} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{group.label}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {group.slots.map(q => {
                          const key = `${q.s}-${q.e}`
                          const taken = overlaps(q.s, q.e, daySlots)
                          const sel = picked.includes(key)
                          return (
                            <button key={key} disabled={taken}
                              onClick={() => { togglePick(key); setForm(f => ({ ...f, startTime: q.s, endTime: q.e })) }}
                              title={taken ? '该时段已排班' : ''}
                              style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${sel ? 'var(--accent)' : 'var(--border)'}`,
                                background: taken ? 'var(--bg)' : sel ? 'var(--accent)' : 'var(--surface)',
                                color: taken ? 'var(--muted)' : sel ? '#fff' : 'var(--text)',
                                fontSize: 12, cursor: taken ? 'not-allowed' : 'pointer',
                                opacity: taken ? 0.55 : 1, textDecoration: taken ? 'line-through' : 'none' }}>
                              {sel ? '✓ ' : ''}{q.s}–{q.e}{taken ? ' 已排' : ''}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                  {picked.length > 0 && (
                    <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--accent-soft)', border: '1px solid var(--accent)' }}>
                      <div style={{ fontSize: 12.5, color: 'var(--accent)', fontWeight: 600, marginBottom: 8 }}>已选 {picked.length} 个时段，将一次性批量添加</div>
                      <input value={batchNote} onChange={e => setBatchNote(e.target.value)} placeholder="统一备注（可选）"
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 16, background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box', marginBottom: 8, fontFamily: 'var(--sans)' }} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={doBatchAdd}
                          style={{ flex: 1, padding: '10px 0', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>批量添加 {picked.length} 节</button>
                        <button onClick={() => setPicked([])}
                          style={{ padding: '10px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, cursor: 'pointer' }}>清空</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 手动时间 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>开始时间</div>
                    <input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                      style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 16, background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>结束时间</div>
                    <input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                      style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 16, background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box' }} />
                  </div>
                </div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>课程时长（点按从开始时间快速设置）</div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    {[{ m: 30, l: '30分钟' }, { m: 60, l: '1小时' }, { m: 90, l: '1.5小时' }, { m: 120, l: '2小时' }].map(d => {
                      const active = calcDuration(form.startTime, form.endTime) === d.m
                      return (
                        <button key={d.m} onClick={() => setDuration(d.m)}
                          style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent)' : 'var(--surface)', color: active ? '#fff' : 'var(--text)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{d.l}</button>
                      )
                    })}
                  </div>
                  {(() => {
                    const dur = calcDuration(form.startTime, form.endTime)
                    const conflict = dur != null && overlaps(form.startTime, form.endTime, daySlots)
                    return (
                      <>
                        <div style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14,
                          background: 'var(--surface)', color: dur == null ? '#ef4444' : 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>⏱</span>
                          <span>{dur == null ? '结束时间需晚于开始时间' : `${dur} 分钟（按起止时间自动计算）`}</span>
                        </div>
                        {conflict && (
                          <div style={{ marginTop: 6, fontSize: 12, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span>⚠️</span><span>该时段与当日已有排班冲突，请调整</span>
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>备注（可选）</div>
                  <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                    placeholder="例：仅限高中化学、线上授课"
                    style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 16, background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box', outline: 'none', fontFamily: 'var(--sans)' }} />
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={doAdd} disabled={submitting}
                    style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>
                    {submitting ? '保存中…' : '保存时间段'}
                  </button>
                  <button onClick={() => setShowAdd(false)}
                    style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 14 }}>
                    取消
                  </button>
                </div>
              </div>
            )}

            {/* 时间段列表 */}
            {daySlots.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem 0', fontSize: 14 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                当天暂无时间段，点击上方「+ 新增时段」添加
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {daySlots.map(s => {
                  const enrolled = studentsOf(s)
                  return (
                  <div key={s.id} style={{
                    padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)',
                    background: s.status === 'booked' ? 'var(--accent-soft)' : 'var(--bg)',
                  }}>
                    {/* 头行：时间 + 状态 + 删除 */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: s.status === 'booked' ? 'var(--accent)' : 'var(--text)' }}>
                          {s.startTime} – {s.endTime}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                          {s.durationMinutes}分钟
                          {s.note && ` · ${s.note}`}
                          {enrolled.length > 0 && ` · ${enrolled.length} 人报名`}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 16,
                          color: s.status === 'booked' ? 'var(--accent)' : s.status === 'available' ? '#10b981' : 'var(--muted)',
                          background: s.status === 'booked' ? 'rgba(124,108,255,0.12)' : s.status === 'available' ? 'rgba(16,185,129,0.1)' : 'var(--bg)',
                        }}>
                          {s.status === 'available' ? '空闲' : s.status === 'booked' ? '已预约' : '已取消'}
                        </span>
                        {s.status !== 'booked' && (
                          <button onClick={() => doDelete(s.id)}
                            style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: '#ef4444', fontSize: 12, cursor: 'pointer' }}>
                            删除
                          </button>
                        )}
                      </div>
                    </div>
                    {/* 报名学生 + 加学生 */}
                    {s.status !== 'cancelled' && (
                      <div style={{ marginTop: 10, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                        {enrolled.length === 0 ? (
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>暂无学生报名</div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {enrolled.map(b => {
                              const st = BK_STATE[b.status] || BK_STATE.confirmed
                              const name = b.offlineStudent?.displayName || b.student?.username || '学生'
                              return (
                                <span key={b.id} style={{ fontSize: 12, padding: '3px 6px 3px 9px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                                  <span style={{ fontWeight: 600 }}>{name}</span>
                                  <span style={{ color: st.color, fontWeight: 600 }}>{st.label}</span>
                                  <button onClick={() => doRemoveStudent(b.id)}
                                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, lineHeight: 1, padding: '0 2px', display: 'flex', alignItems: 'center' }}
                                    title="移除该学生">×</button>
                                </span>
                              )
                            })}
                          </div>
                        )}
                        <button onClick={() => { setAddSlot(s); setAddTab('online') }}
                          style={{ marginTop: 8, padding: '5px 12px', borderRadius: 8, border: '1px dashed var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          + 加学生
                        </button>
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {!selectedDate && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem 0', fontSize: 14 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>👆</div>
            点击上方日历选择日期，开始管理排班
          </div>
        )}
      </div>

      {/* 加学生选名单 */}
      {addSlot && (
        <div onClick={() => setAddSlot(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--surface)', borderTopLeftRadius: 18, borderTopRightRadius: 18, width: '100%', maxWidth: 680, maxHeight: '75vh', overflowY: 'auto', padding: '1.25rem' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>加学生到这节课</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{addSlot.startTime}–{addSlot.endTime}</div>
            {/* 标签页切换 */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
              {[{ key: 'online', label: '平台学生' }, { key: 'offline', label: '线下学生' }].map(tab => (
                <button key={tab.key} onClick={() => setAddTab(tab.key)}
                  style={{ flex: 1, padding: '9px 0', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    background: addTab === tab.key ? 'var(--accent)' : 'var(--bg)',
                    color: addTab === tab.key ? '#fff' : 'var(--muted)' }}>
                  {tab.label}
                </button>
              ))}
            </div>
            {addTab === 'online' && (() => {
              const alreadyOnline = new Set(studentsOf(addSlot).filter(b => b.student?.id).map(b => b.student.id))
              const pickable = roster.filter(r => r.studentUserId && !alreadyOnline.has(r.studentUserId))
              if (!roster.some(r => r.studentUserId)) return <div style={{ color: 'var(--muted)', fontSize: 14, padding: '1rem 0' }}>名单里还没有绑定平台账号的学生</div>
              if (pickable.length === 0) return <div style={{ color: 'var(--muted)', fontSize: 14, padding: '1rem 0' }}>名单里的平台学生都已在这节课</div>
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {pickable.map(r => (
                    <button key={r.id} onClick={() => doAddStudent(r.studentUserId)}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', textAlign: 'left' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{r.displayName}</span>
                      <span style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 600 }}>+ 加入</span>
                    </button>
                  ))}
                </div>
              )
            })()}
            {addTab === 'offline' && (() => {
              const alreadyOffline = new Set(studentsOf(addSlot).filter(b => b.offlineStudent?.id).map(b => b.offlineStudent.id))
              const pickable = roster.filter(r => !r.studentUserId && !alreadyOffline.has(r.id))
              if (!roster.some(r => !r.studentUserId)) return <div style={{ color: 'var(--muted)', fontSize: 14, padding: '1rem 0' }}>名单里还没有线下学生，请先在「学生管理」添加</div>
              if (pickable.length === 0) return <div style={{ color: 'var(--muted)', fontSize: 14, padding: '1rem 0' }}>线下学生都已在这节课</div>
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {pickable.map(r => (
                    <button key={r.id} onClick={() => doAddOfflineStudent(r.id)}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', textAlign: 'left' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{r.displayName}</span>
                      <span style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 600 }}>+ 加入</span>
                    </button>
                  ))}
                </div>
              )
            })()}
            <button onClick={() => setAddSlot(null)}
              style={{ marginTop: 14, width: '100%', padding: '11px 0', borderRadius: 10, border: '1px solid var(--border)', background: 'none', fontSize: 14, cursor: 'pointer' }}>关闭</button>
          </div>
        </div>
      )}

      {/* 拍照排课 */}
      {showPhoto && (
        <PhotoScheduleModal onClose={() => setShowPhoto(false)} onGenerated={load} />
      )}
    </div>
  )
}
