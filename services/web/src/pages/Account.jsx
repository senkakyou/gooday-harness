// =====================================================
// pages/Account.jsx —— 个人中心页
// 路由：/account
// 职责：分 Tab 展示个人资料、修改密码、我的购买、我的需求四个功能模块
// 只有登录用户才能访问（未登录时跳转首页）
// =====================================================

import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../store/authStore'
import ProfileTab from './account/ProfileTab'
import PwdTab from './account/PwdTab'
import PurchasesTab from './account/PurchasesTab'

const TABS = [
  { key: 'profile',  label: '个人资料' },
  { key: 'pwd',      label: '修改密码' },
  { key: 'purchase', label: '我的购买' },
]

export default function Account() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [tab, setTab] = useState('profile')

  useEffect(() => {
    if (!user) navigate('/', { replace: true })
  }, [user])

  if (!user) return null

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '2rem 1rem' }}>
      {/* 头部 */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>我的账户</h1>
        <p style={{ margin: '0.3rem 0 0', color: 'var(--muted)', fontSize: 13 }}>
          {user.username}
        </p>
      </div>

      {/* qianky 专属工具入口 */}
      {user.username === 'qianky' && (
        <div style={{
          marginBottom: '1.5rem',
          padding: '1rem 1.25rem',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>每日食品安全检查记录</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>记录数据云端保存，可随时查询历史台账</div>
          </div>
          <button
            className="btn btn-primary btn-sm"
            style={{ flexShrink: 0 }}
            onClick={() => window.open('/qianky', '_blank')}
          >
            打开
          </button>
        </div>
      )}

      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '0.6rem 1rem', fontSize: 14, fontFamily: 'inherit',
              color: tab === t.key ? 'var(--text)' : 'var(--muted)',
              borderBottom: `2px solid ${tab === t.key ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1,
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Tab 内容 */}
      {tab === 'profile'  && <ProfileTab />}
      {tab === 'pwd'      && <PwdTab />}
      {tab === 'purchase' && <PurchasesTab />}
    </div>
  )
}
