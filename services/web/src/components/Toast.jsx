// =====================================================
// components/Toast.jsx —— 全局消息提示条
// 职责：渲染 toastStore 里的所有消息，固定在右下角
// 不需要传 props，直接从 toastStore 读数据
// =====================================================

import React from 'react'
import useToastStore from '../store/toastStore'

export default function Toast() {
  // 订阅 toasts 列表，列表变化时自动重渲染
  const toasts = useToastStore(s => s.toasts)

  return (
    // 固定定位，永远在右下角，不随页面滚动
    <div style={{
      position: 'fixed', bottom: '1.25rem', right: '1.25rem',
      zIndex: 9999,                          // 确保在所有内容（包括弹窗）之上
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {/* 遍历渲染每一条 toast */}
      {toasts.map(t => (
        <div
          key={t.id}  // React 列表渲染必须有唯一 key
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            // 左边框颜色区分成功/失败：绿色 = 成功，红色 = 错误
            borderLeft: `3px solid ${t.isError ? 'var(--danger)' : 'var(--accent2)'}`,
            borderRadius: 4,
            padding: '9px 14px',
            fontFamily: 'var(--mono)',
            fontSize: 12,
            maxWidth: 280,
          }}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}
