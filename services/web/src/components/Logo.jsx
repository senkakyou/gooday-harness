// =====================================================
// components/Logo.jsx —— SVG 品牌 Logo
// 职责：纯展示组件，渲染一个六边形渐变 logo 图标
// 使用：<Logo />，在 Navbar 里引用
// =====================================================

import React from 'react'

export default function Logo({ className }) {
  return (
    // 整个 logo 是一个 SVG 矢量图（放大不失真）
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="36" height="36" className={className}>
      <defs>
        {/* 定义渐变色和发光滤镜，在下面的图形里通过 id 引用 */}
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#1a0a2e' }} />
          <stop offset="100%" style={{ stopColor: '#0d1f1a' }} />
        </linearGradient>
        <linearGradient id="hexGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#7c3aed' }} />  {/* 紫色 */}
          <stop offset="100%" style={{ stopColor: '#00c896' }} /> {/* 绿色 */}
        </linearGradient>
        <linearGradient id="innerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#a855f7' }} />
          <stop offset="100%" style={{ stopColor: '#10ffaa' }} />
        </linearGradient>
        <filter id="glow">  {/* 发光效果：模糊 + 叠加原图 */}
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="softGlow">  {/* 更柔和的发光 */}
          <feGaussianBlur stdDeviation="6" result="coloredBlur" />
          <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* 深色圆形背景 */}
      <circle cx="100" cy="100" r="96" fill="url(#bgGrad)" />

      {/* 外层六边形（带发光边框） */}
      <polygon points="100,18 168,58 168,138 100,178 32,138 32,58" fill="none" stroke="url(#hexGrad)" strokeWidth="2" opacity="0.5" filter="url(#softGlow)" />
      <polygon points="100,18 168,58 168,138 100,178 32,138 32,58" fill="none" stroke="url(#hexGrad)" strokeWidth="1.5" opacity="0.9" />

      {/* 内层六边形 */}
      <polygon points="100,38 150,66 150,122 100,150 50,122 50,66" fill="url(#bgGrad)" stroke="url(#innerGrad)" strokeWidth="1" opacity="0.6" />

      {/* 中心图标：像一个工具/扳手的抽象形状 */}
      <rect x="93" y="88" width="14" height="42" rx="4" fill="url(#innerGrad)" filter="url(#glow)" opacity="0.95" />
      <circle cx="100" cy="80" r="18" fill="none" stroke="url(#innerGrad)" strokeWidth="5" filter="url(#glow)" />
      <circle cx="100" cy="80" r="9" fill="url(#bgGrad)" />

      {/* 装饰性线条（像光芒/火花） */}
      <line x1="122" y1="58" x2="130" y2="50" stroke="#10ffaa" strokeWidth="2" strokeLinecap="round" filter="url(#glow)" opacity="0.8" />
      <line x1="128" y1="64" x2="138" y2="62" stroke="#10ffaa" strokeWidth="1.5" strokeLinecap="round" filter="url(#glow)" opacity="0.6" />
      <line x1="124" y1="70" x2="132" y2="72" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" filter="url(#glow)" opacity="0.6" />
      <line x1="78" y1="58" x2="70" y2="50" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" filter="url(#glow)" opacity="0.8" />
      <line x1="72" y1="64" x2="62" y2="62" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" filter="url(#glow)" opacity="0.6" />

      {/* 六边形顶点上的小圆点装饰 */}
      <circle cx="100" cy="20" r="2.5" fill="#10ffaa" filter="url(#glow)" opacity="0.9" />
      <circle cx="166" cy="59" r="2" fill="#7c3aed" filter="url(#glow)" opacity="0.8" />
      <circle cx="166" cy="139" r="2" fill="#10ffaa" filter="url(#glow)" opacity="0.7" />
      <circle cx="100" cy="178" r="2.5" fill="#7c3aed" filter="url(#glow)" opacity="0.9" />
      <circle cx="34" cy="139" r="2" fill="#10ffaa" filter="url(#glow)" opacity="0.7" />
      <circle cx="34" cy="59" r="2" fill="#7c3aed" filter="url(#glow)" opacity="0.8" />
    </svg>
  )
}
