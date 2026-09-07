import React, { useEffect, useState } from 'react'
import { adminTeacherApplications, adminApproveTeacher, adminRejectTeacher, adminRevokeTeacher } from '../../api/courses'
import useToastStore from '../../store/toastStore'

const TABS = [
  { key: 'pending',  label: '待审核' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'revoked',  label: '已撤销' },
]

const STATUS_BADGE = {
  pending:  { label: '待审核', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  approved: { label: '已通过', color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
  rejected: { label: '已拒绝', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  revoked:  { label: '已撤销', color: '#6b7280', bg: 'rgba(107,114,128,0.1)' },
}

export default function TeacherApprovals() {
  const toast = useToastStore(s => s.toast)
  const [tab, setTab] = useState('pending')
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [rejectModal, setRejectModal] = useState(null)   // { id, mode: 'reject'|'revoke' }
  const [reason, setReason] = useState('')
  const [acting, setActing] = useState(false)

  const load = (t) => {
    setLoading(true)
    adminTeacherApplications(t).then(r => setList(r.data)).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { load(tab) }, [tab])

  const approve = async (id) => {
    if (!confirm('确认通过该申请？通过后教师可以排班和接受预约。')) return
    setActing(true)
    try { await adminApproveTeacher(id); toast('已通过'); load(tab) }
    catch (e) { toast(e.response?.data || '操作失败', true) }
    finally { setActing(false) }
  }

  const doAction = async () => {
    if (rejectModal.mode === 'reject' && !reason.trim()) { toast('请填写拒绝原因', true); return }
    setActing(true)
    try {
      if (rejectModal.mode === 'reject') {
        await adminRejectTeacher(rejectModal.id, { reason })
        toast('已拒绝申请')
      } else {
        const r = await adminRevokeTeacher(rejectModal.id, { reason: reason || null })
        const { cancelledSlots, cancelledBookings } = r.data
        toast(`已撤销教师资格，同时取消了 ${cancelledSlots} 个时间段、${cancelledBookings} 条预约`)
      }
      setRejectModal(null); setReason(''); load(tab)
    } catch (e) { toast(e.response?.data || '操作失败', true) }
    finally { setActing(false) }
  }

  const badge = STATUS_BADGE[tab]

  return (
    <div>
      {/* 标签栏 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: tab === t.key ? 600 : 400,
              background: tab === t.key ? 'var(--accent)' : 'transparent',
              color: tab === t.key ? '#fff' : 'var(--muted)', cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', padding: '2rem', textAlign: 'center' }}>加载中…</div>
      ) : list.length === 0 ? (
        <div style={{ color: 'var(--muted)', padding: '2rem', textAlign: 'center', fontSize: 14 }}>暂无记录</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {list.map(t => (
            <div key={t.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '1.25rem 1.5rem' }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 12 }}>
                {t.user.avatarUrl
                  ? <img src={t.user.avatarUrl} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  : <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>👤</div>
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{t.user.username}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_BADGE[t.status]?.color, background: STATUS_BADGE[t.status]?.bg, padding: '2px 8px', borderRadius: 10 }}>
                      {STATUS_BADGE[t.status]?.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 6 }}>
                    申请学科：{t.subjects.map(s => s.name).join('、')}
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text)', margin: 0, lineHeight: 1.6 }}>{t.bio}</p>
                  {(t.rejectReason) && (
                    <div style={{ fontSize: 13, color: t.status === 'revoked' ? '#f59e0b' : '#ef4444', marginTop: 6, padding: '6px 10px', background: t.status === 'revoked' ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)', borderRadius: 6 }}>
                      {t.status === 'revoked' ? '撤销原因：' : '拒绝原因：'}{t.rejectReason}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                    申请时间：{new Date(t.createdAt).toLocaleString('zh-CN')}
                    {t.approvedAt && `　通过时间：${new Date(t.approvedAt).toLocaleString('zh-CN')}`}
                  </div>
                </div>
              </div>

              {/* 操作按钮 */}
              {tab === 'pending' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => approve(t.id)} disabled={!!acting}
                    style={{ padding: '8px 22px', borderRadius: 8, border: 'none', background: '#10b981', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                    ✓ 通过
                  </button>
                  <button onClick={() => { setRejectModal({ id: t.id, mode: 'reject' }); setReason('') }}
                    style={{ padding: '8px 22px', borderRadius: 8, border: '1.5px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.06)', color: '#ef4444', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                    ✕ 拒绝
                  </button>
                </div>
              )}

              {tab === 'approved' && (
                <button onClick={() => { setRejectModal({ id: t.id, mode: 'revoke' }); setReason('') }}
                  style={{ padding: '8px 22px', borderRadius: 8, border: '1.5px solid rgba(245,158,11,0.5)', background: 'rgba(245,158,11,0.06)', color: '#f59e0b', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  撤销教师资格
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 拒绝 / 撤销 弹窗 */}
      {rejectModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setRejectModal(null) }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: '1.5rem', width: 420, maxWidth: '90vw' }}>
            {rejectModal.mode === 'revoke' ? (
              <>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>撤销教师资格</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.6 }}>
                  撤销后将：<br/>
                  · 取消该教师未来所有空闲时间段<br/>
                  · 取消所有待处理和已确认的预约<br/>
                  · 教师将无法再排班和接受预约
                </div>
              </>
            ) : (
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 14 }}>拒绝申请</div>
            )}

            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {rejectModal.mode === 'revoke' ? '撤销原因（可选）' : '拒绝原因 *'}
            </div>
            <textarea value={reason} onChange={e => setReason(e.target.value)}
              placeholder={rejectModal.mode === 'revoke' ? '说明撤销原因，将通知教师…' : '请填写拒绝理由…'}
              rows={3} style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)', padding: '8px 10px', fontSize: 16, resize: 'none', boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)', outline: 'none', fontFamily: 'var(--sans)' }} />

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={doAction} disabled={acting}
                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none',
                  background: rejectModal.mode === 'revoke' ? '#f59e0b' : '#ef4444',
                  color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
                {acting ? '处理中…' : rejectModal.mode === 'revoke' ? '确认撤销' : '确认拒绝'}
              </button>
              <button onClick={() => setRejectModal(null)}
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
