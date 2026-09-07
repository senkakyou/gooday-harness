import React, { useEffect, useRef, useState } from 'react'
import useToastStore from '../../store/toastStore'
import { teacherMonthlyReport } from '../../api/courses'
import { renderNodeToPngUrl, exportNodeAsPdf } from '../../utils/exportNode'
import ExportPreview from '../../components/ExportPreview'
import { ymd } from '../../utils/localDate'

const yuan = (n) => '￥' + Number(n || 0).toFixed(2)
const pad = (n) => String(n).padStart(2, '0')
const md = (d) => (d || '').slice(5)   // "2026-05-30" -> "05-30"

// 打印用的浅色调色板（不跟随站点深色主题，导出更清晰）
const C = {
  bg: '#ffffff', ink: '#1a1a2e', sub: '#6b7280', line: '#e5e7eb',
  accent: '#6d5dfc', danger: '#ef4444', ok: '#10b981', soft: '#f6f5ff',
}

function balanceText(balance) {
  if (balance < 0) return { text: `欠 ${yuan(-balance)}`, color: C.danger }
  if (balance > 0) return { text: `预存 ${yuan(balance)}`, color: C.ok }
  return { text: '已结清', color: C.sub }
}

function MonthSwitcher({ year, month, onPrev, onNext, isCurrent }) {
  const btn = { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: C.ink, fontSize: 16 }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 14 }}>
      <button onClick={onPrev} style={btn}>‹</button>
      <span style={{ fontWeight: 700, fontSize: 15, color: C.ink }}>{year}年{month}月</span>
      <button onClick={onNext} disabled={isCurrent} style={{ ...btn, cursor: isCurrent ? 'not-allowed' : 'pointer', color: isCurrent ? C.line : C.ink }}>›</button>
    </div>
  )
}

function ExportBar({ sheetRef, filename, landscape = false }) {
  const toast = useToastStore(s => s.toast)
  const [busy, setBusy] = useState(null)
  const [preview, setPreview] = useState(null)   // 图片预览浮层 dataURL
  // 宽表格（月度汇总表）撑得更宽 + PDF 横向，列才完整不被裁切（论坛#54）
  const minWidth = landscape ? 800 : 560
  const run = async (kind) => {
    if (!sheetRef.current) return
    setBusy(kind)
    try {
      if (kind === 'pdf') await exportNodeAsPdf(sheetRef.current, filename, { minWidth, orientation: landscape ? 'landscape' : 'portrait' })
      // 图片：弹预览浮层，手机长按即可保存到相册（直接下载在手机上只能存到文件，存不进相册，论坛#53）
      else setPreview(await renderNodeToPngUrl(sheetRef.current, { minWidth }))
    } catch (e) { toast(kind === 'pdf' ? '导出失败，请重试' : '生成失败，请重试', true) }
    finally { setBusy(null) }
  }
  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button onClick={() => run('pdf')} disabled={!!busy}
          style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
          {busy === 'pdf' ? '生成中…' : '导出 PDF'}
        </button>
        <button onClick={() => run('image')} disabled={!!busy}
          style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: '1.5px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
          {busy === 'image' ? '生成中…' : '导出图片'}
        </button>
      </div>
      <ExportPreview url={preview} filename={`${filename}.png`} onClose={() => setPreview(null)} />
    </>
  )
}

function ModalShell({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1100 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '1.25rem 1rem 2rem', width: '100%', maxWidth: 680, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{title}</span>
          <button className="modal-x" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const td = { padding: '7px 8px', fontSize: 12.5, color: C.ink, borderBottom: `1px solid ${C.line}` }
const th = { ...td, color: C.sub, fontWeight: 600, borderBottom: `1.5px solid ${C.line}` }

// ════════ 单个学生月度对账单 ════════
export function StudentStatementModal({ student, lessons, payments, totalDue, totalPaid, teacherName, onClose }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const sheetRef = useRef(null)
  const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1
  const prev = () => { if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1) }
  const next = () => { if (isCurrent) return; if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1) }

  const prefix = `${year}-${pad(month)}`
  const ml = (lessons || []).filter(l => (l.lessonDate || '').startsWith(prefix)).sort((a, b) => a.lessonDate.localeCompare(b.lessonDate))
  const mp = (payments || []).filter(p => (p.paidDate || '').startsWith(prefix)).sort((a, b) => a.paidDate.localeCompare(b.paidDate))
  const monthDue = ml.reduce((s, l) => s + Number(l.fee), 0)
  const monthPaid = mp.reduce((s, p) => s + Number(p.amount), 0)
  const bal = balanceText(Number(totalPaid) - Number(totalDue))
  const today = ymd()

  return (
    <ModalShell title="课时对账单" onClose={onClose}>
      <MonthSwitcher year={year} month={month} onPrev={prev} onNext={next} isCurrent={isCurrent} />

      <div ref={sheetRef} style={{ background: C.bg, borderRadius: 12, padding: '22px 20px', color: C.ink }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1 }}>课时对账单</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 16, gap: 10 }}>
          <div>
            <div style={{ color: C.sub }}>学生</div>
            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 1 }}>{student?.displayName}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: C.sub }}>账单月份</div>
            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 1 }}>{year}年{month}月</div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: C.sub, marginBottom: 16 }}>
          <span>老师：{teacherName || '—'}</span>
          <span>出具日期：{today}</span>
        </div>

        {/* 本月课时 */}
        <div style={{ fontSize: 13, fontWeight: 700, margin: '4px 0 6px' }}>本月课时</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
          <thead><tr><th style={{ ...th, textAlign: 'left' }}>日期</th><th style={th}>时长</th><th style={{ ...th, textAlign: 'right' }}>课时费</th></tr></thead>
          <tbody>
            {ml.length === 0 ? (
              <tr><td style={{ ...td, textAlign: 'center', color: C.sub }} colSpan={3}>本月无课时</td></tr>
            ) : ml.map(l => (
              <tr key={l.id}>
                <td style={td}>{md(l.lessonDate)}</td>
                <td style={{ ...td, textAlign: 'center' }}>{l.durationMinutes ? `${l.durationMinutes} 分钟` : '—'}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{yuan(l.fee)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...td, borderBottom: 'none', color: C.sub }}>共 {ml.length} 节</td>
              <td style={{ ...td, borderBottom: 'none' }}></td>
              <td style={{ ...td, borderBottom: 'none', textAlign: 'right', fontWeight: 700 }}>小计 {yuan(monthDue)}</td>
            </tr>
          </tbody>
        </table>

        {/* 本月缴费 */}
        <div style={{ fontSize: 13, fontWeight: 700, margin: '4px 0 6px' }}>本月缴费</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
          <thead><tr><th style={{ ...th, textAlign: 'left' }}>日期</th><th style={{ ...th, textAlign: 'left' }}>备注</th><th style={{ ...th, textAlign: 'right' }}>金额</th></tr></thead>
          <tbody>
            {mp.length === 0 ? (
              <tr><td style={{ ...td, textAlign: 'center', color: C.sub }} colSpan={3}>本月无缴费</td></tr>
            ) : mp.map(p => (
              <tr key={p.id}>
                <td style={td}>{md(p.paidDate)}</td>
                <td style={{ ...td, color: C.sub }}>{p.note || '—'}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: C.ok }}>{yuan(p.amount)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...td, borderBottom: 'none' }}></td>
              <td style={{ ...td, borderBottom: 'none' }}></td>
              <td style={{ ...td, borderBottom: 'none', textAlign: 'right', fontWeight: 700 }}>小计 {yuan(monthPaid)}</td>
            </tr>
          </tbody>
        </table>

        {/* 汇总 */}
        <div style={{ background: C.soft, borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
            <span style={{ color: C.sub }}>本月应收</span><span style={{ fontWeight: 700 }}>{yuan(monthDue)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 10 }}>
            <span style={{ color: C.sub }}>本月已交</span><span style={{ fontWeight: 700, color: C.ok }}>{yuan(monthPaid)}</span>
          </div>
          <div style={{ borderTop: `1px dashed ${C.line}`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: C.sub }}>截至目前·累计余额</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: bal.color }}>{bal.text}</span>
          </div>
        </div>
      </div>

      <ExportBar sheetRef={sheetRef} filename={`对账单_${student?.displayName || '学生'}_${prefix}`} />
    </ModalShell>
  )
}

// ════════ 老师当月全员汇总表 ════════
export function MonthlyReportModal({ teacherName, onClose }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const sheetRef = useRef(null)
  const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1
  const prev = () => { if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1) }
  const next = () => { if (isCurrent) return; if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1) }

  useEffect(() => {
    setLoading(true)
    teacherMonthlyReport(year, month).then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false))
  }, [year, month])

  const rows = data?.rows || []
  const today = ymd()
  const prefix = `${year}-${pad(month)}`

  return (
    <ModalShell title="课时月度汇总表" onClose={onClose}>
      <MonthSwitcher year={year} month={month} onPrev={prev} onNext={next} isCurrent={isCurrent} />

      <div ref={sheetRef} style={{ background: C.bg, borderRadius: 12, padding: '22px 20px', color: C.ink }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1 }}>课时月度汇总表</div>
          <div style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>{teacherName || '—'} 老师</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: C.sub, marginBottom: 14 }}>
          <span>账单月份：{year}年{month}月</span>
          <span>出具日期：{today}</span>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...th, textAlign: 'left' }}>学生</th>
            <th style={th}>节数</th>
            <th style={{ ...th, textAlign: 'right' }}>本月应收</th>
            <th style={{ ...th, textAlign: 'right' }}>本月已收</th>
            <th style={{ ...th, textAlign: 'right' }}>累计余额</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td style={{ ...td, textAlign: 'center', color: C.sub }} colSpan={5}>加载中…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td style={{ ...td, textAlign: 'center', color: C.sub }} colSpan={5}>本月无上课/缴费记录</td></tr>
            ) : rows.map(r => {
              const b = balanceText(Number(r.balance))
              return (
                <tr key={r.studentId}>
                  <td style={td}>{r.displayName}{!r.isPlatform && <span style={{ fontSize: 9, color: C.sub, marginLeft: 4 }}>线下</span>}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{r.lessonCount}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{yuan(r.monthDue)}</td>
                  <td style={{ ...td, textAlign: 'right', color: C.ok }}>{yuan(r.monthPaid)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: b.color }}>{b.text}</td>
                </tr>
              )
            })}
            {!loading && rows.length > 0 && (
              <tr>
                <td style={{ ...td, borderBottom: 'none', fontWeight: 700 }}>合计</td>
                <td style={{ ...td, borderBottom: 'none', textAlign: 'center', fontWeight: 700 }}>{data.totalLessons}</td>
                <td style={{ ...td, borderBottom: 'none', textAlign: 'right', fontWeight: 700 }}>{yuan(data.totalDue)}</td>
                <td style={{ ...td, borderBottom: 'none', textAlign: 'right', fontWeight: 700, color: C.ok }}>{yuan(data.totalPaid)}</td>
                <td style={{ ...td, borderBottom: 'none' }}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ExportBar sheetRef={sheetRef} filename={`课时汇总_${teacherName || '老师'}_${prefix}`} landscape />
    </ModalShell>
  )
}
