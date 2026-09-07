// =====================================================
// pages/secondhand/SecondhandCard.jsx —— 二手商品卡片（推荐网格项）
// 从 SecondhandHome.jsx 抽离的展示组件
// =====================================================

import React from 'react'
import { conditionColor, discountLabel } from './constants'
import NoImage from './NoImage'
import { isFavorite, toggleFavorite } from '../../api/secondhand'

function timeAgo(str) {
  const diff = (Date.now() - new Date(/(Z|[+-]\d\d:?\d\d)$/.test(str) ? str : str + 'Z')) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`
  return new Date(/(Z|[+-]\d\d:?\d\d)$/.test(str) ? str : str + 'Z').toLocaleDateString('zh-CN')
}

function tryParseImages(str) {
  try { return JSON.parse(str || '[]') } catch { return [] }
}

export default function SecondhandCard({ item, onClick }) {
  const imgs = tryParseImages(item.images)
  const [fav, setFav] = React.useState(isFavorite(item.id))
  const discount = discountLabel(item.price, item.originalPrice)
  const sold = item.status === 'sold'

  const onFav = (e) => {
    e.stopPropagation()
    setFav(toggleFavorite(item.id))
  }

  return (
    <div
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', transition: 'border-color .15s, transform .15s, box-shadow .15s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(124,108,255,.18)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}
      onClick={onClick}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: imgs.length ? 'var(--surface2)' : 'linear-gradient(135deg,#1a1630,#241b3d)' }}>
        {imgs.length > 0
          ? <img src={imgs[0]} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: sold ? 'grayscale(.7) brightness(.6)' : 'none' }} />
          : <NoImage size={44} />}
        {/* 收藏 */}
        <button onClick={onFav} title="收藏"
          style={{ position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'rgba(10,10,15,.55)', backdropFilter: 'blur(4px)', color: fav ? '#ff4d6d' : '#fff', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {fav ? '♥' : '♡'}
        </button>
        {/* 折扣角标 */}
        {discount && !sold && (
          <span style={{ position: 'absolute', top: 8, left: 8, background: 'linear-gradient(135deg,#ff6b35,#ff4d6d)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8 }}>{discount}</span>
        )}
        {sold && (
          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.35)', color: '#fff', fontSize: 18, fontWeight: 700, letterSpacing: 2 }}>已售出</span>
        )}
      </div>
      <div style={{ padding: '0.7rem 0.75rem 0.8rem' }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 7 }}>
          <span style={{ color: '#ff6b35', fontWeight: 800, fontSize: 17 }}>{item.price === 0 ? '免费' : `¥${item.price}`}</span>
          {item.originalPrice > item.price && (
            <span style={{ color: 'var(--muted)', fontSize: 12, textDecoration: 'line-through' }}>¥{item.originalPrice}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
          <span style={{ color: conditionColor[item.condition] || 'var(--muted)' }}>{item.condition}</span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60%' }}>{item.location || '未知地区'}</span>
        </div>
      </div>
    </div>
  )
}
