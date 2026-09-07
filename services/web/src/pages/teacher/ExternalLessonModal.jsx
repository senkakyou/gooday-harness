import React, { useEffect, useState } from 'react'
import useToastStore from '../../store/toastStore'
import { teacherStudents, addTeacherStudent, addLessonsBatch } from '../../api/courses'
import { ymd } from '../../utils/localDate'

const yuan = (n) => '￥' + Number(n || 0).toFixed(2)
const today = () => ymd()
const inp = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box', outline: 'none', fontFamily: 'var(--sans)' }

// 补录外部课时：选名录学生 / 新建学生 → 批量加课时（带默认课时费/同上次） → 可选当场收款
export default function ExternalLessonModal({ onClose, onDone }) {
  const toast = useToastStore(s => s.toast)
  const [students, setStudents] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [step, setStep] = useState('pick')   // pick | newStudent | lessons
  const [picked, setPicked] = useState(null)  // 选中的学生对象
  const [search, setSearch] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 新建学生表单
  const [nsName, setNsName] = useState('')
  const [nsPhone, setNsPhone] = useState('')
  const [nsFee, setNsFee] = useState('')

  // 课时行 + 缴费
  const [rows, setRows] = useState([{ lessonDate: today(), fee: '', durationMinutes: '', note: '' }])
  const [withPay, setWithPay] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(today())

  useEffect(() => {
    teacherStudents(false).then(r => setStudents(r.data)).catch(() => setStudents([])).finally(() => setLoadingList(false))
  }, [])

  // 选中学生后进入课时步骤，默认带入「常用课时费 > 上次课时费」
  const choose = (s) => {
    setPicked(s)
    const defFee = s.defaultFee ?? s.lastFee ?? ''
    const defDur = s.lastDuration ?? ''
    setRows([{ lessonDate: today(), fee: defFee === null ? '' : String(defFee), durationMinutes: defDur === null ? '' : String(defDur), note: '' }])
    setWithPay(false); setPayAmount(''); setPayDate(today())
    setStep('lessons')
  }

  const createStudent = async () => {
    if (!nsName.trim()) { toast('请填写学生姓名', true); return }
    setSubmitting(true)
    try {
      const r = await addTeacherStudent({ displayName: nsName.trim(), phone: nsPhone || null, defaultFee: nsFee ? parseFloat(nsFee) : null })
      const newStu = { id: r.data.id, displayName: nsName.trim(), defaultFee: nsFee ? parseFloat(nsFee) : null, lastFee: null, lastDuration: null }
      setStudents(prev => [newStu, ...prev])
      choose(newStu)
    } catch (e) { toast(e.response?.data || '创建失败', true) }
    finally { setSubmitting(false) }
  }

  const setRow = (i, k, v) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, [k]: v } : r))
  const addRow = () => {
    const last = rows[rows.length - 1]
    setRows(rs => [...rs, { lessonDate: today(), fee: last?.fee || '', durationMinutes: last?.durationMinutes || '', note: '' }])
  }
  const removeRow = (i) => setRows(rs => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs)

  const totalFee = rows.reduce((s, r) => s + (parseFloat(r.fee) || 0), 0)

  const submit = async () => {
    for (const r of rows) {
      if (!r.lessonDate) { toast('每节课都要选日期', true); return }
      const f = parseFloat(r.fee)
      if (isNaN(f) || f < 0) { toast('请填写正确的课时费', true); return }
    }
    let payment = null
    if (withPay) {
      const amt = parseFloat(payAmount)
      if (isNaN(amt) || amt <= 0) { toast('收款金额必须大于 0', true); return }
      if (!payDate) { toast('请选择收款日期', true); return }
      payment = { amount: amt, paidDate: payDate, note: '补录外部课时收款' }
    }
    setSubmitting(true)
    try {
      await addLessonsBatch(picked.id, {
        lessons: rows.map(r => ({
          lessonDate: r.lessonDate, fee: parseFloat(r.fee),
          durationMinutes: r.durationMinutes ? parseInt(r.durationMinutes) : null,
          note: r.note || null,
        })),
        payment,
      })
      toast(`已补录 ${rows.length} 节课`)
      onDone?.()
    } catch (e) { toast(e.response?.data || '补录失败', true) }
    finally { setSubmitting(false) }
  }

  const filtered = students.filter(s => !search || s.displayName.includes(search))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1100 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '1.25rem 1rem 2rem', width: '100%', maxWidth: 680, maxHeight: '92vh', overflowY: 'auto' }}>

        {/* 头 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>
            {step === 'pick' ? '补录外部课时' : step === 'newStudent' ? '新建学生' : `补录 · ${picked?.displayName}`}
          </span>
          <button className="modal-x" onClick={onClose}>×</button>
        </div>

        {/* 选学生 */}
        {step === 'pick' && (
          <>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>给系统外（线下/微信约）的课记账。先选学生：</div>
            <button onClick={() => { setNsName(''); setNsPhone(''); setNsFee(''); setStep('newStudent') }}
              style={{ width: '100%', padding: '12px 0', borderRadius: 12, border: '1.5px dashed var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', cursor: 'pointer', fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
              + 新建学生
            </button>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索常用学生…" style={{ ...inp, marginBottom: 10 }} />
            {loadingList ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '1.5rem 0' }}>加载中…</div>
            ) : filtered.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '1.5rem 0' }}>暂无学生，点上面「新建学生」</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.map(s => (
                  <button key={s.id} onClick={() => choose(s)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                    {s.avatarUrl
                      ? <img src={s.avatarUrl} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                      : <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>{s.studentUserId ? '👤' : '🧑'}</div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{s.displayName}{!s.studentUserId && <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 5 }}>线下</span>}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                        {s.defaultFee != null ? `常用 ${yuan(s.defaultFee)}` : s.lastFee != null ? `上次 ${yuan(s.lastFee)}` : '未设课时费'}
                      </div>
                    </div>
                    {s.balance < 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '3px 8px', borderRadius: 10, flexShrink: 0 }}>欠 {yuan(-s.balance)}</span>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* 新建学生 */}
        {step === 'newStudent' && (
          <>
            <div style={{ marginBottom: 12 }}><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>学生姓名 <span style={{ color: '#ef4444' }}>*</span></div>
              <input value={nsName} onChange={e => setNsName(e.target.value)} placeholder="例：王小明" autoFocus style={inp} /></div>
            <div style={{ marginBottom: 12 }}><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>联系电话</div>
              <input value={nsPhone} onChange={e => setNsPhone(e.target.value)} placeholder="选填" style={inp} /></div>
            <div style={{ marginBottom: 16 }}><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>常用课时费</div>
              <input type="number" value={nsFee} onChange={e => setNsFee(e.target.value)} placeholder="选填，以后补课自动带入" min={0} style={inp} /></div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={createStudent} disabled={submitting}
                style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>
                {submitting ? '创建中…' : '创建并继续'}
              </button>
              <button onClick={() => setStep('pick')} style={{ padding: '12px 18px', borderRadius: 12, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 14 }}>返回</button>
            </div>
          </>
        )}

        {/* 填课时 */}
        {step === 'lessons' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {rows.map((r, i) => (
                <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', background: 'var(--bg)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>第 {i + 1} 节</span>
                    {rows.length > 1 && <button onClick={() => removeRow(i)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 14, cursor: 'pointer' }}>✕</button>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input type="date" value={r.lessonDate} onChange={e => setRow(i, 'lessonDate', e.target.value)} style={{ ...inp, flex: 1.4 }} />
                    <div style={{ position: 'relative', flex: 1 }}>
                      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 14 }}>￥</span>
                      <input type="number" value={r.fee} onChange={e => setRow(i, 'fee', e.target.value)} placeholder="课时费" min={0} style={{ ...inp, paddingLeft: 24 }} />
                    </div>
                    <input type="number" value={r.durationMinutes} onChange={e => setRow(i, 'durationMinutes', e.target.value)} placeholder="分钟" min={0} style={{ ...inp, flex: 0.8 }} />
                  </div>
                  <input value={r.note} onChange={e => setRow(i, 'note', e.target.value)} placeholder="备注（可选）" style={inp} />
                </div>
              ))}
            </div>
            <button onClick={addRow}
              style={{ width: '100%', padding: '10px 0', borderRadius: 10, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
              + 再加一节
            </button>

            {/* 同时收款 */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', marginBottom: withPay ? 10 : 4 }}>
              <input type="checkbox" checked={withPay} onChange={e => { setWithPay(e.target.checked); if (e.target.checked && !payAmount) setPayAmount(String(totalFee || '')) }} style={{ cursor: 'pointer' }} />
              本次同时收款（线下当场收钱）
            </label>
            {withPay && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 14 }}>￥</span>
                  <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="收款金额" min={0} style={{ ...inp, paddingLeft: 24 }} />
                </div>
                <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} style={{ ...inp, flex: 1 }} />
              </div>
            )}

            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, padding: '8px 12px', background: 'var(--bg)', borderRadius: 8 }}>
              共 {rows.length} 节 · 课时费合计 <span style={{ fontWeight: 700, color: 'var(--text)' }}>{yuan(totalFee)}</span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={submit} disabled={submitting}
                style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>
                {submitting ? '保存中…' : '保存补录'}
              </button>
              <button onClick={() => setStep('pick')} style={{ padding: '13px 18px', borderRadius: 12, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 14 }}>换学生</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
