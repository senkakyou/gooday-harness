// pages/admin/AdminLayout.jsx —— 后台管理界面框架
import React from 'react'
import { NavLink, Outlet } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/admin',              label: '概览',   icon: '📊', end: true },
  { to: '/admin/tools',        label: '工具',   icon: '🔧' },
  { to: '/admin/users',        label: '用户',   icon: '👤' },
  { to: '/admin/tickets',      label: '订单',   icon: '🎫' },
  { to: '/admin/clients',      label: '客户',   icon: '🗂️' },
  { to: '/admin/finance',      label: '财务',   icon: '💰' },
  { to: '/admin/purchases',    label: '购买',   icon: '💰' },
  { to: '/admin/forum',        label: '论坛',   icon: '🗣️' },
  { to: '/admin/audiobooks',   label: '听书', icon: '🎧' },
  { to: '/admin/subjects',     label: '学科',   icon: '📚' },
  { to: '/admin/teachers',     label: '教师',   icon: '🎓' },
  { to: '/admin/announce',     label: '公告',   icon: '📢' },
  { to: '/admin/access-logs',  label: '访问',   icon: '👁️' },
  { to: '/admin/upload',       label: '上传',   icon: '📤' },
  { to: '/admin/files',        label: '文件',   icon: '🗂️' },
  { to: '/admin/settings',     label: '设置',   icon: '⚙️' },
]

export default function AdminLayout() {
  return (
    <div className="admin-shell">
      <div className="admin-topbar">
        <nav className="admin-topnav">
          {NAV_ITEMS.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} className="admin-topnav-link">
              <span className="admin-topnav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
      <main className="admin-content">
        <Outlet />
      </main>
    </div>
  )
}
