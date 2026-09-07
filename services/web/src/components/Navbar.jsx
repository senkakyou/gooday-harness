// =====================================================
// components/Navbar.jsx —— 顶部导航栏
// 职责：展示 Logo 和品牌名；已登录时显示私信铃铛和用户下拉菜单；未登录时显示登录按钮
// =====================================================

import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Logo from './Logo'
import AuthModal from './AuthModal'
import useAuthStore from '../store/authStore'
import { getUnreadCount } from '../api/messages'
import { notifUnreadCount } from '../api/notifications'

export default function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const [authModal, setAuthModal] = useState(null)  // null | 'login' | 'register'
  const [unread, setUnread] = useState(0)          // 未读私信数（✉ 红点）
  const [notif, setNotif] = useState(0)            // 未读通知数（🔔 红点）
  const [dropOpen, setDropOpen] = useState(false)    // 用户下拉菜单是否展开
  const dropRef = useRef(null)                        // 用于检测点击是否在下拉外部

  // 轮询未读消息数：登录时每30秒拉一次，退出登录时清零
  // 在私信页（/messages）由 SignalR 实时更新未读，无需轮询，仅进入时拉一次
  useEffect(() => {
    if (!user) { setUnread(0); setNotif(0); return }
    const load = () => {
    getUnreadCount().then(d => setUnread(d.count)).catch(() => {})
    notifUnreadCount().then(d => setNotif(d.count)).catch(() => {})
  }
    load()
    if (location.pathname === '/messages') return
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [user, location.pathname])

  // 点击下拉菜单外部时关闭菜单（全局 mousedown 事件代理）
  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const isMobileMessages = location.pathname === '/messages' && window.innerWidth < 640

  if (isMobileMessages) return null

  return (
    <>
      <nav className="main-nav" style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(10,10,15,.95)', backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
        height: 56,
      }}>
        {/* 左侧：Logo + 标题 */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }}
          onClick={() => navigate('/')}
        >
          <Logo className="nav-logo-svg" />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2, color: 'var(--text)' }}>Gooday</div>
            <div className="nav-sub" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.5px' }}>发现·学习·创造</div>
          </div>
        </div>

        {/* 右侧 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {user ? (
            <>
              {/* 通知铃铛 */}
              <button
                className="btn btn-ghost btn-sm"
                style={{ position: 'relative', padding: '5px 9px', fontSize: 15 }}
                onClick={() => navigate('/notifications')}
                title="通知"
              >
                🔔
                {notif > 0 && (
                  <span style={{
                    position: 'absolute', top: -3, right: -3,
                    background: '#e55', color: '#fff',
                    borderRadius: '50%', width: 16, height: 16,
                    fontSize: 9, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{notif > 9 ? '9+' : notif}</span>
                )}
              </button>

              {/* 私信 */}
              <button
                className="btn btn-ghost btn-sm"
                style={{ position: 'relative', padding: '5px 9px', fontSize: 15 }}
                onClick={() => navigate('/messages')}
                title="私信"
              >
                💬
                {unread > 0 && (
                  <span style={{
                    position: 'absolute', top: -3, right: -3,
                    background: '#e55', color: '#fff',
                    borderRadius: '50%', width: 16, height: 16,
                    fontSize: 9, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{unread > 9 ? '9+' : unread}</span>
                )}
              </button>

              {/* 用户下拉 */}
              <div ref={dropRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setDropOpen(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                    background: 'none', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                    color: 'var(--text)', fontSize: 12, fontFamily: 'var(--mono)',
                  }}
                >
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%',
                      background: 'var(--accent)', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, flexShrink: 0,
                    }}>{user.username[0].toUpperCase()}</div>
                  )}
                  <span className="nav-username">{user.username}</span>
                  <span style={{ fontSize: 9, color: 'var(--muted)' }}>▼</span>
                </button>

                {dropOpen && (
                  <div style={{
                    position: 'absolute', right: 0, top: 'calc(100% + 6px)',
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 8, minWidth: 140,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    zIndex: 200, overflow: 'hidden',
                  }}>
                    <button className="nav-drop-item" onClick={() => { navigate('/account'); setDropOpen(false) }}>👤 个人中心</button>
                    <button className="nav-drop-item" onClick={() => { navigate('/messages'); setDropOpen(false) }}>💬 私信</button>
                    {user.role === 'admin' && (
                      <button className="nav-drop-item" onClick={() => { navigate('/admin'); setDropOpen(false) }}>🔧 后台</button>
                    )}
                    <div style={{ borderTop: '1px solid var(--border)' }} />
                    <button className="nav-drop-item" style={{ color: '#e55' }} onClick={() => { logout(); setDropOpen(false) }}>退出登录</button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <button
              className="btn btn-primary"
              style={{ gap: 5, padding: '7px 15px', fontSize: 13, whiteSpace: 'nowrap' }}
              onClick={() => setAuthModal('login')}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>👤</span>登录 / 注册
            </button>
          )}
        </div>
      </nav>

      {authModal && (
        <AuthModal initialMode={authModal} onClose={() => setAuthModal(null)} />
      )}
    </>
  )
}
