// pages/account/PwdTab.jsx —— 个人中心·修改密码 Tab
import React, { useState } from 'react'
import { changePassword } from '../../api/auth'
import useToastStore from '../../store/toastStore'

export default function PwdTab() {
  const toast = useToastStore(s => s.toast)
  const [f, setF] = useState({ old: '', nw: '', confirm: '' })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const handle = async (e) => {
    e.preventDefault()
    setErr('')
    if (f.nw.length < 6) { setErr('新密码至少6位'); return }
    if (f.nw !== f.confirm) { setErr('两次密码不一致'); return }
    setLoading(true)
    try {
      await changePassword(f.old, f.nw)
      toast('密码修改成功')
      setF({ old: '', nw: '', confirm: '' })
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  return (
    <form onSubmit={handle} style={{ maxWidth: 400 }}>
      {[
        ['当前密码', 'old'],
        ['新密码（至少6位）', 'nw'],
        ['确认新密码', 'confirm'],
      ].map(([label, key]) => (
        <div key={key} style={{ marginBottom: '0.85rem' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
          <input
            type="password"
            className="input"
            value={f[key]}
            onChange={e => setF(p => ({ ...p, [key]: e.target.value }))}
            required
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
        </div>
      ))}
      {err && <div style={{ color: '#e55', fontSize: 13, marginBottom: '0.75rem' }}>{err}</div>}
      <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
        {loading ? '保存中…' : '保存新密码'}
      </button>
    </form>
  )
}
