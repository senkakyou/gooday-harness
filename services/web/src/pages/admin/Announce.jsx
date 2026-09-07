import React, { useState } from 'react'
import useToastStore from '../../store/toastStore'
import { broadcastNotification } from '../../api/notifications'

export default function Announce() {
  const toast = useToastStore(s => s.toast)
  const [form, setForm] = useState({ title: '', body: '', linkUrl: '' })
  const [sending, setSending] = useState(false)
  const [lastSent, setLastSent] = useState(null)

  const send = async () => {
    if (!form.title.trim()) { toast('请填写公告标题', true); return }
    if (!confirm('确定向所有用户发送这条公告？')) return
    setSending(true)
    try {
      const r = await broadcastNotification({ title: form.title.trim(), body: form.body || null, linkUrl: form.linkUrl || null })
      setLastSent(r.data?.sent ?? null)
      toast(`已发送给 ${r.data?.sent ?? '?'} 位用户`)
      setForm({ title: '', body: '', linkUrl: '' })
    } catch (e) { toast(e.response?.data || '发送失败', true) }
    finally { setSending(false) }
  }

  const inp = { width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box', outline: 'none', fontFamily: 'var(--sans)' }

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>发系统公告</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>公告会作为站内通知推送给所有启用用户，出现在他们的「🔔 通知」里。</p>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>标题 <span style={{ color: '#ef4444' }}>*</span></div>
        <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="例：五一活动上线" style={inp} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>内容</div>
        <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={4} placeholder="公告正文（可选）" style={{ ...inp, resize: 'vertical' }} />
      </div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>跳转链接</div>
        <input value={form.linkUrl} onChange={e => setForm(f => ({ ...f, linkUrl: e.target.value }))} placeholder="例：/courses（可选，点击通知后跳转）" style={inp} />
      </div>

      <button onClick={send} disabled={sending}
        style={{ padding: '12px 28px', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
        {sending ? '发送中…' : '📢 发送公告'}
      </button>
      {lastSent != null && <span style={{ marginLeft: 14, fontSize: 13, color: '#10b981' }}>已送达 {lastSent} 人</span>}
    </div>
  )
}
