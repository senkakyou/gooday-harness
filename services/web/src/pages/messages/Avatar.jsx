// 通用头像组件：有 avatarUrl 时显示图片，否则显示用户名首字母
import React from 'react'

export default function Avatar({ url, name, size = 36 }) {
  if (url) return <img src={url} draggable={false} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, WebkitUserDrag: 'none' }} alt="" />
  const ch = (name || '?')[0].toUpperCase()
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'var(--accent)', color: '#fff', fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.45,
    }}>{ch}</div>
  )
}
