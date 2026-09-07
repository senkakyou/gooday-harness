// pages/account/ProfileTab.jsx —— 个人中心·个人资料 Tab
import React, { useEffect, useRef, useState } from 'react'
import { getProfile, updateProfile, uploadAvatar } from '../../api/auth'
import useAuthStore from '../../store/authStore'
import useToastStore from '../../store/toastStore'

export default function ProfileTab() {
  const toast = useToastStore(s => s.toast)
  const updateUser = useAuthStore(s => s.updateUser)
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState({ email: '', phone: '', address: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [avatarLoading, setAvatarLoading] = useState(false)
  const fileRef = useRef()

  useEffect(() => {
    getProfile().then(p => {
      setProfile(p)
      setForm({ email: p.email || '', phone: p.phone || '', address: p.address || '' })
    }).finally(() => setLoading(false))
  }, [])

  const save = async (e) => {
    e.preventDefault()
    setErr('')
    setSaving(true)
    try {
      const updated = await updateProfile(form)
      setProfile(p => ({ ...p, ...updated }))
      toast('资料已保存')
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const onAvatarChange = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setAvatarLoading(true)
    try {
      const res = await uploadAvatar(f)
      setProfile(p => ({ ...p, avatarUrl: res.avatarUrl }))
      updateUser({ avatarUrl: res.avatarUrl })
      toast('头像已更新')
    } catch (e) { toast(e.message || '上传失败', true) }
    finally { setAvatarLoading(false) }
  }

  if (loading) return <div style={{ color: 'var(--muted)' }}>加载中…</div>

  return (
    <div style={{ maxWidth: 420 }}>
      {/* 头像区 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <div
          onClick={() => fileRef.current?.click()}
          style={{
            width: 80, height: 80, borderRadius: '50%', cursor: 'pointer',
            border: '2px dashed var(--border)', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--surface2)', position: 'relative',
          }}
        >
          {profile?.avatarUrl
            ? <img src={profile.avatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontSize: 30, color: 'var(--muted)' }}>
                {(profile?.username || '?')[0].toUpperCase()}
              </span>
          }
          {avatarLoading && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff' }}>
              上传中
            </div>
          )}
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{profile?.username}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>点击头像更换</div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onAvatarChange} />
        </div>
      </div>

      <form onSubmit={save}>
        {[
          ['邮箱（可选）', 'email', 'email', 'your@email.com'],
          ['电话（可选）', 'phone', 'tel', '+86 138 0000 0000'],
          ['地址（可选）', 'address', 'text', '城市/地区'],
        ].map(([label, key, type, ph]) => (
          <div key={key} style={{ marginBottom: '0.85rem' }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
            <input
              type={type}
              className="input"
              placeholder={ph}
              value={form[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>
        ))}
        {err && <div style={{ color: '#e55', fontSize: 13, marginBottom: '0.75rem' }}>{err}</div>}
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={saving}>
          {saving ? '保存中…' : '保存资料'}
        </button>
      </form>
    </div>
  )
}
