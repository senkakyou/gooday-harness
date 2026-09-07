import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminListTeachers, adminRevokeTeacher } from '../../api/courses'
import useToastStore from '../../store/toastStore'

const yuan = (n) => '￥' + Number(n || 0).toFixed(2)

export default function AdminTeachers() {
  const navigate = useNavigate()
  const toast = useToastStore(s => s.toast)
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [revokeModal, setRevokeModal] = useState(null)  // { id, name }
  const [reason, setReason] = useState('')
  const [acting, setActing] = useState(false)

  const load = () => {
    setLoading(true)
    adminListTeachers().then(r => setList(r.data)).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const doRevoke = async () => {
    setActing(true)
    try {
      const r = await adminRevokeTeacher(revokeModal.id, { reason: reason || null })
      const { cancelledSlots, cancelledBookings } = r.data
      toast(`已撤销教师资格，取消了 ${cancelledSlots} 个时间段、${cancelledBookings} 条预约`)
      setRevokeModal(null); setReason(''); load()
    } catch (e) { toast(e.response?.data || '操作失败', true) }
    finally { setActing(false) }
  }

  if (loading) return <div style={{ color: 'var(--muted)', padding: '2rem', textAlign: 'center' }}>加载中…</div>

  return (
    <div>
      {list.length === 0 ? (
        <div style={{ color: 'var(--muted)', padding: '3rem', textAlign: 'center', fontSize: 14 }}>暂无认证教师</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {list.map(t => (
            <div key={t.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '1.125rem 1.25rem', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              {/* 头像 */}
              {(t.avatarUrl || t.user?.avatarUrl)
                ? <img src={t.avatarUrl || t.user.avatarUrl} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                : <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>👤</div>
              }

              {/* 主体信息 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{t.user?.username}</span>
                  <span style={{ fontSize: 11, color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>已认证</span>
                  {t.subjects?.map(s => (
                    <span key={s.id} style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '2px 8px', borderRadius: 10 }}>{s.name}</span>
                  ))}
                </div>

                {/* 统计数字 */}
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                  <span style={{ color: 'var(--text)' }}>本月 <b>{t.monthLessonCount}</b> 节</span>
                  <span style={{ color: '#10b981' }}>本月应收 <b>{yuan(t.monthDue)}</b></span>
                  <span style={{ color: 'var(--muted)' }}>学生 <b>{t.studentCount}</b> 人</span>
                  {t.totalOutstanding > 0 && (
                    <span style={{ color: '#ef4444' }}>累计欠费 <b>{yuan(t.totalOutstanding)}</b></span>
                  )}
                </div>
              </div>

              {/* 操作按钮 */}
              <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                <button onClick={() => navigate(`/admin/teachers/${t.id}`)}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>
                  详情
                </button>
                <button onClick={() => { setRevokeModal({ id: t.id, name: t.user?.username }); setReason('') }}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid rgba(245,158,11,0.5)', background: 'rgba(245,158,11,0.06)', color: '#f59e0b', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  撤销
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 撤销弹窗 */}
      {revokeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setRevokeModal(null) }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: '1.5rem', width: 420, maxWidth: '90vw' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>撤销教师资格 — {revokeModal.name}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.6 }}>
              撤销后将：<br/>
              · 取消该教师未来所有空闲时间段<br/>
              · 取消所有待处理和已确认的预约<br/>
              · 教师将无法再排班和接受预约
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>撤销原因（可选）</div>
            <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="说明撤销原因，将通知教师…"
              rows={3} style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)', padding: '8px 10px', fontSize: 16, resize: 'none', boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)', outline: 'none', fontFamily: 'var(--sans)' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={doRevoke} disabled={acting}
                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: '#f59e0b', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
                {acting ? '处理中…' : '确认撤销'}
              </button>
              <button onClick={() => setRevokeModal(null)}
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
