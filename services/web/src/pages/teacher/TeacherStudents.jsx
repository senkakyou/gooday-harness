import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useToastStore from '../../store/toastStore'
import useAuthStore from '../../store/authStore'
import { teacherStats, teacherStudents, addTeacherStudent } from '../../api/courses'
import { MonthlyReportModal } from './Statements'

const yuan = (n) => '￥' + Number(n || 0).toFixed(2)

// 余额徽标：负=欠费(红)，正=预存(绿)，0=已结清(灰)
function BalanceBadge({ balance, size = 'sm' }) {
  const owe = balance < 0
  const settled = balance === 0
  const color = settled ? '#6b7280' : owe ? '#ef4444' : '#10b981'
  const bg = settled ? 'rgba(107,114,128,0.1)' : owe ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)'
  const text = settled ? '已结清' : owe ? `欠 ${yuan(-balance)}` : `预存 ${yuan(balance)}`
  const pad = size === 'lg' ? '6px 14px' : '4px 10px'
  const fs = size === 'lg' ? 14 : 12
  return <span style={{ fontSize: fs, fontWeight: 700, color, background: bg, padding: pad, borderRadius: 20, whiteSpace: 'nowrap' }}>{text}</span>
}

function StatBox({ label, value, color, sub }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || 'var(--text)', fontFamily: 'var(--mono)', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

export default function TeacherStudents() {
  const navigate = useNavigate()
  const toast = useToastStore(s => s.toast)
  const teacherName = useAuthStore(s => s.user?.username)
  const [showReport, setShowReport] = useState(false)
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [stats, setStats] = useState(null)
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [addModal, setAddModal] = useState(false)
  const [form, setForm] = useState({ displayName: '', phone: '', note: '' })
  const [submitting, setSubmitting] = useState(false)

  const loadStats = () => teacherStats(year, month).then(r => setStats(r.data)).catch(() => {})
  const loadStudents = () => teacherStudents(showArchived).then(r => setStudents(r.data)).catch(() => setStudents([]))

  useEffect(() => { loadStats() }, [year, month])
  useEffect(() => {
    setLoading(true)
    Promise.all([loadStats(), loadStudents()]).finally(() => setLoading(false))
  }, [])
  useEffect(() => { loadStudents() }, [showArchived])

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1) }
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1

  const doAdd = async () => {
    if (!form.displayName.trim()) { toast('请填写学生姓名', true); return }
    setSubmitting(true)
    try {
      await addTeacherStudent({ displayName: form.displayName.trim(), phone: form.phone || null, note: form.note || null })
      toast('已添加学生'); setAddModal(false); setForm({ displayName: '', phone: '', note: '' })
      loadStudents(); loadStats()
    } catch (e) { toast(e.response?.data || '添加失败', true) }
    finally { setSubmitting(false) }
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 0 5rem' }}>
      {/* 顶部导航 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)', borderBottom: '1px solid var(--border)', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate('/teacher/dashboard')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, flex: 1, padding: 0, minWidth: 0 }}>
          <span style={{ color: 'var(--muted)', fontSize: 22, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>‹</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>学生管理 · 课时结算</span>
        </button>
        <button onClick={() => setShowReport(true)}
          style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '6px 12px', borderRadius: 9 }}>导出汇总</button>
        <button onClick={() => { setForm({ displayName: '', phone: '', note: '' }); setAddModal(true) }}
          style={{ background: 'var(--accent)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '6px 12px', borderRadius: 9 }}>+ 添加</button>
      </div>

      <div style={{ padding: '1rem' }}>
        {/* ── 每月统计总览 ── */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '1.125rem 1.125rem 1rem', marginBottom: 16 }}>
          {/* 月份切换 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 16 }}>
            <button onClick={prevMonth} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: 'var(--text)', fontSize: 16 }}>‹</button>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{year}年{month}月{isCurrentMonth && <span style={{ fontSize: 11, color: 'var(--accent)', marginLeft: 6 }}>本月</span>}</span>
            <button onClick={nextMonth} disabled={isCurrentMonth}
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, width: 30, height: 30, cursor: isCurrentMonth ? 'not-allowed' : 'pointer', color: isCurrentMonth ? 'var(--border)' : 'var(--text)', fontSize: 16 }}>›</button>
          </div>

          {/* 本月收支 */}
          <div style={{ display: 'flex', gap: 12, padding: '12px 14px', background: 'var(--bg)', borderRadius: 12, marginBottom: 10 }}>
            <StatBox label="本月应收" value={yuan(stats?.monthDue)} />
            <div style={{ width: 1, background: 'var(--border)' }} />
            <StatBox label="本月已收" value={yuan(stats?.monthPaid)} color="#10b981" />
          </div>

          {/* 本月上课 */}
          <div style={{ display: 'flex', gap: 12, padding: '12px 14px', background: 'var(--bg)', borderRadius: 12, marginBottom: 10 }}>
            <StatBox label="本月上课" value={`${stats?.lessonCount ?? 0} 节`} sub={`${stats?.lessonMinutes ?? 0} 分钟`} />
            <div style={{ width: 1, background: 'var(--border)' }} />
            <StatBox label="活跃学生" value={`${stats?.activeStudents ?? 0} 人`} />
            <div style={{ width: 1, background: 'var(--border)' }} />
            <StatBox label="在册学生" value={`${stats?.totalStudents ?? 0} 人`} />
          </div>

          {/* 累计（全局） */}
          <div style={{ display: 'flex', gap: 12, padding: '12px 14px', background: 'var(--bg)', borderRadius: 12 }}>
            <StatBox label="累计欠费" value={yuan(stats?.totalOutstanding)} color={stats?.totalOutstanding > 0 ? '#ef4444' : 'var(--text)'} />
            <div style={{ width: 1, background: 'var(--border)' }} />
            <StatBox label="累计预存" value={yuan(stats?.totalPrepaid)} color={stats?.totalPrepaid > 0 ? '#10b981' : 'var(--text)'} />
          </div>
        </div>

        {/* ── 学生列表 ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 2px' }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>学生</span>
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} style={{ cursor: 'pointer' }} />
            显示已归档
          </label>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3].map(i => <div key={i} style={{ height: 76, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }} />)}
          </div>
        ) : students.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '3rem 0' }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>🧑‍🎓</div>
            <div style={{ fontSize: 14, marginBottom: 16 }}>还没有学生<br/>学生预约后会自动出现，也可手动添加线下学生</div>
            <button onClick={() => setAddModal(true)}
              style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>+ 添加学生</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {students.map(s => (
              <button key={s.id} onClick={() => navigate(`/teacher/students/${s.id}`)}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '0.875rem 1rem', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, width: '100%', opacity: s.isArchived ? 0.55 : 1, transition: 'border-color .15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(124,108,255,0.5)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                {s.avatarUrl
                  ? <img src={s.avatarUrl} alt="" style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  : <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>{s.studentUserId ? '👤' : '🧑'}</div>
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.displayName}</span>
                    {!s.studentUserId && <span style={{ fontSize: 10, color: 'var(--muted)', background: 'var(--bg)', padding: '1px 6px', borderRadius: 6, flexShrink: 0 }}>线下</span>}
                    {s.isArchived && <span style={{ fontSize: 10, color: '#6b7280', background: 'rgba(107,114,128,0.12)', padding: '1px 6px', borderRadius: 6, flexShrink: 0 }}>已归档</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                    {s.lessonCount} 节课{s.lastLessonDate ? ` · 最近 ${s.lastLessonDate}` : ''}
                  </div>
                </div>
                <BalanceBadge balance={s.balance} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 当月全员汇总表 */}
      {showReport && <MonthlyReportModal teacherName={teacherName} onClose={() => setShowReport(false)} />}

      {/* 添加学生弹窗 */}
      {addModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setAddModal(false) }}>
          <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '1.5rem 1rem 2rem', width: '100%', maxWidth: 680 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>添加线下学生</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>用于结算未通过平台预约的学生（如微信约课）</div>
            {[
              { k: 'displayName', label: '学生姓名', req: true, ph: '例：王小明' },
              { k: 'phone', label: '联系电话', ph: '选填' },
              { k: 'note', label: '备注', ph: '选填，如年级/班级' },
            ].map(f => (
              <div key={f.k} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{f.label}{f.req && <span style={{ color: '#ef4444' }}> *</span>}</div>
                <input value={form[f.k]} onChange={e => setForm(v => ({ ...v, [f.k]: e.target.value }))} placeholder={f.ph}
                  style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 16, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box', outline: 'none', fontFamily: 'var(--sans)' }} />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button onClick={doAdd} disabled={submitting}
                style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>
                {submitting ? '保存中…' : '保存'}
              </button>
              <button onClick={() => setAddModal(false)}
                style={{ padding: '13px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 14 }}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
