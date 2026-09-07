// =====================================================
// pages/secondhand/SecondhandDetail.jsx —— 二手物品详情页
// 路由：/secondhand/:id
// 职责：展示单个闲置物品的完整信息，卖家可标记已售出或删除
// =====================================================

import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getItem, markSold, deleteItem, isFavorite, toggleFavorite } from '../../api/secondhand'
import useAuthStore from '../../store/authStore'
import useToastStore from '../../store/toastStore'
import { confirmDialog } from '../../store/confirmStore'
import NoImage from './NoImage'
import { discountLabel } from './constants'

function tryParseImages(str) {
  try { return JSON.parse(str || '[]') } catch { return [] }
}

function timeAgo(str) {
  const diff = (Date.now() - new Date(/(Z|[+-]\d\d:?\d\d)$/.test(str) ? str : str + 'Z')) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`
  return new Date(/(Z|[+-]\d\d:?\d\d)$/.test(str) ? str : str + 'Z').toLocaleDateString('zh-CN')
}

const conditionBadge = {
  '全新': { bg: '#10b981', label: '全新' },
  '几乎全新': { bg: '#00d4aa', label: '9成新' },
  '轻微使用': { bg: '#ffa502', label: '7-8成新' },
  '明显使用': { bg: '#ff4757', label: '5-6成新' }
}

export default function SecondhandDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const toast = useToastStore(s => s.toast)

  const [item, setItem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeImg, setActiveImg] = useState(0)
  const [fav, setFav] = useState(() => isFavorite(Number(id)))

  useEffect(() => {
    getItem(id)
      .then(r => setItem(r.data))
      .catch(() => toast('商品不存在', true))
      .finally(() => setLoading(false))
  }, [id])

  const handleContact = () => {
    if (!user) return toast('请先登录后联系卖家', true)
    navigate(`/messages?with=${item.seller.id}`)
  }

  const handleSold = async () => {
    if (!await confirmDialog('确认将此商品标记为已售？')) return
    await markSold(id)
    toast('已标记为已售')
    setItem(i => ({ ...i, status: 'sold' }))
  }

  const handleDelete = async () => {
    if (!await confirmDialog('确认删除此商品？', { danger: true, confirmText: '删除' })) return
    await deleteItem(id)
    toast('已删除')
    navigate('/secondhand')
  }

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>加载中…</div>
  if (!item) return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>商品不存在</div>

  const imgs = tryParseImages(item.images)
  const badge = conditionBadge[item.condition] || { bg: 'var(--muted)', label: item.condition }
  const isOwner = user && user.userId === item.seller.id
  const isAdmin = user?.role === 'admin'

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1rem' }}>
      {/* 面包屑 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 13, color: 'var(--muted)', marginBottom: '1.5rem' }}>
        <span style={{ cursor: 'pointer' }} onClick={() => navigate('/secondhand')}>二手交易</span>
        <span>/</span>
        <span style={{ color: 'var(--text)' }}>{item.title}</span>
      </div>

      <div className="sh-detail-grid">
        {/* 左：图片 */}
        <div>
          <div style={{ aspectRatio: '4/3', background: 'var(--surface2)', borderRadius: 10, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.75rem' }}>
            {imgs.length > 0
              ? <img src={imgs[activeImg]} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              : <NoImage size={72} />}
          </div>
          {imgs.length > 1 && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {imgs.map((u, i) => (
                <img key={i} src={u} onClick={() => setActiveImg(i)}
                  style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: `2px solid ${i === activeImg ? 'var(--accent)' : 'var(--border)'}` }} />
              ))}
            </div>
          )}
        </div>

        {/* 右：信息 */}
        <div>
          {item.status === 'sold' && (
            <div style={{ background: '#ff475720', border: '1px solid #ff4757', borderRadius: 6, padding: '0.5rem 1rem', marginBottom: '1rem', color: '#ff4757', fontSize: 14 }}>
              此商品已售出
            </div>
          )}

          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: '0.75rem' }}>{item.title}</h1>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: '1rem' }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: '#ff6b35' }}>
              {item.price === 0 ? '免费' : `¥ ${item.price}`}
            </span>
            {item.originalPrice > item.price && (
              <>
                <span style={{ color: 'var(--muted)', fontSize: 16, textDecoration: 'line-through' }}>¥{item.originalPrice}</span>
                {discountLabel(item.price, item.originalPrice) && (
                  <span style={{ background: 'linear-gradient(135deg,#ff6b35,#ff4d6d)', color: '#fff', fontSize: 13, fontWeight: 700, padding: '2px 10px', borderRadius: 8 }}>{discountLabel(item.price, item.originalPrice)}</span>
                )}
              </>
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
            <span style={{ background: badge.bg + '20', color: badge.bg, border: `1px solid ${badge.bg}`, borderRadius: 4, padding: '2px 10px', fontSize: 12 }}>{badge.label}</span>
            <span style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 10px', fontSize: 12 }}>{item.category}</span>
          </div>

          <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 2 }}>
            <div>📍 {item.location || '未知地区'}</div>
            <div>👁 {item.viewCount} 次浏览</div>
            <div>🕐 发布于 {timeAgo(item.createdAt)}</div>
            <div>👤 卖家：{item.seller.username}</div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '1rem' }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: '0.5rem' }}>商品描述</div>
            <div style={{ fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{item.description || '卖家暂未填写描述'}</div>
          </div>

          {/* 买家操作 */}
          {!isOwner && item.status === 'available' && (
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button className="btn btn-primary" style={{ flex: 1, whiteSpace: 'nowrap' }} onClick={handleContact}>联系卖家</button>
              <button className="btn btn-ghost" onClick={() => setFav(toggleFavorite(Number(id)))}>{fav ? '♥ 已收藏' : '♡ 收藏'}</button>
            </div>
          )}

          {/* 卖家/管理员操作 */}
          {(isOwner || isAdmin) && item.status === 'available' && (
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button className="btn btn-primary" onClick={handleSold}>标记已售</button>
              <button className="btn btn-danger" onClick={handleDelete}>删除商品</button>
            </div>
          )}
          {(isOwner || isAdmin) && item.status === 'sold' && (
            <div style={{ marginTop: '1.5rem' }}>
              <button className="btn btn-danger" onClick={handleDelete}>删除商品</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
