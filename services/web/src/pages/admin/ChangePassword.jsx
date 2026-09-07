// =====================================================
// pages/admin/ChangePassword.jsx —— 修改密码页
// 职责：管理员修改自己的登录密码
// 路由：/admin/password
// =====================================================

import React, { useState } from 'react'
import { changePassword } from '../../api/auth'
import useToastStore from '../../store/toastStore'

export default function ChangePassword() {
  const toast = useToastStore(s => s.toast)
  const [oldPw, setOldPw] = useState('')      // 当前密码
  const [newPw, setNewPw] = useState('')      // 新密码
  const [confirmPw, setConfirmPw] = useState('') // 确认新密码
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSave = async (e) => {
    e.preventDefault()
    setErr('')
    // 前端先做基本校验，不用等后端返回
    if (newPw.length < 6) { setErr('新密码至少6位'); return }
    if (newPw !== confirmPw) { setErr('两次密码不一致'); return }
    setLoading(true)
    try {
      await changePassword(oldPw, newPw)
      toast('密码修改成功')
      // 清空所有输入框
      setOldPw(''); setNewPw(''); setConfirmPw('')
    } catch (e) {
      setErr(e.message)  // 如：当前密码错误
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <h2 style={{ fontFamily: 'var(--mono)', fontSize: '0.9rem', marginBottom: '1.25rem', paddingBottom: '0.6rem', borderBottom: '1px solid var(--border)' }}>修改密码</h2>
      <form onSubmit={handleSave} style={{ maxWidth: 400, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '1.5rem' }}>
        <div className="dfg"><label>当前密码</label><input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)} required /></div>
        <div className="dfg"><label>新密码</label><input type="password" placeholder="至少6位" value={newPw} onChange={e => setNewPw(e.target.value)} required /></div>
        <div className="dfg"><label>确认新密码</label><input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required /></div>
        {err && <div className="err">{err}</div>}
        <button className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={loading}>
          {loading ? '保存中...' : '保存新密码'}
        </button>
      </form>
    </>
  )
}
