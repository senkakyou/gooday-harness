// =====================================================
// pages/home/ModuleNav.jsx —— 首页模块导航网格（需求/论坛/课程/听书/游戏/二手）
// 从 Home.jsx 抽离的展示组件。按站长在后台设的显示开关过滤（GET /api/settings/modules）。
// =====================================================

import React, { useEffect, useState } from 'react'
import { MODULE_ITEMS } from './gachaAssets'
import { getModules } from '../../api/settings'

export default function ModuleNav({ navigate }) {
  const [modules, setModules] = useState(null)   // null=未加载(先全显示，避免闪烁)
  useEffect(() => {
    getModules().then(setModules).catch(() => setModules({}))   // 失败=全显示
  }, [])
  // 模块键 = path 去掉 '/'（/requests→requests）。开关明确为 false 才隐藏，其余显示。
  const items = MODULE_ITEMS.filter(m => {
    if (!modules) return true
    const key = m.path.replace('/', '')
    return modules[key] !== false
  })
  return (
    <div style={{ display: 'flex', gap: '0.5rem', padding: '0.875rem 0 0.25rem', overflow: 'auto', scrollbarWidth: 'none' }}>
      {items.map(m => (
        <div
          key={m.label}
          onClick={() => navigate(m.path)}
          style={{
            flex: 1, minWidth: 58,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: '0.75rem 0.25rem 0.7rem',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 18, cursor: 'pointer', transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(124,108,255,0.5)'; e.currentTarget.style.background='rgba(124,108,255,0.06)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--surface)' }}
        >
          <div style={{
            width: 42, height: 42, borderRadius: 13,
            background: m.iconBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, boxShadow: '0 3px 10px rgba(0,0,0,0.35)',
          }}>{m.icon}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>{m.label}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{m.sub}</div>
        </div>
      ))}
    </div>
  )
}
