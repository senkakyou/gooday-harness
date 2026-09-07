import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import useToastStore from '../../store/toastStore'
import useAuthStore from '../../store/authStore'
import {
  teacherStudentDetail, updateTeacherStudent,
  addLesson, deleteLesson, addPayment, deletePayment, linkStudentUser,
} from '../../api/courses'
import { StudentStatementModal } from './Statements'
import { ymd } from '../../utils/localDate'

const yuan = (n) => '￥' + Number(n || 0).toFixed(2)
const today = () => ymd()

export default function TeacherStudentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToastStore(s => s.toast)
  const teacherName = useAuthStore(s => s.user?.username)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)   // 'lesson' | 'payment' | 'edit' | 'link'
  const [showStatement, setShowStatement] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [linkUsername, setLinkUsername] = useState('')
  const [lessonForm, setLessonForm] = useState({ lessonDate: today(), fee: '', durationMinutes: '', note: '' })
  const [payForm, setPayForm] = useState({ amount: '', paidDate: today(), note: '' })
  const [editForm, setEditForm] = useState({ displayName: '', phone: '', note: '', defaultFee: '', isArchived: false })

  const load = () => teacherStudentDetail(id).then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false))
  useEffect(() => { setLoading(true); load() }, [id])

  const openEdit = () => {
    setEditForm({ displayName: data.displayName || '', phone: data.phone || '', note: data.note || '', defaultFee: data.defaultFee != null ? String(data.defaultFee) : '', isArchived: data.isArchived })
    setModal('edit')
  }

  const doAddLesson = async () => {
    const fee = parseFloat(lessonForm.fee)
    if (!lessonForm.lessonDate) { toast('请选择上课日期', true); return }
    if (isNaN(fee) || fee < 0) { toast('请填写正确的课时费', true); return }
    setSubmitting(true)
    try {
      await addLesson(id, {
        lessonDate: lessonForm.lessonDate, fee,
        durationMinutes: lessonForm.durationMinutes ? parseInt(lessonForm.durationMinutes) : null,
        note: lessonForm.note || null,
      })
      toast('已补录课时'); setModal(null); setLessonForm({ lessonDate: today(), fee: '', durationMinutes: '', note: '' }); load()
    } catch (e) { toast(e.response?.data || '操作失败', true) }
    finally { setSubmitting(false) }
  }

  const doAddPayment = async () => {
    const amount = parseFloat(payForm.amount)
    if (!payForm.paidDate) { toast('请选择缴费日期', true); return }
    if (isNaN(amount) || amount <= 0) { toast('缴费金额必须大于 0', true); return }
    setSubmitting(true)
    try {
      await addPayment(id, { amount, paidDate: payForm.paidDate, note: payForm.note || null })
      toast('已记录缴费'); setModal(null); setPayForm({ amount: '', paidDate: today(), note: '' }); load()
    } catch (e) { toast(e.response?.data || '操作失败', true) }
    finally { setSubmitting(false) }
  }

  const doEdit = async () => {
    if (!editForm.displayName.trim()) { toast('姓名不能为空', true); return }
    let defaultFee = -1   // 后端约定：负值表示清空常用课时费
    if (editForm.defaultFee !== '') {
      defaultFee = parseFloat(editForm.defaultFee)
      if (isNaN(defaultFee) || defaultFee < 0) { toast('常用课时费请填写非负数字', true); return }
    }
    setSubmitting(true)
    try {
      await updateTeacherStudent(id, { displayName: editForm.displayName.trim(), phone: editForm.phone, note: editForm.note, defaultFee, isArchived: editForm.isArchived })
      toast('已保存'); setModal(null); load()
    } catch (e) { toast(e.response?.data || '操作失败', true) }
    finally { setSubmitting(false) }
  }

  const removeLesson = async (lid) => {
    if (!confirm('删除这节课时记录？')) return
    try { await deleteLesson(lid); toast('已删除'); load() } catch (e) { toast(e.response?.data || '操作失败', true) }
  }
  const removePayment = async (pid) => {
    if (!confirm('删除这笔缴费记录？')) return
    try { await deletePayment(pid); toast('已删除'); load() } catch (e) { toast(e.response?.data || '操作失败', true) }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: '5rem 1rem', color: 'var(--muted)' }}><div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>加载中…</div>
  if (!data) return <div style={{ textAlign: 'center', padding: '5rem 1rem', color: 'var(--muted)' }}>学生不存在或无权查看</div>

  const balance = data.balance
  const owe = balance < 0, settled = balance === 0
  const balColor = settled ? 'var(--muted)' : owe ? '#ef4444' : '#10b981'
  const balLabel = settled ? '已结清' : owe ? '学生欠费' : '学生预存'

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 0 5rem' }}>
      {/* 顶部导航 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)', borderBottom: '1px solid var(--border)', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate('/teacher/students')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, flex: 1, padding: 0, minWidth: 0, overflow: 'hidden' }}>
          <span style={{ color: 'var(--muted)', fontSize: 22, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>‹</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.displayName}</span>
        </button>
        <button onClick={() => setShowStatement(true)}
          style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '6px 12px', borderRadius: 9 }}>账单</button>
        <button onClick={openEdit}
          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, padding: '6px 12px', borderRadius: 9 }}>编辑</button>
      </div>

      <div style={{ padding: '1rem' }}>
        {/* 档案信息 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          {data.avatarUrl
            ? <img src={data.avatarUrl} alt="" style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover' }} />
            : <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{data.studentUserId ? '👤' : '🧑'}</div>
          }
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 17 }}>{data.displayName}</span>
              {!data.studentUserId && <span style={{ fontSize: 10, color: 'var(--muted)', background: 'var(--surface)', padding: '1px 6px', borderRadius: 6 }}>线下</span>}
              {data.isArchived && <span style={{ fontSize: 10, color: '#6b7280', background: 'rgba(107,114,128,0.12)', padding: '1px 6px', borderRadius: 6 }}>已归档</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
              {data.studentUserId ? `平台账号 @${data.username}` : '线下学生'}{data.phone ? ` · ${data.phone}` : ''}
            </div>
            {data.note && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>📝 {data.note}</div>}
          </div>
        </div>

        {/* 线下学生绑定平台账号 */}
        {!data.studentUserId && (
          <div style={{ background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 12, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>线下学生</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>绑定平台账号后可接收课程通知</div>
            </div>
            <button onClick={() => { setLinkUsername(''); setModal('link') }}
              style={{ padding: '7px 14px', borderRadius: 9, border: '1px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              绑定账号
            </button>
          </div>
        )}

        {/* 账本 hero */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '1.25rem', marginBottom: 14 }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>{balLabel}</div>
            <div style={{ fontSize: 34, fontWeight: 800, color: balColor, fontFamily: 'var(--mono)', lineHeight: 1 }}>
              {settled ? yuan(0) : yuan(Math.abs(balance))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, padding: '12px 0 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 3 }}>累计应收</div>
              <div style={{ fontSize: 17, fontWeight: 700, fontFamily: 'var(--mono)' }}>{yuan(data.totalDue)}</div>
            </div>
            <div style={{ width: 1, background: 'var(--border)' }} />
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 3 }}>累计已交</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#10b981', fontFamily: 'var(--mono)' }}>{yuan(data.totalPaid)}</div>
            </div>
          </div>
        </div>

        {/* 操作 */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <button onClick={() => { setPayForm({ amount: '', paidDate: today(), note: '' }); setModal('payment') }}
            style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#10b981', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>＋ 记一笔缴费</button>
          <button onClick={() => { setLessonForm({ lessonDate: today(), fee: data.defaultFee != null ? String(data.defaultFee) : '', durationMinutes: '', note: '' }); setModal('lesson') }}
            style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: '1.5px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>＋ 补一节课时</button>
        </div>

        {/* 课时明细 */}
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>课时明细 <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>({data.lessons.length})</span></div>
        {data.lessons.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: '1rem', textAlign: 'center', background: 'var(--surface)', borderRadius: 12, marginBottom: 20 }}>暂无课时记录</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {data.lessons.map(l => (
              <div key={l.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{l.lessonDate}</span>
                    {l.durationMinutes ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>{l.durationMinutes}分钟</span> : null}
                    {l.bookingId ? <span style={{ fontSize: 10, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '1px 6px', borderRadius: 6 }}>来自预约</span> : null}
                  </div>
                  {l.note && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{l.note}</div>}
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--mono)' }}>{yuan(l.fee)}</span>
                <button onClick={() => removeLesson(l.id)} title="删除"
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* 缴费明细 */}
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>缴费明细 <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>({data.payments.length})</span></div>
        {data.payments.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: '1rem', textAlign: 'center', background: 'var(--surface)', borderRadius: 12 }}>暂无缴费记录</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.payments.map(p => (
              <div key={p.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>💵</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{p.paidDate}</div>
                  {p.note && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{p.note}</div>}
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#10b981', fontFamily: 'var(--mono)' }}>+{yuan(p.amount)}</span>
                <button onClick={() => removePayment(p.id)} title="删除"
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 对账单 */}
      {showStatement && (
        <StudentStatementModal
          student={data} lessons={data.lessons} payments={data.payments}
          totalDue={data.totalDue} totalPaid={data.totalPaid}
          teacherName={teacherName} onClose={() => setShowStatement(false)} />
      )}

      {/* ── 弹窗 ── */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setModal(null) }}>
          <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '1.5rem 1rem 2rem', width: '100%', maxWidth: 680 }}>

            {modal === 'payment' && (<>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>记一笔缴费</div>
              <Field label="缴费金额" req>
                <MoneyInput value={payForm.amount} onChange={v => setPayForm(f => ({ ...f, amount: v }))} autoFocus />
              </Field>
              <Field label="缴费日期" req>
                <input type="date" value={payForm.paidDate} onChange={e => setPayForm(f => ({ ...f, paidDate: e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="备注（可选）">
                <input value={payForm.note} onChange={e => setPayForm(f => ({ ...f, note: e.target.value }))} placeholder="例：微信转账" style={inputStyle} />
              </Field>
              <ModalActions onOk={doAddPayment} okText="保存缴费" busy={submitting} onCancel={() => setModal(null)} />
            </>)}

            {modal === 'lesson' && (<>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>补一节课时</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>用于线下课或漏记的课，会计入应收</div>
              <Field label="上课日期" req>
                <input type="date" value={lessonForm.lessonDate} onChange={e => setLessonForm(f => ({ ...f, lessonDate: e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="课时费" req>
                <MoneyInput value={lessonForm.fee} onChange={v => setLessonForm(f => ({ ...f, fee: v }))} />
              </Field>
              <Field label="时长（分钟，可选）">
                <input type="number" value={lessonForm.durationMinutes} onChange={e => setLessonForm(f => ({ ...f, durationMinutes: e.target.value }))} placeholder="例：60" min={0} style={inputStyle} />
              </Field>
              <Field label="备注（可选）">
                <input value={lessonForm.note} onChange={e => setLessonForm(f => ({ ...f, note: e.target.value }))} placeholder="例：本节讲了三角函数" style={inputStyle} />
              </Field>
              <ModalActions onOk={doAddLesson} okText="保存课时" busy={submitting} onCancel={() => setModal(null)} />
            </>)}

            {modal === 'edit' && (<>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>编辑学生</div>
              <Field label="姓名 / 备注名" req>
                <input value={editForm.displayName} onChange={e => setEditForm(f => ({ ...f, displayName: e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="联系电话">
                <input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="选填" style={inputStyle} />
              </Field>
              <Field label="备注">
                <input value={editForm.note} onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))} placeholder="选填" style={inputStyle} />
              </Field>
              <Field label="常用课时费">
                <MoneyInput value={editForm.defaultFee} onChange={v => setEditForm(f => ({ ...f, defaultFee: v }))} />
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 5 }}>设置后，补课 / 结课时自动带入，留空则不带入</div>
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', margin: '4px 0 8px' }}>
                <input type="checkbox" checked={editForm.isArchived} onChange={e => setEditForm(f => ({ ...f, isArchived: e.target.checked }))} style={{ cursor: 'pointer' }} />
                归档该学生（从默认名单隐藏，记录保留）
              </label>
              <ModalActions onOk={doEdit} okText="保存" busy={submitting} onCancel={() => setModal(null)} />
            </>)}

            {modal === 'link' && (<>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>绑定平台账号</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>输入学生在平台的用户名，绑定后可接收课程通知</div>
              <Field label="平台用户名" req>
                <input value={linkUsername} onChange={e => setLinkUsername(e.target.value)}
                  placeholder="例：小明" autoFocus style={inputStyle} />
              </Field>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
                学生需已在 Gooday 注册账号，用户名在其「我的」页面可查看。
              </div>
              <ModalActions onOk={async () => {
                if (!linkUsername.trim()) { toast('请填写用户名', true); return }
                setSubmitting(true)
                try {
                  await linkStudentUser(id, { username: linkUsername.trim() })
                  toast('绑定成功'); setModal(null); load()
                } catch (e) { toast(e.response?.data || '绑定失败', true) }
                finally { setSubmitting(false) }
              }} okText="确认绑定" busy={submitting} onCancel={() => setModal(null)} />
            </>)}
          </div>
        </div>
      )}
    </div>
  )
}

const inputStyle = { width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 16, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box', outline: 'none', fontFamily: 'var(--sans)' }

function Field({ label, req, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{label}{req && <span style={{ color: '#ef4444' }}> *</span>}</div>
      {children}
    </div>
  )
}

function MoneyInput({ value, onChange, autoFocus }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 16 }}>￥</span>
      <input type="number" value={value} onChange={e => onChange(e.target.value)} min={0} step="0.01" placeholder="0.00" autoFocus={autoFocus}
        style={{ ...inputStyle, padding: '11px 12px 11px 28px', fontSize: 16 }} />
    </div>
  )
}

function ModalActions({ onOk, okText, busy, onCancel }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
      <button onClick={onOk} disabled={busy}
        style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>
        {busy ? '保存中…' : okText}
      </button>
      <button onClick={onCancel}
        style={{ padding: '13px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 14 }}>取消</button>
    </div>
  )
}
