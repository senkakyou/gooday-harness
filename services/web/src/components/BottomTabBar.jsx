// =====================================================
// components/BottomTabBar.jsx —— 移动端底部 Tab 导航栏
// 职责：在小屏幕上显示固定在底部的四个快捷导航按钮
// 在后台页面 (/admin) 和游戏对局页面不显示
// =====================================================

import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

// 各 Tab 对应的 SVG 图标（active 时填充实色）
function HomeIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L11 3l8 6.5"/>
      <path d="M5 9v9a1 1 0 001 1h3.5v-4h3v4H16a1 1 0 001-1V9" fill={active ? 'currentColor' : 'none'} strokeWidth="0"/>
      <path d="M5 9v9a1 1 0 001 1h3.5v-4h3v4H16a1 1 0 001-1V9"/>
    </svg>
  )
}

function GridIcon({ active }) {
  const opacity = active ? 1 : 0.8
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor" opacity={opacity}>
      <rect x="2"    y="2"    width="8" height="8" rx="2"/>
      <rect x="12"   y="2"    width="8" height="8" rx="2"/>
      <rect x="2"    y="12"   width="8" height="8" rx="2"/>
      <rect x="12"   y="12"   width="8" height="8" rx="2"/>
    </svg>
  )
}

function StarIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M11 2l2.5 5.3 5.8.8-4.2 4.1 1 5.8L11 15.3l-5.1 2.7 1-5.8L2.7 8.1l5.8-.8z"/>
    </svg>
  )
}

function PersonIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="11" cy="7.5" r="3.5" fill={active ? 'currentColor' : 'none'}/>
      <path d="M3.5 19c0-4.1 3.4-7.5 7.5-7.5s7.5 3.4 7.5 7.5"/>
    </svg>
  )
}

// Tab 配置：label=显示文字，Icon=图标组件，path=目标路由，scroll=是否滚动到工具区
const TABS = [
  { label: '首页',  Icon: HomeIcon,   path: '/',        scroll: false },
  { label: '工具库', Icon: GridIcon,   path: '/',        scroll: true  },
  { label: '收藏',  Icon: StarIcon,   path: '/favorites', scroll: false },
  { label: '我的',  Icon: PersonIcon, path: '/account', scroll: false },
]

export default function BottomTabBar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // 后台页面和游戏对局页面不显示底栏（避免遮挡）
  if (pathname.startsWith('/admin') || /^\/games\/(gomoku|chess)/.test(pathname)) return null

  // 计算当前高亮的 Tab 索引（-1 表示无高亮）
  const activeIdx =
    pathname === '/' ? 0 :
    pathname.startsWith('/favorites') ? 2 :
    pathname.startsWith('/account') || pathname.startsWith('/messages') ? 3 : -1

  const handleTab = (tab, i) => {
    if (tab.scroll) {
      // 「工具库」Tab：如果不在首页先跳首页，然后平滑滚动到工具列表区域
      if (pathname !== '/') {
        navigate('/')
        setTimeout(() => document.getElementById('tools-section')?.scrollIntoView({ behavior: 'smooth' }), 250)
      } else {
        document.getElementById('tools-section')?.scrollIntoView({ behavior: 'smooth' })
      }
    } else {
      navigate(tab.path)
    }
  }

  return (
    <nav className="bottom-tab-bar">
      {TABS.map((tab, i) => {
        const active = activeIdx === i
        return (
          <button
            key={i}
            onClick={() => handleTab(tab, i)}
            style={{
              flex: 1,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 3,
              background: 'none', border: 'none',
              color: active ? 'var(--accent)' : 'var(--muted)',
              cursor: 'pointer',
              padding: '5px 0 2px',
            }}
          >
            <tab.Icon active={active} />
            <span style={{ fontSize: 10, fontFamily: 'var(--sans)', fontWeight: active ? 600 : 400, lineHeight: 1 }}>
              {tab.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
