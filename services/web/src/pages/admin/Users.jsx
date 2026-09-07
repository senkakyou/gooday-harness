// =====================================================
// pages/admin/Users.jsx —— 用户管理页
// 职责：查看所有注册用户，可启用/禁用账号（admin 账号不可操作）
// 路由：/admin/users
// =====================================================

import React, { useEffect, useState } from 'react'
import { listUsers, toggleUser } from '../../api/admin'
import useToastStore from '../../store/toastStore'

const AVATAR_COLORS = ['#6c63ff', '#e05299', '#3aa0ff', '#f59e0b', '#34d399', '#ef4444', '#8b5cf6', '#06b6d4']
const avatarColor = (name) => {
  let h = 0
  for (const c of (name || '?')) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export default function Users() {
  const toast = useToastStore(s => s.toast)
  const [users, setUsers] = useState([])

  const load = () => listUsers().then(setUsers).catch(() => {})
  useEffect(() => { load() }, [])

  const handleToggle = async (u) => {
    try {
      await toggleUser(u.id)
      toast('已更新')
      load()
    } catch (e) { toast(e.message, true) }
  }

  const total    = users.length
  const active   = users.filter(u => u.isActive).length
  const disabled = users.filter(u => !u.isActive).length
  const admins   = users.filter(u => u.role === 'admin').length

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h2 className="admin-page-title">用户管理</h2>
          <div className="admin-page-sub">管理平台注册用户</div>
        </div>
      </div>

      {/* 统计条 */}
      <div className="pg-stats">
        <div className="pg-stat-item">
          <div className="pg-stat-num">{total}</div>
          <div className="pg-stat-lbl">总用户</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--green)' }}>{active}</div>
          <div className="pg-stat-lbl">活跃</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: '#ff4757' }}>{disabled}</div>
          <div className="pg-stat-lbl">禁用</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--accent2)' }}>{admins}</div>
          <div className="pg-stat-lbl">管理员</div>
        </div>
      </div>

      {/* 用户列表 */}
      <div>
        {users.map(u => (
          <div key={u.id} className="user-row">
            <div className="user-avatar" style={{ background: avatarColor(u.username) }}>
              {(u.username || '?')[0].toUpperCase()}
            </div>
            <div className="user-info">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="user-name">{u.username}</span>
                <span className={`user-role-badge ${u.role === 'admin' ? 'user-role-admin' : 'user-role-user'}`}>
                  {u.role}
                </span>
                <span className={`dot ${u.isActive ? 'dot-g' : 'dot-r'}`} />
                <span style={{ fontSize: 11, color: u.isActive ? 'var(--green)' : '#ff4757' }}>
                  {u.isActive ? '正常' : '禁用'}
                </span>
              </div>
              <div className="user-email">{u.email}</div>
            </div>
            <div className="user-meta">{new Date(u.createdAt).toLocaleDateString('zh-CN')}</div>
            <div style={{ flexShrink: 0 }}>
              {u.role !== 'admin' ? (
                <button className="btn btn-ghost btn-sm" onClick={() => handleToggle(u)}>
                  {u.isActive ? '禁用' : '启用'}
                </button>
              ) : <span style={{ color: 'var(--muted)', fontSize: 13 }}>—</span>}
            </div>
          </div>
        ))}
        {users.length === 0 && <div className="chart-empty">暂无用户</div>}
      </div>
    </>
  )
}
