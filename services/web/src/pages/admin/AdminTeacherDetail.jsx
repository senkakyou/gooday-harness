import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { adminGetTeacher, adminGetTeacherStudents, adminUpdateTeacherSubjects, adminRevokeTeacher, adminListSubjects } from '../../api/courses'
import useToastStore from '../../store/toastStore'

const yuan = (n) => '￥' + Number(n || 0).toFixed(2)
const pad = (n) => String(n).padStart(2, '0')

function BalanceBadge({ balance }) {
  const owe = balance < 0, settled = balance === 0
  const color = settled ? '#6b7280' : owe ? '#ef4444' : '#10b981'
  const bg = settled ? 'rgba(107,114,128,0.1)' : owe ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)'
  const text = settled ? '已结清' : owe ? `欠 ${yuan(-balance)}` : `预存 ${yuan(balance)}`
  return <span style={{ fontSize: 12, fontWeight: 700, color, background: bg, padding: '4px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>{text}</span>
}

function StatBox({ label, value, color, sub }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || 'var(--text)', fontFamily: 'var(--mono)', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export default function AdminTeacherDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToastStore(s => s.toast)
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [teacher, setTeacher] = useState(null)
  const [students, setStudents] = useState([])
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [subjectModal, setSubjectModal] = useState(false)
  const [allSubjects, setAllSubjects] = useState([])
  const [selectedSubs, setSelectedSubs] = useState([])
  const [savingSubs, setSavingSubs] = useState(false)
  const [revokeModal, setRevokeModal] = useState(false)
  const [revokeReason, setRevokeReason] = useState('')
  const [acting, setActing] = useState(false)

  const loadTeacher = (y, mo) =>
    adminGetTeacher(id, y, mo).then(r => setTeacher(r.data)).catch(() => {})

  const loadStudents = (archived) =>
    adminGetTeacherStudents(id, archived).then(r => setStudents(r.data)).catch(() => setStudents([]))

  useEffect(() => {
    setLoading(true)
    Promise.all([loadTeacher(year, month), loadStudents(showArchived)])
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { loadTeacher(year, month) }, [year, month])
  useEffect(() => { loadStudents(showArchived) }, [showArchived])

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1
  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1) }

  const openSubjectModal = () => {
    setSelectedSubs(teacher.subjects?.map(s => s.id) || [])
    if (!allSubjects.length) {
      adminListSubjects().then(r => setAllSubjects(r.data)).catch(() => {})
    }
    setSubjectModal(true)
  }

  const saveSubjects = async () => {
    if (!selectedSubs.length) { toast('请选择至少一个学科', true); return }
    setSavingSubs(true)
    try {
      await adminUpdateTeacherSubjects(id, selectedSubs)
      toast('科目已更新')
      setSubjectModal(false)
      loadTeacher(year, month)
    } catch (e) { toast(e.response?.data || '保存失败', true) }
    finally { setSavingSubs(false) }
  }

  const doRevoke = async () => {
    setActing(true)
    try {
      const r = await adminRevokeTeacher(teacher.id, { reason: revokeReason || null })
      const { cancelledSlots, cancelledBookings } = r.data
      toast(`已撤销，取消了 ${cancelledSlots} 个时间段、${cancelledBookings} 条预约`)
      setRevokeModal(false); setRevokeReason('')
      loadTeacher(year, month)
    } catch (e) { toast(e.response?.data || '操作失败', true) }
    finally { setActing(false) }
  }

  if (loading) return <div style={{ color: 'var(--muted)', padding: '3rem', textAlign: 'center' }}>加载中…</div>
  if (!teacher) return <div style={{ color: 'var(--muted)', padding: '3rem', textAlign: 'center' }}>未找到该教师</div>

  const st = teacher.stats
  const isRevoked = teacher.status === 'revoked'

  return (
    <div>
      {/* 返回 */}
      <button onClick={() => navigate('/admin/teachers')}
        style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: '0 0 16px', display: 'flex', alignItems: 'center', gap: 4 }}>
        ‹ 教师管理
      </button>

      {/* 教师信息头 */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '1.25rem', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 12 }}>
          {(teacher.avatarUrl || teacher.user?.avatarUrl)
            ? <img src={teacher.avatarUrl || teacher.user.avatarUrl} alt="" style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            : <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>👤</div>
          }
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 17 }}>{teacher.user?.username}</span>
              <span style={{ fontSize: 11, fontWeight: 700,
                color: isRevoked ? '#6b7280' : '#10b981',
                background: isRevoked ? 'rgba(107,114,128,0.1)' : 'rgba(16,185,129,0.1)',
                padding: '2px 8px', borderRadius: 10 }}>
                {isRevoked ? '已撤销' : '已认证'}
              </span>
              {teacher.approvedAt && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  通过于 {new Date(teacher.approvedAt).toLocaleDateString('zh-CN')}
                </span>
              )}
            </div>
            {teacher.bio && (
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 10px', lineHeight: 1.6 }}>{teacher.bio}</p>
            )}
            {/* 科目 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {teacher.subjects?.map(s => (
                <span key={s.id} style={{ fontSize: 12, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '3px 10px', borderRadius: 10 }}>{s.name}</span>
              ))}
              <button onClick={openSubjectModal}
                style={{ fontSize: 12, padding: '3px 10px', borderRadius: 10, border: '1px dashed var(--border)', background: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
                编辑科目
              </button>
            </div>
          </div>

          {!isRevoked && (
            <button onClick={() => { setRevokeModal(true); setRevokeReason('') }}
              style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 8, border: '1.5px solid rgba(245,158,11,0.5)', background: 'rgba(245,158,11,0.06)', color: '#f59e0b', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              撤销资格
            </button>
          )}
        </div>
      </div>

      {/* 月度统计 */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '1.125rem', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 14 }}>
          <button onClick={prevMonth} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, width: 28, height: 28, cursor: 'pointer', color: 'var(--text)', fontSize: 15 }}>‹</button>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{year}年{month}月{isCurrentMonth && <span style={{ fontSize: 11, color: 'var(--accent)', marginLeft: 5 }}>本月</span>}</span>
          <button onClick={nextMonth} disabled={isCurrentMonth}
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, width: 28, height: 28, cursor: isCurrentMonth ? 'not-allowed' : 'pointer', color: isCurrentMonth ? 'var(--border)' : 'var(--text)', fontSize: 15 }}>›</button>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1, padding: '10px 12px', background: 'var(--bg)', borderRadius: 10, display: 'flex', gap: 10 }}>
            <StatBox label="本月应收" value={yuan(st?.monthDue)} />
            <div style={{ width: 1, background: 'var(--border)' }} />
            <StatBox label="本月已收" value={yuan(st?.monthPaid)} color="#10b981" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1, padding: '10px 12px', background: 'var(--bg)', borderRadius: 10, display: 'flex', gap: 10 }}>
            <StatBox label="本月课节" value={`${st?.lessonCount ?? 0} 节`} sub={`${st?.lessonMinutes ?? 0} 分钟`} />
            <div style={{ width: 1, background: 'var(--border)' }} />
            <StatBox label="活跃学生" value={`${st?.activeStudents ?? 0} 人`} />
            <div style={{ width: 1, background: 'var(--border)' }} />
            <StatBox label="在册学生" value={`${st?.totalStudents ?? 0} 人`} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1, padding: '10px 12px', background: 'var(--bg)', borderRadius: 10, display: 'flex', gap: 10 }}>
            <StatBox label="累计欠费" value={yuan(st?.totalOutstanding)} color={(st?.totalOutstanding ?? 0) > 0 ? '#ef4444' : 'var(--text)'} />
            <div style={{ width: 1, background: 'var(--border)' }} />
            <StatBox label="累计预存" value={yuan(st?.totalPrepaid)} color={(st?.totalPrepaid ?? 0) > 0 ? '#10b981' : 'var(--text)'} />
          </div>
        </div>
      </div>

      {/* 学生列表 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>学生</span>
        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          显示已归档
        </label>
      </div>

      {students.length === 0 ? (
        <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem', fontSize: 14 }}>暂无学生</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {students.map(s => (
            <button key={s.id} onClick={() => navigate(`/admin/teachers/${id}/students/${s.id}`)}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '0.875rem 1rem', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, width: '100%', opacity: s.isArchived ? 0.55 : 1, transition: 'border-color .15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(124,108,255,0.5)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
              {s.avatarUrl
                ? <img src={s.avatarUrl} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                : <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{s.studentUserId ? '👤' : '🧑'}</div>
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.displayName}</span>
                  {!s.studentUserId && <span style={{ fontSize: 10, color: 'var(--muted)', background: 'var(--bg)', padding: '1px 6px', borderRadius: 6, flexShrink: 0 }}>线下</span>}
                  {s.isArchived && <span style={{ fontSize: 10, color: '#6b7280', background: 'rgba(107,114,128,0.12)', padding: '1px 6px', borderRadius: 6, flexShrink: 0 }}>已归档</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {s.lessonCount} 节课{s.lastLessonDate ? ` · 最近 ${s.lastLessonDate}` : ''}
                </div>
              </div>
              <BalanceBadge balance={s.balance} />
              <span style={{ color: 'var(--muted)', fontSize: 16 }}>›</span>
            </button>
          ))}
        </div>
      )}

      {/* 科目编辑弹窗 */}
      {subjectModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setSubjectModal(false) }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: '1.5rem', width: 460, maxWidth: '90vw' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 14 }}>编辑科目 — {teacher.user?.username}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {allSubjects.filter(s => s.isActive).map(s => (
                <button key={s.id} onClick={() => setSelectedSubs(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])}
                  style={{ padding: '8px 16px', borderRadius: 20,
                    border: `2px solid ${selectedSubs.includes(s.id) ? 'var(--accent)' : 'var(--border)'}`,
                    background: selectedSubs.includes(s.id) ? 'var(--accent-soft)' : 'transparent',
                    color: selectedSubs.includes(s.id) ? 'var(--accent)' : 'var(--text)',
                    cursor: 'pointer', fontSize: 14, fontWeight: selectedSubs.includes(s.id) ? 600 : 400 }}>
                  {s.iconEmoji} {s.name}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveSubjects} disabled={savingSubs}
                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
                {savingSubs ? '保存中…' : '保存'}
              </button>
              <button onClick={() => setSubjectModal(false)}
                style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 13 }}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 撤销弹窗 */}
      {revokeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setRevokeModal(false) }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: '1.5rem', width: 420, maxWidth: '90vw' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>撤销教师资格 — {teacher.user?.username}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.6 }}>
              撤销后将取消所有未来时间段和待确认/已确认的预约。
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>撤销原因（可选）</div>
            <textarea value={revokeReason} onChange={e => setRevokeReason(e.target.value)} placeholder="说明撤销原因…"
              rows={3} style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)', padding: '8px 10px', fontSize: 16, resize: 'none', boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)', outline: 'none', fontFamily: 'var(--sans)' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={doRevoke} disabled={acting}
                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: '#f59e0b', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
                {acting ? '处理中…' : '确认撤销'}
              </button>
              <button onClick={() => setRevokeModal(false)}
                style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 13 }}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
