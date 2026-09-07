// =====================================================
// pages/secondhand/PublishForm.jsx —— 发布闲置商品表单
// 从 SecondhandHome.jsx 抽离；状态与回调由父组件传入
// =====================================================

import React from 'react'
import { CATEGORIES, CONDITIONS } from './constants'

const labelStyle = { display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }

export default function PublishForm({
  form, setForm, previewUrls, uploading, submitting,
  onUpload, onRemoveImage, onSubmit,
}) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.5rem', marginBottom: '1.5rem' }}>
      <h3 style={{ margin: '0 0 1rem', fontSize: 16 }}>发布闲置商品</h3>
      <form onSubmit={onSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label style={labelStyle}>标题 *</label>
            <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="商品名称，简洁明了" />
          </div>
          <div>
            <label style={labelStyle}>价格（元）*</label>
            <input className="input" type="number" min="0" step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0 表示免费" />
          </div>
          <div>
            <label style={labelStyle}>原价（元）</label>
            <input className="input" type="number" min="0" step="0.01" value={form.originalPrice} onChange={e => setForm(f => ({ ...f, originalPrice: e.target.value }))} placeholder="选填，高于售价显示折扣" />
          </div>
          <div>
            <label style={labelStyle}>分类</label>
            <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {CATEGORIES.filter(c => c !== '全部').map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>成色</label>
            <select className="input" value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}>
              {CONDITIONS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle}>所在地</label>
          <input className="input" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="如：上海·浦东新区" />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle}>描述</label>
          <textarea className="input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="描述商品状态、购买时间、附赠配件等..." style={{ resize: 'vertical' }} />
        </div>
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={labelStyle}>图片（最多6张）</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
            {previewUrls.map(url => (
              <div key={url} style={{ position: 'relative' }}>
                <img src={url} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                <button type="button" onClick={() => onRemoveImage(url)} style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', background: '#ff4757', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
              </div>
            ))}
            {previewUrls.length < 6 && (
              <label style={{ width: 80, height: 80, border: '2px dashed var(--border)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)', fontSize: 24 }}>
                {uploading ? '…' : '+'}
                <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onUpload} disabled={uploading} />
              </label>
            )}
          </div>
        </div>
        <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? '发布中…' : '确认发布'}</button>
      </form>
    </div>
  )
}
