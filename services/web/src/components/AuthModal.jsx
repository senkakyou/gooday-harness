// =====================================================
// components/AuthModal.jsx —— 登录 / 注册弹窗
// 职责：提供登录和注册两种表单，登录/注册成功后写入 authStore 并关闭弹窗
// 通过 initialMode prop 控制初始显示哪个表单
// =====================================================

import React, { useState, useRef } from 'react'
import { login, register, uploadAvatar } from '../api/auth'
import useAuthStore from '../store/authStore'
import useToastStore from '../store/toastStore'

export default function AuthModal({ initialMode = 'login', onClose }) {
  const [mode, setMode] = useState(initialMode)  // 'login' | 'register'
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  // 登录表单字段
  const [usernameOrEmail, setUsernameOrEmail] = useState('')
  const [password, setPassword] = useState('')

  // 注册表单字段（仅用户名+密码必填，邮箱/头像可选；电话地址移到个人资料补充）
  const [username, setUsername] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [avatarFile, setAvatarFile] = useState(null)    // 待上传的头像文件对象
  const [avatarPreview, setAvatarPreview] = useState(null)  // 头像本地预览 DataURL
  const fileRef = useRef()  // 隐藏的 file input，点击头像区域时触发

  const setAuth = useAuthStore(s => s.setAuth)
  const updateUser = useAuthStore(s => s.updateUser)
  const toast = useToastStore(s => s.toast)

  // 登录表单提交
  const handleLogin = async (e) => {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      const data = await login(usernameOrEmail, password)
      setAuth(data.token, {
        username: data.username, role: data.role,
        userId: data.userId, avatarUrl: data.avatarUrl
      })
      toast('登录成功')
      onClose()
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  // 注册表单提交
  const handleRegister = async (e) => {
    e.preventDefault()
    setErr('')
    if (regPassword.length < 6) { setErr('密码至少6位'); return }
    setLoading(true)
    try {
      const data = await register(
        username,
        regEmail || undefined,
        regPassword
      )
      setAuth(data.token, {
        username: data.username, role: data.role,
        userId: data.userId, avatarUrl: data.avatarUrl
      })
      // 如果选了头像，注册成功后立即上传（单独接口，失败不影响注册结果）
      if (avatarFile) {
        try {
          const av = await uploadAvatar(avatarFile)
          updateUser({ avatarUrl: av.avatarUrl })
        } catch {}
      }
      toast('注册成功')
      onClose()
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  // 用户选择头像文件后，用 FileReader 生成本地预览 DataURL
  const onAvatarChange = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setAvatarFile(f)
    const reader = new FileReader()
    reader.onload = (ev) => setAvatarPreview(ev.target.result)
    reader.readAsDataURL(f)
  }

  // 切换登录/注册时清空错误提示
  const switchMode = (m) => { setMode(m); setErr('') }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <button className="modal-close" onClick={onClose}>×</button>

        {mode === 'login' ? (
          <form onSubmit={handleLogin}>
            <h2><span className="accent-line" /> 登录</h2>
            <div className="dfg">
              <label>用户名或邮箱</label>
              <input
                type="text"
                placeholder="用户名 或 邮箱"
                value={usernameOrEmail}
                onChange={e => setUsernameOrEmail(e.target.value)}
                required
              />
            </div>
            <div className="dfg">
              <label>密码</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            {err && <div className="err">{err}</div>}
            <button className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={loading}>
              {loading ? '登录中...' : '登录'}
            </button>
            <div className="switch">还没有账号？<a onClick={() => switchMode('register')}>注册</a></div>
          </form>
        ) : (
          <form onSubmit={handleRegister}>
            <h2><span className="accent-line" /> 注册会员</h2>

            {/* 头像上传 */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
              <div
                onClick={() => fileRef.current?.click()}
                style={{
                  width: 72, height: 72, borderRadius: '50%',
                  border: '2px dashed var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', overflow: 'hidden', background: 'var(--surface2)',
                  position: 'relative',
                }}
              >
                {avatarPreview
                  ? <img src={avatarPreview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 24, color: 'var(--muted)' }}>+</span>
                }
              </div>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onAvatarChange} />
            </div>
            <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', marginBottom: '0.75rem', marginTop: '-0.5rem' }}>
              点击上传头像（可选）
            </div>

            <div className="dfg">
              <label>用户名 <span style={{ color: '#e55' }}>*</span></label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} required minLength={2} />
            </div>
            <div className="dfg">
              <label>密码 <span style={{ color: '#e55' }}>*</span></label>
              <input type="password" placeholder="至少6位" value={regPassword} onChange={e => setRegPassword(e.target.value)} required />
            </div>
            <div className="dfg">
              <label>邮箱 <span style={{ color: 'var(--muted)', fontSize: 11 }}>（可选）</span></label>
              <input type="email" placeholder="your@email.com" value={regEmail} onChange={e => setRegEmail(e.target.value)} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: '0.75rem', marginTop: '-0.25rem' }}>
              电话、地址可在注册后于「个人资料」中补充
            </div>

            {err && <div className="err">{err}</div>}
            <button className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={loading}>
              {loading ? '注册中...' : '注册'}
            </button>
            <div className="switch">已有账号？<a onClick={() => switchMode('login')}>登录</a></div>
          </form>
        )}
      </div>
    </div>
  )
}
