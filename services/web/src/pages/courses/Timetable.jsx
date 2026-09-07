import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useToastStore from '../../store/toastStore'
import useAuthStore from '../../store/authStore'
import { myBookings, teacherBookings, teacherSlots } from '../../api/courses'
import { renderNodeToPngUrl, exportNodeAsPdf } from '../../utils/exportNode'
import ExportPreview from '../../components/ExportPreview'

// 打印用浅色调色板（不跟随站点深色主题，导出更清晰）
const C = {
  bg: '#ffffff', ink: '#1a1a2e', sub: '#6b7280', line: '#e5e7eb',
  accent: '#6d5dfc', soft: '#f4f3ff', ok: '#10b981', warn: '#f59e0b',
}
const WD = ['一', '二', '三', '四', '五', '六', '日']   // 周一起

// 每种状态 → 文案 / 标记 / 颜色（empty 仅老师端出现）
const STATE = {
  empty:     { label: '无人报名', icon: '⚪', color: C.sub,    soft: '#f5f5f5' },
  offline:   { label: '线下',     icon: '📌', color: '#6b7280', soft: '#f3f4f6' },
  pending:   { label: '待确认',   icon: '⏳', color: C.warn,   soft: '#fff7ed' },
  confirmed: { label: '已确认',   icon: '✅', color: C.accent, soft: C.soft },
  completed: { label: '已上课',   icon: '🟢', color: C.ok,     soft: '#f0fdf4' },
}

const pad = (n) => String(n).padStart(2, '0')
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
// 取所在周的周一
const mondayOf = (d) => { const x = new Date(d); const off = (x.getDay() + 6) % 7; return addDays(x, -off) }
// 周内索引（周一=0）
const weekdayIdx = (d) => (d.getDay() + 6) % 7

// 课程表（老师/学生共用）。mode: 'teacher' | 'student'
export default function Timetable({ mode }) {
  const navigate = useNavigate()
  const toast = useToastStore(s => s.toast)
  const username = useAuthStore(s => s.user?.username)
  const [bookings, setBookings] = useState([])
  const [slots, setSlots] = useState([])          // 老师端：所有排班（含没人报名的）
  const [loading, setLoading] = useState(true)
  const [anchor, setAnchor] = useState(() => new Date())   // 当前周/月内任意一天
  const [viewMode, setViewMode] = useState('week')         // 'week' | 'month'
  const [busy, setBusy] = useState(null)
  const [preview, setPreview] = useState(null)    // 图片预览浮层的 dataURL
  const sheetRef = useRef(null)

  const weekStart = useMemo(() => mondayOf(anchor), [anchor])

  const days = useMemo(() => {
    if (viewMode === 'week') {
      return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    } else {
      const y = anchor.getFullYear(), mo = anchor.getMonth()
      const count = new Date(y, mo + 1, 0).getDate()
      return Array.from({ length: count }, (_, i) => new Date(y, mo, i + 1))
    }
  }, [viewMode, anchor, weekStart])

  const startStr = useMemo(() => fmt(days[0]), [days])
  const endStr   = useMemo(() => fmt(days[days.length - 1]), [days])
  const todayStr = fmt(new Date())

  // 预约：老师拉全部、学生拉自己的（只取一次）
  useEffect(() => {
    const req = mode === 'teacher' ? teacherBookings('all') : myBookings()
    req.then(r => setBookings(r.data)).catch(() => setBookings([])).finally(() => setLoading(false))
  }, [mode])

  // 老师端：按当前显示范围覆盖的月份拉排班（跨月时拉两个月，去重）
  useEffect(() => {
    if (mode !== 'teacher') return
    const months = [...new Set(days.map(d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`))]
    Promise.all(months.map(ym => {
      const [y, m] = ym.split('-')
      return teacherSlots({ year: Number(y), month: Number(m) }).then(r => r.data).catch(() => [])
    })).then(arrs => {
      const seen = new Set(), merged = []
      for (const s of arrs.flat()) { if (!seen.has(s.id)) { seen.add(s.id); merged.push(s) } }
      setSlots(merged)
    })
  }, [mode, startStr])  // eslint-disable-line react-hooks/exhaustive-deps

  // 按日期分组的课程条目。每条 entry = 一节课（一个时段），students 为该课的报名学生（群课可多人）
  const byDate = useMemo(() => {
    const m = {}
    if (mode === 'student') {
      for (const b of bookings) {
        if (b.status === 'cancelled' || !b.slot?.date) continue
        const d = b.slot.date
        if (d < startStr || d > endStr) continue
        const fallback = (b.teacher?.subjects || []).map(s => s.name).join('/')
        ;(m[d] ||= []).push({
          key: `b${b.id}`, start: b.slot.startTime, end: b.slot.endTime, empty: false,
          students: [{ name: b.teacher?.username || '老师', sub: b.subject?.name || b.slot?.note || fallback || '', state: b.status }],
        })
      }
    } else {
      const bookMap = {}
      for (const b of bookings) {
        if (!['pending', 'confirmed', 'completed'].includes(b.status)) continue
        if (!b.slot?.date) continue
        const k = `${b.slot.date}|${b.slot.startTime}`
        ;(bookMap[k] ||= []).push(b)
      }
      for (const s of slots) {
        if (s.status === 'cancelled') continue
        if (s.date < startStr || s.date > endStr) continue
        const bs = bookMap[`${s.date}|${s.startTime}`] || []
        const students = bs.map(b => ({ name: b.offlineStudent?.displayName || b.student?.username || '学生', sub: b.subject?.name || '', state: b.status }))
        if (students.length === 0 && s.note) {
          students.push({ name: s.note, sub: '', state: 'offline' })
        }
        ;(m[s.date] ||= []).push({
          key: `s${s.id}`, start: s.startTime, end: s.endTime,
          empty: students.length === 0, students,
        })
      }
    }
    for (const d in m) m[d].sort((a, b) => (a.start || '').localeCompare(b.start || ''))
    return m
  }, [bookings, slots, startStr, endStr, mode])

  const totalCount = days.reduce((s, d) => s + (byDate[fmt(d)]?.length || 0), 0)
  const title = `${username || ''} · 课表`
  const back = mode === 'teacher' ? '/teacher/schedule' : '/courses/my-bookings'
  const legend = mode === 'teacher'
    ? ['empty', 'offline', 'pending', 'confirmed', 'completed']
    : ['pending', 'confirmed', 'completed']

  // 导航
  const goPrev = () => {
    if (viewMode === 'week') setAnchor(a => addDays(a, -7))
    else setAnchor(a => { const x = new Date(a); x.setMonth(x.getMonth() - 1); return x })
  }
  const goNext = () => {
    if (viewMode === 'week') setAnchor(a => addDays(a, 7))
    else setAnchor(a => { const x = new Date(a); x.setMonth(x.getMonth() + 1); return x })
  }
  const goToday = () => setAnchor(new Date())

  // 当前显示范围文字
  const periodLabel = viewMode === 'week'
    ? `${startStr.slice(5)} – ${endStr.slice(5)}`
    : `${anchor.getFullYear()}年${anchor.getMonth() + 1}月`

  const exportFilename = viewMode === 'week'
    ? `课表_${startStr}`
    : `课表_${anchor.getFullYear()}-${pad(anchor.getMonth() + 1)}`

  const exportImage = async () => {
    if (!sheetRef.current) return
    setBusy('image')
    try {
      const url = await renderNodeToPngUrl(sheetRef.current)
      setPreview(url)
    } catch (e) { toast('生成失败，请重试', true) }
    finally { setBusy(null) }
  }

  const exportPdf = async () => {
    if (!sheetRef.current) return
    setBusy('pdf')
    try { await exportNodeAsPdf(sheetRef.current, exportFilename) }
    catch (e) { toast('导出失败，请重试', true) }
    finally { setBusy(null) }
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 0 5rem' }}>
      {/* 顶部导航 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)', borderBottom: '1px solid var(--border)', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate(back)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flex: 1, padding: 0, minWidth: 0 }}>
          <span style={{ color: 'var(--muted)', fontSize: 26, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>‹</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>我的课表</span>
        </button>
        {/* 周/月切换 */}
        <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {['week', 'month'].map((vm, i) => (
            <button key={vm} onClick={() => setViewMode(vm)}
              style={{ padding: '5px 14px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: viewMode === vm ? 700 : 400,
                background: viewMode === vm ? 'var(--accent)' : 'transparent',
                color: viewMode === vm ? '#fff' : 'var(--muted)',
                borderRight: i === 0 ? '1px solid var(--border)' : 'none' }}>
              {vm === 'week' ? '按周' : '按月'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '1rem' }}>
        {/* 日期导航 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 6 }}>
          <button onClick={goPrev} style={navBtn}>‹</button>
          <span style={{ fontWeight: 700, fontSize: 15, minWidth: 120, textAlign: 'center' }}>{periodLabel}</span>
          <button onClick={goNext} style={navBtn}>›</button>
        </div>
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <button onClick={goToday}
            style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
            {viewMode === 'week' ? '回到本周' : '回到本月'}
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '4rem 0' }}>加载中…</div>
        ) : (
          <>
            {/* 浅色竖排日程表（导出对象） */}
            <div style={{ borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
              <div ref={sheetRef} style={{ background: C.bg, color: C.ink, padding: '18px 16px' }}>
                {/* 表头信息 */}
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 4 }}>
                  <div style={{ fontSize: 17, fontWeight: 800 }}>{title}</div>
                  <div style={{ fontSize: 12, color: C.sub }}>
                    {viewMode === 'week' ? `${startStr} ~ ${endStr}` : `${anchor.getFullYear()}年${anchor.getMonth() + 1}月`}
                    {' · '}共 {totalCount} 节
                  </div>
                </div>

                {/* 日程列表 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {days.map((d) => {
                    const ds = fmt(d)
                    const list = byDate[ds] || []
                    const isToday = ds === todayStr
                    const wdIdx = weekdayIdx(d)
                    return (
                      <div key={ds}>
                        {/* 日期头 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', borderBottom: `2px solid ${isToday ? C.accent : C.line}`, marginBottom: 6 }}>
                          <span style={{ fontSize: 14, fontWeight: 800, color: isToday ? C.accent : C.ink }}>周{WD[wdIdx]}</span>
                          <span style={{ fontSize: 12, color: C.sub }}>{ds.slice(5)}</span>
                          {isToday && <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: C.accent, borderRadius: 6, padding: '1px 6px' }}>今天</span>}
                          {list.length > 0 && <span style={{ marginLeft: 'auto', fontSize: 11, color: C.sub }}>{list.length} 节</span>}
                        </div>
                        {/* 当天条目 */}
                        {list.length === 0 ? (
                          <div style={{ fontSize: 12, color: C.line, padding: '4px 2px 8px' }}>
                            {mode === 'teacher' ? '本日无排班' : '本日无课'}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 4 }}>
                            {list.map(c => {
                              const blockSt = c.empty ? STATE.empty
                                : c.students.some(s => s.state === 'pending') ? STATE.pending
                                : c.students.every(s => s.state === 'completed') ? STATE.completed : STATE.confirmed
                              return (
                                <div key={c.key} style={{ borderLeft: `4px solid ${blockSt.color}`, background: blockSt.soft, borderRadius: 6, padding: '8px 12px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{c.start}{c.end ? `–${c.end}` : ''}</span>
                                    {c.empty
                                      ? <span style={{ fontSize: 11, fontWeight: 700, color: STATE.empty.color, whiteSpace: 'nowrap' }}>{STATE.empty.icon} {STATE.empty.label}</span>
                                      : (mode === 'teacher' && c.students.length > 1) && <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, whiteSpace: 'nowrap' }}>👥 {c.students.length} 人</span>}
                                  </div>
                                  {c.empty ? (
                                    <div style={{ fontSize: 12, color: C.sub, marginTop: 3 }}>（待学生预约）</div>
                                  ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                                      {c.students.map((p, idx) => {
                                        const ps = STATE[p.state] || STATE.confirmed
                                        return (
                                          <div key={idx} style={{ display: 'grid', gridTemplateColumns: mode === 'teacher' ? 'minmax(0,1fr) auto' : 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)', alignItems: 'center', columnGap: 8, fontSize: 13, color: C.ink, paddingLeft: 10 }}>
                                            <span style={{ fontWeight: 600, wordBreak: 'break-all' }}>{p.name}</span>
                                            {mode !== 'teacher' && <span style={{ color: C.sub, textAlign: 'center', wordBreak: 'break-all' }}>{p.sub || ''}</span>}
                                            <span style={{ fontSize: 11, fontWeight: 700, color: ps.color, textAlign: 'right', whiteSpace: 'nowrap' }}>{ps.icon} {ps.label}</span>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* 图例 */}
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center', marginTop: 16, fontSize: 11, color: C.sub }}>
                  {legend.map(k => (
                    <span key={k}><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: STATE[k].color, marginRight: 4, verticalAlign: 'middle' }} />{STATE[k].label}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* 导出 */}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={exportImage} disabled={!!busy || totalCount === 0}
                style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700, opacity: totalCount === 0 ? 0.5 : 1 }}>
                {busy === 'image' ? '生成中…' : '导出图片'}
              </button>
              <button onClick={exportPdf} disabled={!!busy || totalCount === 0}
                style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: '1.5px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', cursor: 'pointer', fontSize: 14, fontWeight: 700, opacity: totalCount === 0 ? 0.5 : 1 }}>
                {busy === 'pdf' ? '生成中…' : '导出 PDF'}
              </button>
            </div>
            {totalCount === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, marginTop: 12 }}>
                {mode === 'teacher'
                  ? (viewMode === 'week' ? '本周暂无排班或预约' : '本月暂无排班或预约')
                  : (viewMode === 'week' ? '本周暂无课程' : '本月暂无课程')}
              </div>
            )}
          </>
        )}
      </div>

      {/* 图片预览浮层：手机长按可保存到相册 */}
      <ExportPreview url={preview} filename={`${exportFilename}.png`} alt="课表" onClose={() => setPreview(null)} />
    </div>
  )
}

const navBtn = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', color: 'var(--text)', fontSize: 18 }
