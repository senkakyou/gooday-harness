import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useToastStore from '../../store/toastStore'
import { teacherBookings, confirmBooking, teacherCancelBooking, completeBooking, uncompleteBooking, getExternalLessons, deleteLesson, updateLesson } from '../../api/courses'
import ExternalLessonModal from './ExternalLessonModal'

const TABS = [
  { key: 'pending',   label: '待处理', color: '#f59e0b' },
  { key: 'confirmed', label: '已确认', color: '#10b981' },
  { key: 'completed', label: '已结课', color: '#6366f1' },
  { key: 'all',       label: '全部',   color: null },
]
const STATUS_LABEL = { pending: '待确认', confirmed: '已确认', cancelled: '已取消', completed: '已完成' }
const STATUS_COLOR = { pending: '#f59e0b', confirmed: '#10b981', cancelled: '#6b7280', completed: '#6366f1' }
const STATUS_BG    = { pending: 'rgba(245,158,11,0.1)', confirmed: 'rgba(16,185,129,0.1)', cancelled: 'rgba(107,114,128,0.1)', completed: 'rgba(99,102,241,0.1)' }

export default function TeacherBookings() {
  const navigate = useNavigate()
  const toast = useToastStore(s => s.toast)
  const [tab, setTab] = useState('pending')
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [rejectModal, setRejectModal] = useState(null)
  const [rejectNote, setRejectNote] = useState('')
  const [acting, setActing] = useState(null)
  const [doneModal, setDoneModal] = useState(null)   // 完成上课弹窗的 booking
  const [doneFee, setDoneFee] = useState('')
  const [doneNote, setDoneNote] = useState('')
  const [extModal, setExtModal] = useState(false)      // 补录外部课时
  const [extLessons, setExtLessons] = useState([])     // 补录的外部课时列表
  const [editLesson, setEditLesson] = useState(null)   // 正在编辑的外部课时
  const [editForm, setEditForm] = useState({ lessonDate: '', fee: '', durationMinutes: '', note: '' })
  const [deleteConfirm, setDeleteConfirm] = useState(null) // 待确认删除的外部课时

  const loadExt = () => getExternalLessons().then(r => setExtLessons(r.data || [])).catch(() => {})

  const load = (t) => {
    setLoading(true)
    teacherBookings(t).then(r => setBookings(r.data)).catch(() => setBookings([])).finally(() => setLoading(false))
    if (t === 'completed' || t === 'all') loadExt()
  }
  useEffect(() => { load(tab) }, [tab])

  const confirm = async (id) => {
    setActing(id)
    try { await confirmBooking(id, {}); toast('已确认预约'); load(tab) }
    catch (e) { toast(e.response?.data || '操作失败', true) }
    finally { setActing(null) }
  }

  const doReject = async () => {
    setActing(rejectModal)
    try {
      await teacherCancelBooking(rejectModal, { note: rejectNote })
      toast('已拒绝'); setRejectModal(null); setRejectNote(''); load(tab)
    } catch (e) { toast(e.response?.data || '操作失败', true) }
    finally { setActing(null) }
  }

  const uncomplete = async (id) => {
    if (!confirm('撤销结课？将退回「已确认」并删除这节课的课时记录。')) return
    setActing(id)
    try { await uncompleteBooking(id); toast('已撤销结课'); load(tab) }
    catch (e) { toast(e.response?.data || '操作失败', true) }
    finally { setActing(null) }
  }

  const openDone = (b) => { setDoneModal(b); setDoneFee(b.defaultFee != null ? String(b.defaultFee) : ''); setDoneNote('') }
  const doComplete = async () => {
    const fee = parseFloat(doneFee)
    if (isNaN(fee) || fee < 0) { toast('请填写正确的课时费', true); return }
    setActing(doneModal.id)
    try {
      await completeBooking(doneModal.id, { fee, note: doneNote || null })
      toast('已记入课时'); setDoneModal(null); load(tab)
    } catch (e) { toast(e.response?.data || '操作失败', true) }
    finally { setActing(null) }
  }

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
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>预约管理</span>
        </button>
        {!loading && <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{bookings.length} 条</span>}
      </div>

      <div style={{ padding: '0.875rem 1rem 0' }}>
        {/* 标签栏 */}
        <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 4, marginBottom: '1rem', gap: 4 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', fontSize: 14, fontWeight: tab === t.key ? 700 : 400,
                background: tab === t.key ? 'var(--accent)' : 'transparent',
                color: tab === t.key ? '#fff' : 'var(--muted)', cursor: 'pointer', transition: 'background .15s, color .15s' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* 补录外部课时 */}
        <button onClick={() => setExtModal(true)}
          style={{ width: '100%', padding: '11px 0', borderRadius: 12, border: '1.5px dashed var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', cursor: 'pointer', fontSize: 14, fontWeight: 700, marginBottom: '1rem' }}>
          + 补录外部课时（线下/微信约的课）
        </button>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ height: 130, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--border)' }} />
            ))}
          </div>
        ) : bookings.length === 0 && ((tab !== 'completed' && tab !== 'all') || extLessons.length === 0) ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '4rem 0', fontSize: 14 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📋</div>
            暂无{tab === 'pending' ? '待处理' : tab === 'confirmed' ? '已确认' : tab === 'completed' ? '已结课' : ''}预约记录
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 补录的外部课时（已结课/全部 标签页下显示）*/}
            {(tab === 'completed' || tab === 'all') && extLessons.map(l => (
              <div key={`ext-${l.id}`} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ height: 3, background: '#6366f1' }} />
                <div style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                        {l.student?.avatarUrl
                          ? <img src={l.student.avatarUrl} alt="" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
                          : '👤'}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{l.student?.displayName || '未知学生'}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{l.student?.isOffline ? '线下学生' : '学生'}</div>
                      </div>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#6366f1', background: 'rgba(99,102,241,0.1)', padding: '4px 10px', borderRadius: 20 }}>补录</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, background: 'var(--bg)', marginBottom: 10 }}>
                    <span style={{ fontSize: 18 }}>📅</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{l.lessonDate}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>
                        {l.durationMinutes ? `${l.durationMinutes}分钟 · ` : ''}<span style={{ color: '#6366f1', fontWeight: 600 }}>￥{Number(l.fee).toFixed(2)}</span>{l.note ? ` · ${l.note}` : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setEditLesson(l); setEditForm({ lessonDate: l.lessonDate, fee: String(l.fee), durationMinutes: l.durationMinutes ? String(l.durationMinutes) : '', note: l.note || '' }) }}
                      style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: '1px solid var(--border)', background: 'none', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>编辑</button>
                    <button onClick={() => setDeleteConfirm(l)}
                      style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: '#ef4444', fontSize: 13, cursor: 'pointer' }}>删除</button>
                  </div>
                </div>
              </div>
            ))}
            {bookings.map(b => (
              <div key={b.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ height: 3, background: STATUS_COLOR[b.status] }} />
                <div style={{ padding: '1rem' }}>
                  {/* 学生信息 + 状态 */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {b.student?.avatarUrl
                        ? <img src={b.student.avatarUrl} alt="" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
                        : <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>👤</div>
                      }
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{b.student?.username || b.offlineStudent?.displayName || '未知学生'}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{b.offlineStudent ? '线下学生' : '学生'}</div>
                      </div>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLOR[b.status], background: STATUS_BG[b.status], padding: '4px 10px', borderRadius: 20 }}>
                      {STATUS_LABEL[b.status]}
                    </span>
                  </div>

                  {/* 时间信息 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, background: 'var(--bg)', marginBottom: b.note ? 10 : 0 }}>
                    <span style={{ fontSize: 18 }}>📅</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{b.slot?.date} {b.slot?.startTime}–{b.slot?.endTime}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{b.slot?.durationMinutes}分钟课程</div>
                    </div>
                  </div>

                  {b.note && (
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 10, padding: '8px 10px', background: 'var(--bg)', borderRadius: 8 }}>
                      <span style={{ fontWeight: 600 }}>学生备注：</span>{b.note}
                    </div>
                  )}

                  {/* 操作按钮 */}
                  {b.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                      <button onClick={() => confirm(b.id)} disabled={acting === b.id}
                        style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#10b981', color: '#fff', cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>
                        {acting === b.id ? '处理中…' : '✓ 接受'}
                      </button>
                      <button onClick={() => { setRejectModal(b.id); setRejectNote('') }}
                        style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: '1.5px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.06)', color: '#ef4444', cursor: 'pointer', fontSize: 15, fontWeight: 600 }}>
                        ✕ 拒绝
                      </button>
                    </div>
                  )}
                  {b.status === 'confirmed' && (
                    <button onClick={() => openDone(b)} disabled={acting === b.id}
                      style={{ width: '100%', marginTop: 14, padding: '12px 0', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>
                      ✓ 完成上课并记课时
                    </button>
                  )}
                  {b.status === 'completed' && (
                    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ fontSize: 13, color: '#6366f1', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>✓</span> 已结课并记入课时结算
                      </span>
                      <button onClick={() => uncomplete(b.id)} disabled={acting === b.id}
                        style={{ fontSize: 12, color: 'var(--muted)', background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', flexShrink: 0 }}>
                        撤销结课
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 拒绝弹窗 */}
      {rejectModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setRejectModal(null) }}>
          <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '1.5rem 1rem 2rem', width: '100%', maxWidth: 680 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>拒绝此预约</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>填写拒绝原因，学生将收到通知</div>
            <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)}
              placeholder="例：该时段临时有事，请重新选择时间…"
              rows={3} style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)', padding: '10px 12px', fontSize: 16, resize: 'none', boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)', outline: 'none', fontFamily: 'var(--sans)' }} />
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={doReject} disabled={!!acting}
                style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>
                {acting ? '处理中…' : '确认拒绝'}
              </button>
              <button onClick={() => setRejectModal(null)}
                style={{ padding: '13px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 14 }}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 完成上课 / 记课时弹窗 */}
      {doneModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setDoneModal(null) }}>
          <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '1.5rem 1rem 2rem', width: '100%', maxWidth: 680 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>完成上课</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              {doneModal.student?.username || doneModal.offlineStudent?.displayName || '未知学生'} · {doneModal.slot?.date} {doneModal.slot?.startTime}–{doneModal.slot?.endTime}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>本节课时费 <span style={{ color: '#ef4444' }}>*</span></div>
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 16 }}>￥</span>
              <input type="number" value={doneFee} onChange={e => setDoneFee(e.target.value)} min={0} step="0.01" placeholder="0.00" autoFocus
                style={{ width: '100%', padding: '11px 12px 11px 28px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 16, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box', outline: 'none' }} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>备注（可选）</div>
            <input value={doneNote} onChange={e => setDoneNote(e.target.value)} placeholder="例：本节讲了二次函数"
              style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 16, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box', outline: 'none', fontFamily: 'var(--sans)', marginBottom: 16 }} />
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
              确认后这节课计入该学生的应收课费，可在「学生管理 · 课时结算」查看与记缴费。
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={doComplete} disabled={acting === doneModal.id}
                style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>
                {acting === doneModal.id ? '处理中…' : '确认完成'}
              </button>
              <button onClick={() => setDoneModal(null)}
                style={{ padding: '13px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 14 }}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除补录课时确认弹窗 */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setDeleteConfirm(null) }}>
          <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '1.5rem 1rem 2rem', width: '100%', maxWidth: 680 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>确认删除这条补录记录？</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>
              {deleteConfirm.student?.displayName} · {deleteConfirm.lessonDate}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
              删除后课时费记录也会同步移除，无法撤销。
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={async () => {
                const id = deleteConfirm.id
                setDeleteConfirm(null)
                try {
                  await deleteLesson(id)
                  toast('已删除')
                  loadExt()
                } catch (e) { toast(e.message || '删除失败', true) }
              }} style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>
                确认删除
              </button>
              <button onClick={() => setDeleteConfirm(null)}
                style={{ padding: '13px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 14 }}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑外部课时弹窗 */}
      {editLesson && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setEditLesson(null) }}>
          <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '1.5rem 1rem 2rem', width: '100%', maxWidth: 680 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>编辑补录课时</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{editLesson.student?.displayName}</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>上课日期</div>
            <input type="date" value={editForm.lessonDate} onChange={e => setEditForm(f => ({ ...f, lessonDate: e.target.value }))}
              style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 16, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box', marginBottom: 12 }} />
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>课时费 <span style={{ color: '#ef4444' }}>*</span></div>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 16 }}>￥</span>
              <input type="number" value={editForm.fee} onChange={e => setEditForm(f => ({ ...f, fee: e.target.value }))} min={0} step="0.01"
                style={{ width: '100%', padding: '11px 12px 11px 28px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 16, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box', outline: 'none' }} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>时长（分钟，可选）</div>
            <input type="number" value={editForm.durationMinutes} onChange={e => setEditForm(f => ({ ...f, durationMinutes: e.target.value }))} min={0} placeholder="例：90"
              style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 16, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box', outline: 'none', marginBottom: 12 }} />
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>备注（可选）</div>
            <input value={editForm.note} onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))} placeholder="例：本节讲了二次函数"
              style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 16, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box', outline: 'none', fontFamily: 'var(--sans)', marginBottom: 16 }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={async () => {
                const fee = parseFloat(editForm.fee)
                if (isNaN(fee) || fee < 0) { toast('请填写正确的课时费', true); return }
                if (!editForm.lessonDate) { toast('请选择上课日期', true); return }
                try {
                  await updateLesson(editLesson.id, {
                    lessonDate: editForm.lessonDate, fee,
                    durationMinutes: editForm.durationMinutes ? parseInt(editForm.durationMinutes) : 0,
                    note: editForm.note || ''
                  })
                  toast('已保存'); setEditLesson(null); loadExt()
                } catch (e) { toast(e.response?.data || '保存失败', true) }
              }} style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>
                保存
              </button>
              <button onClick={() => setEditLesson(null)}
                style={{ padding: '13px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 14 }}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 补录外部课时 */}
      {extModal && (
        <ExternalLessonModal
          onClose={() => setExtModal(false)}
          onDone={() => { setExtModal(false); toast('补录完成，可在「学生管理·课时结算」查看'); loadExt() }}
        />
      )}
    </div>
  )
}
