import React, { useRef, useState, useEffect } from 'react'
import useToastStore from '../../store/toastStore'
import { recognizeSchedule, createSlotsBatch, teacherProfile, pollRecognizeJob, teacherSlots } from '../../api/courses'

const pad = (n) => String(n).padStart(2, '0')
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const mondayOf = (d) => { const x = new Date(d); const off = (x.getDay() + 6) % 7; x.setDate(x.getDate() - off); return x }
const fmtMonth = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`

const STD_TAG = '【Gooday标准模板：时间段预印在左列，格子里只有学生姓名，列标题是星期或日期数字；月课表列标题是1-31日期数字，每格只填学生姓名】'

const compressImage = (file) => new Promise((resolve) => {
  const img = new Image()
  const url = URL.createObjectURL(file)
  img.onload = () => {
    const MAX = 1500
    let { width: w, height: h } = img
    if (w > MAX || h > MAX) {
      if (w >= h) { h = Math.round(h * MAX / w); w = MAX }
      else { w = Math.round(w * MAX / h); h = MAX }
    }
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    URL.revokeObjectURL(url)
    canvas.toBlob(blob => resolve(new File([blob], file.name, { type: 'image/jpeg' })), 'image/jpeg', 0.88)
  }
  img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
  img.src = url
})

// 判断一行草稿与已有时间段的关系
// 返回 'new' | 'duplicate' | 'updated'
// note 不比较：存入 DB 时会拼上科目前缀，与 OCR 原始值永远不同
function getRowStatus(row, existingSlots) {
  const match = existingSlots.find(s => s.date === row.date && s.startTime === row.startTime)
  if (!match) return 'new'
  if (match.endTime === row.endTime) return 'duplicate'
  return 'updated'
}

const STATUS_STYLE = {
  new:       { label: '新规',   bg: '#dcfce7', color: '#16a34a', border: '#86efac' },
  duplicate: { label: '已导入', bg: '#f3f4f6', color: '#6b7280', border: '#d1d5db' },
  updated:   { label: '有更新', bg: '#fff7ed', color: '#ea580c', border: '#fdba74' },
}

export default function PhotoScheduleModal({ onClose, onGenerated }) {
  const toast = useToastStore(s => s.toast)
  const fileRef = useRef(null)
  const [step, setStep] = useState('upload')
  const [mockNote, setMockNote] = useState(null)
  const [weekStart, setWeekStart] = useState(fmt(mondayOf(new Date())))
  const [rows, setRows] = useState([])
  const [rowChecked, setRowChecked] = useState([])     // parallel to rows: boolean[]
  const [rowStatus, setRowStatus] = useState([])       // parallel to rows: 'new'|'duplicate'|'updated'
  const [busy, setBusy] = useState(false)
  const [subjects, setSubjects] = useState([])
  const [pollCount, setPollCount] = useState(0)
  const [hint, setHint] = useState(STD_TAG)
  const [targetMonth, setTargetMonth] = useState(fmtMonth(new Date()))
  const [isMonthly, setIsMonthly] = useState(false)
  const [useStdTemplate, setUseStdTemplate] = useState(true)
  const [existingSlots, setExistingSlots] = useState([])

  useEffect(() => {
    teacherProfile().then(r => setSubjects(r.data.subjects || [])).catch(() => {})
  }, [])

  // 从草稿 rows 确定所有涉及的 year/month 组合，批量拉取已有时间段
  const fetchExistingForRows = async (draftRows) => {
    const months = new Set(draftRows.map(r => r.date?.slice(0, 7)).filter(Boolean))
    const all = []
    for (const ym of months) {
      const [y, m] = ym.split('-')
      try {
        const res = await teacherSlots({ year: Number(y), month: Number(m) })
        all.push(...(res.data || []))
      } catch { /* 拉取失败时静默，不影响主流程 */ }
    }
    return all
  }

  const dateFromWeekday = (wd, ws) => {
    const base = new Date(ws + 'T00:00:00')
    base.setDate(base.getDate() + (Math.min(Math.max(wd, 1), 7) - 1))
    return fmt(base)
  }

  const onPick = async (e) => {
    const raw = e.target.files?.[0]
    if (!raw) return
    setStep('recognizing'); setMockNote(null)
    try {
      const file = await compressImage(raw)
      const fd = new FormData(); fd.append('file', file)
      if (hint.trim()) fd.append('hint', hint.trim())

      const startResp = await recognizeSchedule(fd)
      const jobId = startResp.data.jobId
      setPollCount(0)

      let data = null
      for (let i = 0; i < 75; i++) {
        await new Promise(r => setTimeout(r, 4000))
        setPollCount(i + 1)
        const poll = await pollRecognizeJob(jobId)
        if (poll.data.status === 'done') { data = poll.data; break }
        if (poll.data.status === 'error') throw new Error(poll.data.message || '识别失败')
      }
      if (!data) throw new Error('识别超时，请重试')

      const ws = fmt(mondayOf(new Date()))
      setWeekStart(ws)
      const now = new Date()
      const curYear = now.getFullYear()

      const entriesWithDate = (data.entries || []).filter(en => en.date)
      const hasWrongYear = entriesWithDate.some(en => {
        const y = parseInt(en.date?.slice(0, 4) || '0')
        return y > 0 && y !== curYear
      })
      const uniqueDates = new Set(entriesWithDate.map(en => en.date?.slice(0, 10)).filter(Boolean))
      const monthly = entriesWithDate.length > 0 && (hasWrongYear || uniqueDates.size > 7)
      setIsMonthly(monthly)
      const tm = fmtMonth(now)
      setTargetMonth(tm)

      const applyTargetMonth = (dateStr, month) => {
        const day = dateStr?.slice(8, 10) || '01'
        return `${month}-${day}`
      }

      const draft = (data.entries || []).map(en => ({
        date: en.date
          ? (monthly ? applyTargetMonth(en.date, tm) : en.date)
          : (en.weekday ? dateFromWeekday(en.weekday, ws) : ws),
        startTime: en.startTime || '09:00',
        endTime: en.endTime || '10:00',
        subjectId: subjects.length === 1 ? subjects[0].id : null,
        note: en.note || '',
      }))

      // 拉取已有时间段，计算每行状态
      const existing = await fetchExistingForRows(draft)
      setExistingSlots(existing)
      const statuses = draft.map(r => getRowStatus(r, existing))
      setRowStatus(statuses)
      // 新规✓ 有更新✓ 已导入✗
      setRowChecked(statuses.map(s => s !== 'duplicate'))

      setRows(draft)
      setMockNote(data.message || null)
      setStep('draft')
      if (draft.length === 0) toast('没识别出课程，可手动添加', true)
    } catch (err) {
      toast(err.message || '识别失败，请重试', true)
      setStep('upload')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // 平移日期后重新拉取已有时间段并刷新状态
  const recomputeStatuses = async (newRows, forceExisting) => {
    const slots = forceExisting ?? (await fetchExistingForRows(newRows))
    setExistingSlots(slots)
    const statuses = newRows.map(r => getRowStatus(r, slots))
    setRowStatus(statuses)
    setRowChecked(statuses.map(s => s !== 'duplicate'))
  }

  const shiftWeek = async (newWs) => {
    const oldBase = new Date(weekStart + 'T00:00:00')
    const newBase = new Date(newWs + 'T00:00:00')
    const diffDays = Math.round((newBase - oldBase) / 86400000)
    const newRows = rows.map(r => {
      const d = new Date(r.date + 'T00:00:00'); d.setDate(d.getDate() + diffDays)
      return { ...r, date: fmt(d) }
    })
    setRows(newRows)
    setWeekStart(newWs)
    await recomputeStatuses(newRows)
  }

  const shiftMonth = async (newMonth) => {
    const newRows = rows.map(r => {
      const day = r.date?.slice(8, 10) || '01'
      return { ...r, date: `${newMonth}-${day}` }
    })
    setRows(newRows)
    setTargetMonth(newMonth)
    await recomputeStatuses(newRows)
  }

  const setRow = (i, patch) => {
    setRows(rs => {
      const next = rs.map((r, idx) => idx === i ? { ...r, ...patch } : r)
      // 重新计算这行状态
      const newRow = next[i]
      const st = getRowStatus(newRow, existingSlots)
      setRowStatus(ss => ss.map((s, idx) => idx === i ? st : s))
      setRowChecked(cs => cs.map((c, idx) => idx === i ? (st !== 'duplicate') : c))
      return next
    })
  }
  const delRow = (i) => {
    setRows(rs => rs.filter((_, idx) => idx !== i))
    setRowChecked(cs => cs.filter((_, idx) => idx !== i))
    setRowStatus(ss => ss.filter((_, idx) => idx !== i))
  }
  const addRow = () => {
    const newRow = { date: weekStart, startTime: '09:00', endTime: '10:00', subjectId: subjects.length === 1 ? subjects[0].id : null, note: '' }
    const st = getRowStatus(newRow, existingSlots)
    setRows(rs => [...rs, newRow])
    setRowStatus(ss => [...ss, st])
    setRowChecked(cs => [...cs, st !== 'duplicate'])
  }

  const generate = async () => {
    const valid = rows
      .filter((r, i) => rowChecked[i])
      .filter(r => r.date && r.startTime && r.endTime && r.startTime < r.endTime)
      .map(r => {
        const subName = r.subjectId ? (subjects.find(s => s.id === r.subjectId)?.name ?? '') : ''
        const note = subName && r.note ? `${subName} · ${r.note}` : subName || r.note || ''
        const studentNames = r.note
          ? r.note.split(/[、，,/\s]+/).map(s => s.trim()).filter(Boolean)
          : []
        return { date: r.date, startTime: r.startTime, endTime: r.endTime, note, studentNames }
      })
    if (valid.length === 0) { toast('没有勾选有效的课程行', true); return }
    setBusy(true)
    try {
      const r = await createSlotsBatch(valid)
      const c = r.data.createdCount, sk = r.data.skipped?.length || 0
      toast(`已生成 ${c} 节课${sk ? `，跳过 ${sk} 节（冲突/重复）` : ''}`)
      onGenerated?.()
      onClose()
    } catch (e) { toast(e.message || '生成失败', true) }
    finally { setBusy(false) }
  }

  const inp = { padding: '8px 9px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box', fontFamily: 'var(--sans)' }

  const checkedCount = rowChecked.filter(Boolean).length

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', borderRadius: '18px 18px 0 0', width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', padding: '1.25rem 1rem calc(1.25rem + env(safe-area-inset-bottom,0px))' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>📷 拍照排课</span>
          <button className="modal-x" onClick={onClose}>×</button>
        </div>

        {step === 'upload' && (
          <div style={{ padding: '0.5rem 0' }}>
            {/* 下载标准模板 */}
            <div style={{ background: 'rgba(79,142,247,0.07)', border: '1px solid rgba(79,142,247,0.25)', borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
                📋 下载标准模板（打印后手写，拍照上传）
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <a href="/assets/templates/week-schedule-template.html" target="_blank" rel="noopener noreferrer"
                  style={{ display: 'block', padding: '8px 0', borderRadius: 8, border: '1px solid rgba(79,142,247,0.5)', background: '#fff', color: '#4f8ef7', fontSize: 13, fontWeight: 600, textAlign: 'center', textDecoration: 'none' }}>
                  📅 周课表
                </a>
                <a href="/assets/templates/month-schedule-template.html" target="_blank" rel="noopener noreferrer"
                  style={{ display: 'block', padding: '8px 0', borderRadius: 8, border: '1px solid rgba(79,142,247,0.5)', background: '#fff', color: '#4f8ef7', fontSize: 13, fontWeight: 600, textAlign: 'center', textDecoration: 'none' }}>
                  🗓️ 月课表
                </a>
                <a href="/assets/templates/week-schedule-example.html" target="_blank" rel="noopener noreferrer"
                  style={{ display: 'block', padding: '8px 0', borderRadius: 8, border: '1px solid rgba(200,200,200,0.8)', background: '#fafafa', color: '#888', fontSize: 13, fontWeight: 600, textAlign: 'center', textDecoration: 'none' }}>
                  🔍 周实例
                </a>
                <a href="/assets/templates/month-schedule-example.html" target="_blank" rel="noopener noreferrer"
                  style={{ display: 'block', padding: '8px 0', borderRadius: 8, border: '1px solid rgba(200,200,200,0.8)', background: '#fafafa', color: '#888', fontSize: 13, fontWeight: 600, textAlign: 'center', textDecoration: 'none' }}>
                  🔍 月实例
                </a>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}>
                <input
                  type="checkbox"
                  checked={useStdTemplate}
                  onChange={e => {
                    setUseStdTemplate(e.target.checked)
                    if (e.target.checked) {
                      setHint(h => h.includes(STD_TAG) ? h : (h ? h + '\n' + STD_TAG : STD_TAG))
                    } else {
                      setHint(h => h.replace(new RegExp('\n?' + STD_TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '').trim())
                    }
                  }}
                  style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
                我使用的是 Gooday 标准模板（识别率更高）
              </label>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>
                补充说明（可选）
              </div>
              <textarea
                value={hint}
                onChange={e => setHint(e.target.value)}
                placeholder="帮 AI 更好理解课表，例如：&#10;• 这是下周（6月2日那周）的课表&#10;• 只看语文和数学，其他科目忽略"
                maxLength={600}
                rows={3}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 16, background: 'var(--surface)', color: 'var(--text)', resize: 'vertical', fontFamily: 'var(--sans)', lineHeight: 1.6, boxSizing: 'border-box' }}
              />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, textAlign: 'right' }}>
                {hint.length}/600
              </div>
            </div>

            <input ref={fileRef} type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} />
            <button onClick={() => fileRef.current?.click()}
              style={{ width: '100%', padding: '12px 0', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              选择 / 拍摄课表照片
            </button>
          </div>
        )}

        {step === 'recognizing' && (
          <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
            <div>正在识别课表，请稍候…</div>
            {pollCount > 0 && <div style={{ fontSize: 12, marginTop: 8, color: 'var(--muted)' }}>
              已等待约 {Math.round(pollCount * 4)} 秒，课表识别通常需要 1-3 分钟
            </div>}
          </div>
        )}

        {step === 'draft' && (
          <>
            {mockNote && (
              <div style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', color: '#b45309', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, marginBottom: 12, lineHeight: 1.5 }}>
                ⚠️ {mockNote}
              </div>
            )}

            {/* 目标周/月选择 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {isMonthly ? (
                <>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>目标月份</span>
                  <input type="month" value={targetMonth} onChange={e => e.target.value && shiftMonth(e.target.value)} style={inp} />
                </>
              ) : (
                <>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>目标周（周一）</span>
                  <input type="date" value={weekStart} onChange={e => e.target.value && shiftWeek(e.target.value)} style={inp} />
                </>
              )}
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>改这里会整体平移日期</span>
            </div>

            {/* 状态图例 */}
            {rows.length > 0 && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap', fontSize: 12 }}>
                {(['new','updated','duplicate']).map(st => {
                  const s = STATUS_STYLE[st]
                  const count = rowStatus.filter(x => x === st).length
                  if (count === 0) return null
                  return (
                    <span key={st} style={{ display: 'flex', alignItems: 'center', gap: 4, background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 6, padding: '3px 8px' }}>
                      <span style={{ fontWeight: 700 }}>{s.label}</span>
                      <span>{count} 节</span>
                    </span>
                  )
                })}
                <span style={{ color: 'var(--muted)', alignSelf: 'center' }}>· 勾选的才会导入</span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {rows.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13, padding: '0.5rem 0' }}>暂无课程，点下方「+ 加一行」手动添加</div>}
              {rows.map((r, i) => {
                const bad = !(r.startTime < r.endTime)
                const st = rowStatus[i] || 'new'
                const ss = STATUS_STYLE[st]
                const checked = rowChecked[i] ?? true
                return (
                  <div key={i} style={{ border: `1.5px solid ${checked ? ss.border : 'var(--border)'}`, borderRadius: 12, padding: '10px', background: checked ? ss.bg : 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 7, opacity: checked ? 1 : 0.6 }}>
                    {/* 行头：勾选 + 序号 + 状态标签 + 日期 + 删除 */}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={checked}
                        onChange={e => setRowChecked(cs => cs.map((c, idx) => idx === i ? e.target.checked : c))}
                        style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
                      <span style={{ fontSize: 10, color: 'var(--muted)', width: 28, flexShrink: 0 }}>第{i + 1}节</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: ss.color, background: ss.bg, border: `1px solid ${ss.border}`, borderRadius: 5, padding: '1px 6px', flexShrink: 0 }}>{ss.label}</span>
                      <input type="date" value={r.date} onChange={e => setRow(i, { date: e.target.value })} style={{ ...inp, flex: 1 }} />
                      <button onClick={() => delRow(i)} title="删除"
                        style={{ border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: '#ef4444', borderRadius: 8, cursor: 'pointer', fontSize: 13, padding: '8px 11px' }}>✕</button>
                    </div>
                    {/* 时间 */}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="time" value={r.startTime} onChange={e => setRow(i, { startTime: e.target.value })} style={{ ...inp, flex: 1, borderColor: bad ? '#ef4444' : 'var(--border)' }} />
                      <span style={{ color: 'var(--muted)' }}>–</span>
                      <input type="time" value={r.endTime} onChange={e => setRow(i, { endTime: e.target.value })} style={{ ...inp, flex: 1, borderColor: bad ? '#ef4444' : 'var(--border)' }} />
                    </div>
                    {/* 科目 */}
                    {subjects.length > 0 && (
                      <select value={r.subjectId ?? ''} onChange={e => setRow(i, { subjectId: e.target.value ? Number(e.target.value) : null })}
                        style={{ ...inp, width: '100%' }}>
                        <option value="">-- 选择科目（可空）--</option>
                        {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    )}
                    {/* 学生姓名 */}
                    <input value={r.note} placeholder="学生姓名（可选，线下学生会显示在课表里）" onChange={e => setRow(i, { note: e.target.value })} style={{ ...inp, width: '100%' }} />
                  </div>
                )
              })}
            </div>

            <button onClick={addRow}
              style={{ width: '100%', padding: '9px 0', borderRadius: 10, border: '1px dashed var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 12 }}>
              + 加一行
            </button>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={generate} disabled={busy}
                style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: 'none', background: checkedCount > 0 ? 'var(--accent)' : '#aaa', color: '#fff', fontSize: 15, fontWeight: 700, cursor: checkedCount > 0 ? 'pointer' : 'default' }}>
                {busy ? '生成中…' : `导入勾选课表（${checkedCount} 节）`}
              </button>
              <button onClick={() => { setStep('upload'); setRows([]); setRowChecked([]); setRowStatus([]) }}
                style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'none', fontSize: 14, cursor: 'pointer' }}>重拍</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
