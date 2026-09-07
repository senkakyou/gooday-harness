// 二手商品无图占位：中性的「图片」线性图标，替代显眼的 emoji（📦/📱…）
// 贴合深色主题，低调不抢眼
import React from 'react'

export default function NoImage({ size = 56 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="var(--muted)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      style={{ opacity: 0.5 }}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.7" />
      <path d="M21 14.5l-4.5-4.5L5.5 21" />
    </svg>
  )
}
