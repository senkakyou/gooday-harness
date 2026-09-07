// =====================================================
// pages/secondhand/SecondhandHome.jsx —— 二手交易首页
// 路由：/secondhand
// 职责：英雄横幅 + 搜索/筛选 + 分类导航 + 精选大卡 + 推荐网格；发布新物品
// =====================================================

import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { listItems, createItem, uploadImage, isFavorite, toggleFavorite } from '../../api/secondhand'
import useAuthStore from '../../store/authStore'
import useToastStore from '../../store/toastStore'
import { CATEGORIES, CATEGORY_ICONS, CONDITIONS, SORTS, conditionColor, discountLabel } from './constants'
import NoImage from './NoImage'
import SecondhandCard from './SecondhandCard'
import PublishForm from './PublishForm'

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

// ---- 精选大卡 ----
function FeaturedCard({ item, user, onOpen, onContact, onBuy }) {
  const imgs = tryParseImages(item.images)
  const [active, setActive] = useState(0)
  const [fav, setFav] = useState(isFavorite(item.id))
  const discount = discountLabel(item.price, item.originalPrice)
  const isOwner = user && user.userId === item.seller.id
  const sold = item.status === 'sold'

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '1.25rem', marginBottom: '2rem', boxShadow: '0 10px 40px rgba(124,108,255,.10)' }}>
      {/* 图片区 */}
      <div style={{ flex: '1 1 320px', minWidth: 280 }}>
        <div onClick={onOpen} style={{ position: 'relative', aspectRatio: '4/3', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: imgs.length ? 'var(--surface2)' : 'linear-gradient(135deg,#1a1630,#2a1f4d)' }}>
          {imgs.length > 0
            ? <img src={imgs[active]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <NoImage size={76} />}
          <button onClick={e => { e.stopPropagation(); setFav(toggleFavorite(item.id)) }} title="收藏"
            style={{ position: 'absolute', top: 12, right: 12, width: 38, height: 38, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'rgba(10,10,15,.55)', backdropFilter: 'blur(4px)', color: fav ? '#ff4d6d' : '#fff', fontSize: 19 }}>
            {fav ? '♥' : '♡'}
          </button>
          {discount && !sold && (
            <span style={{ position: 'absolute', top: 12, left: 12, background: 'linear-gradient(135deg,#ff6b35,#ff4d6d)', color: '#fff', fontSize: 13, fontWeight: 700, padding: '3px 11px', borderRadius: 10 }}>{discount}</span>
          )}
          {sold && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.4)', color: '#fff', fontSize: 26, fontWeight: 700, letterSpacing: 3 }}>已售出</span>}
        </div>
        {imgs.length > 1 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {imgs.slice(0, 5).map((u, i) => (
              <img key={i} src={u} onClick={() => setActive(i)}
                style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, cursor: 'pointer', border: `2px solid ${i === active ? 'var(--accent)' : 'transparent'}` }} />
            ))}
          </div>
        )}
      </div>

      {/* 信息区 */}
      <div style={{ flex: '1 1 320px', minWidth: 280, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', background: 'rgba(124,108,255,.12)', border: '1px solid rgba(124,108,255,.35)', padding: '2px 10px', borderRadius: 20 }}>✦ 精选</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{item.category}</span>
        </div>
        <h2 onClick={onOpen} style={{ margin: 0, fontSize: 20, fontWeight: 700, cursor: 'pointer', lineHeight: 1.4 }}>{item.title}</h2>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '0.9rem 0' }}>
          <span style={{ color: '#ff6b35', fontWeight: 800, fontSize: 30 }}>{item.price === 0 ? '免费' : `¥${item.price}`}</span>
          {item.originalPrice > item.price && (
            <span style={{ color: 'var(--muted)', fontSize: 15, textDecoration: 'line-through' }}>¥{item.originalPrice}</span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: conditionColor[item.condition] || 'var(--muted)', border: `1px solid ${conditionColor[item.condition] || 'var(--border)'}`, borderRadius: 6, padding: '2px 9px' }}>{item.condition}</span>
        </div>

        {item.description && (
          <p style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.7, margin: '0 0 1rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.description}</p>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12.5, color: 'var(--muted)', marginBottom: '1rem' }}>
          <span>📍 {item.location || '未知地区'}</span>
          <span>🕐 {timeAgo(item.createdAt)}</span>
          <span>👁 {item.viewCount}</span>
          <span>👤 {item.seller.username}</span>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 'auto', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" style={{ flex: '1 1 auto' }} onClick={() => onContact(item)} disabled={isOwner}>
            {isOwner ? '我的发布' : '联系卖家'}
          </button>
          <button className="btn btn-ghost" style={{ flex: '0 0 auto' }} onClick={e => { e.stopPropagation(); setFav(toggleFavorite(item.id)) }}>
            {fav ? '♥ 已收藏' : '♡ 收藏'}
          </button>
          <button className="btn btn-primary" style={{ flex: '1 1 auto' }} onClick={() => onBuy(item)} disabled={sold}>
            {sold ? '已售出' : '立即购买'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SecondhandHome() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const toast = useToastStore(s => s.toast)

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('全部')
  const [condition, setCondition] = useState('全部')
  const [sort, setSort] = useState('new')
  const [keyword, setKeyword] = useState('')
  const [showFilter, setShowFilter] = useState(false)
  const [shuffleKey, setShuffleKey] = useState(0)
  const searchTimer = useRef(null)

  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [form, setForm] = useState({
    title: '', description: '', price: '', originalPrice: '', category: '数码',
    condition: '几乎全新', location: '', images: '[]'
  })
  const [previewUrls, setPreviewUrls] = useState([])

  const load = (cat = category, cond = condition, srt = sort, kw = keyword) => {
    setLoading(true)
    listItems({ page: 1, pageSize: 50, category: cat === '全部' ? '' : cat, condition: cond === '全部' ? '' : cond, sort: srt, keyword: kw, status: 'available' })
      .then(r => setItems(r.data.items))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(category, condition, sort) }, [category, condition, sort])

  const onKeywordChange = (kw) => {
    setKeyword(kw)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => load(category, condition, sort, kw), 400)
  }
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current) }, [])

  const handleSearch = (e) => { e.preventDefault(); if (searchTimer.current) clearTimeout(searchTimer.current); load() }

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploading(true)
    try {
      const urls = []
      for (const f of files) { const r = await uploadImage(f); urls.push(r.data.url) }
      const merged = [...JSON.parse(form.images || '[]'), ...urls]
      setForm(f => ({ ...f, images: JSON.stringify(merged) }))
      setPreviewUrls(p => [...p, ...urls])
    } catch { toast('上传失败', true) } finally { setUploading(false) }
  }

  const removeImage = (url) => {
    setForm(f => ({ ...f, images: JSON.stringify(JSON.parse(f.images).filter(u => u !== url)) }))
    setPreviewUrls(p => p.filter(u => u !== url))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return toast('请填写标题', true)
    if (!form.price || isNaN(form.price) || Number(form.price) < 0) return toast('请填写正确价格', true)
    setSubmitting(true)
    try {
      await createItem({
        title: form.title, description: form.description,
        price: Number(form.price),
        originalPrice: form.originalPrice ? Number(form.originalPrice) : null,
        images: form.images, category: form.category, condition: form.condition, location: form.location
      })
      toast('发布成功！')
      setShowForm(false)
      setForm({ title: '', description: '', price: '', originalPrice: '', category: '数码', condition: '几乎全新', location: '', images: '[]' })
      setPreviewUrls([])
      load()
    } catch (err) {
      toast(err.response?.data?.message || err.message || '发布失败', true)
    } finally { setSubmitting(false) }
  }

  const handleContact = (item) => {
    if (!user) return toast('请先登录后联系卖家', true)
    if (user.userId === item.seller.id) return
    navigate(`/messages?with=${item.seller.id}`)
  }
  const handleBuy = (item) => navigate(`/secondhand/${item.id}`)

  const featured = items[0]
  const rest = items.slice(1)
  const shuffled = React.useMemo(() => {
    const a = [...rest]
    if (shuffleKey > 0) for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }
    return a
  }, [items, shuffleKey])

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>
      {/* 英雄横幅 */}
      <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 18, padding: '1.6rem 1.5rem', marginBottom: '1.25rem', background: 'linear-gradient(120deg,#1b1538 0%,#241a47 45%,#15131f 100%)', border: '1px solid var(--border)' }}>
        <div style={{ position: 'absolute', top: -60, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(124,108,255,.35),transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', position: 'relative' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, background: 'linear-gradient(90deg,#fff,#b8a9ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>🏷 二手交易</h1>
            <p style={{ margin: '0.5rem 0 0', color: '#b8b0d8', fontSize: 13.5 }}>淘好物、卖闲置，让物品找到新主人</p>
          </div>
          {user && (
            <button className="btn btn-primary" onClick={() => setShowForm(v => !v)} style={{ fontWeight: 600 }}>
              {showForm ? '取消' : '+ 发布闲置'}
            </button>
          )}
        </div>
      </div>

      {/* 发布表单 */}
      {showForm && (
        <PublishForm
          form={form} setForm={setForm} previewUrls={previewUrls}
          uploading={uploading} submitting={submitting}
          onUpload={handleUpload} onRemoveImage={removeImage} onSubmit={handleSubmit}
        />
      )}

      {/* 搜索 + 筛选 */}
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10, marginBottom: '0.85rem' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '0 12px' }}>
          <span style={{ color: 'var(--muted)' }}>🔍</span>
          <input value={keyword} onChange={e => onKeywordChange(e.target.value)} placeholder="搜索商品、标签、品牌…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 16, padding: '10px 0' }} />
        </div>
        <button type="submit" className="btn btn-primary">搜索</button>
        <button type="button" className={`btn ${showFilter ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowFilter(v => !v)}>⚙ 筛选</button>
      </form>

      {/* 筛选面板 */}
      {showFilter && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '0.9rem 1rem', marginBottom: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', width: 40 }}>成色</span>
            {['全部', ...CONDITIONS].map(c => (
              <button key={c} className={`btn btn-sm ${condition === c ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCondition(c)}>{c}</button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', width: 40 }}>排序</span>
            {SORTS.map(s => (
              <button key={s.key} className={`btn btn-sm ${sort === s.key ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSort(s.key)}>{s.label}</button>
            ))}
          </div>
        </div>
      )}

      {/* 分类导航 */}
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6, marginBottom: '1.5rem' }}>
        {CATEGORIES.map(c => {
          const on = category === c
          return (
            <button key={c} onClick={() => setCategory(c)}
              style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 62, padding: '8px 0', borderRadius: 12, cursor: 'pointer', background: on ? 'rgba(124,108,255,.15)' : 'var(--surface)', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, color: on ? 'var(--text)' : 'var(--muted)' }}>
              <span style={{ fontSize: 22 }}>{CATEGORY_ICONS[c]}</span>
              <span style={{ fontSize: 11 }}>{c}</span>
            </button>
          )
        })}
      </div>

      {/* 内容 */}
      {loading ? (
        <div style={{ color: 'var(--muted)', padding: '3rem 0', textAlign: 'center' }}>加载中…</div>
      ) : items.length === 0 ? (
        <div style={{ color: 'var(--muted)', padding: '3rem 0', textAlign: 'center' }}>暂无商品，快来发布第一件闲置吧！</div>
      ) : (
        <>
          <FeaturedCard item={featured} user={user} onOpen={() => navigate(`/secondhand/${featured.id}`)} onContact={handleContact} onBuy={handleBuy} />

          {rest.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>🔥 推荐商品</h3>
                <button className="btn btn-ghost btn-sm" onClick={() => setShuffleKey(k => k + 1)}>↻ 换一批</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem' }}>
                {shuffled.map(item => (
                  <SecondhandCard key={item.id} item={item} onClick={() => navigate(`/secondhand/${item.id}`)} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
