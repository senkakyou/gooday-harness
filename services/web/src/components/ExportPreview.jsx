import React from 'react'
import { downloadDataUrl } from '../utils/exportNode'

// 导出图片预览浮层：手机长按可保存到相册，桌面点「下载」兜底。
// zIndex 必须高于底部 Tab 栏（.bottom-tab-bar = 200），否则下方按钮会被底栏遮挡（论坛#51）。
// 底部留出移动端安全区，避免「下载/关闭」被 home 指示条盖住。
export default function ExportPreview({ url, filename, alt = '预览', onClose }) {
  if (!url) return null
  return (
    <div onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.85)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '1rem 1rem calc(1rem + env(safe-area-inset-bottom, 0px))',
      }}>
      <div style={{ color: '#fff', fontSize: 13, marginBottom: 10, fontWeight: 600 }}>长按图片保存到相册</div>
      <img src={url} alt={alt} onClick={e => e.stopPropagation()}
        style={{ maxWidth: '100%', maxHeight: '72vh', borderRadius: 10, background: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }} />
      <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
        <button onClick={(e) => { e.stopPropagation(); downloadDataUrl(url, filename) }}
          style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>下载</button>
        <button onClick={onClose}
          style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.4)', background: 'transparent', color: '#fff', fontSize: 14, cursor: 'pointer' }}>关闭</button>
      </div>
    </div>
  )
}
