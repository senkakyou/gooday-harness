// =====================================================
// components/ConfirmDialog.jsx —— 全局确认弹窗渲染组件
// 挂载在 App.jsx 顶层，监听 confirmStore，弹出统一风格的确认框
// Enter=确定，Esc=取消，点遮罩=取消
// =====================================================

import React, { useEffect } from 'react'
import useConfirmStore from '../store/confirmStore'

export default function ConfirmDialog() {
  const state = useConfirmStore(s => s.state)
  const close = useConfirmStore(s => s.close)

  useEffect(() => {
    if (!state) return
    const onKey = (e) => {
      if (e.key === 'Escape') close(false)
      else if (e.key === 'Enter') close(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [state, close])

  if (!state) return null

  return (
    <div className="modal-overlay" style={{ zIndex: 1300 }} onClick={e => e.target === e.currentTarget && close(false)}>
      <div className="modal" style={{ maxWidth: 360 }}>
        {state.title && (
          <h2 style={{ margin: '0 0 0.75rem', fontSize: 16, fontWeight: 700 }}>{state.title}</h2>
        )}
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
          {state.message}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => close(false)}>{state.cancelText}</button>
          <button
            className="btn btn-primary btn-sm"
            style={state.danger ? { background: '#e55', borderColor: '#e55', color: '#fff' } : undefined}
            onClick={() => close(true)}
            autoFocus
          >{state.confirmText}</button>
        </div>
      </div>
    </div>
  )
}
