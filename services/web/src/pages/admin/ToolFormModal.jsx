// =====================================================
// pages/admin/ToolFormModal.jsx —— 工具新增/编辑弹窗
// 从 admin/Tools.jsx 抽离；表单状态与回调由父组件传入
// =====================================================

import React from 'react'

export default function ToolFormModal({
  form, setForm, editId, formErr, uploading,
  onUpload, onSave, onClose,
}) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2><span className="accent-line" /> {editId ? '编辑工具' : '新增工具'}</h2>

        {/* 基础信息：两列网格布局 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
          <div className="dfg"><label>名称</label><input value={form.name} onChange={e => set('name', e.target.value)} /></div>
          {/* slug：URL 里用的标识符，如 pdf-merge */}
          <div className="dfg"><label>Slug</label><input value={form.slug} onChange={e => set('slug', e.target.value)} /></div>
          <div className="dfg"><label>分类</label><input value={form.category} onChange={e => set('category', e.target.value)} /></div>
          <div className="dfg"><label>图标</label><input value={form.iconEmoji} onChange={e => set('iconEmoji', e.target.value)} placeholder="🔧" /></div>
        </div>
        <div className="dfg"><label>描述</label><input value={form.description} onChange={e => set('description', e.target.value)} /></div>
        <div className="dfg">
          <label>说明</label>
          <textarea rows={3} value={form.readmeMarkdown} onChange={e => set('readmeMarkdown', e.target.value)}
            style={{ resize: 'vertical', width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px 11px', borderRadius: 4, fontSize: 16, outline: 'none' }} />
        </div>

        {/* 在线运行 + 下载配置 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', cursor: 'pointer', marginBottom: 6 }}>
              <input type="checkbox" checked={form.isOnline} onChange={e => set('isOnline', e.target.checked)} />
              支持在线运行
            </label>
            {/* 只在勾选"支持在线运行"后才显示 URL 输入框 */}
            {form.isOnline && (
              <div className="dfg"><label>在线URL</label><input value={form.onlineUrl} onChange={e => set('onlineUrl', e.target.value)} /></div>
            )}
          </div>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', cursor: 'pointer', marginBottom: 6 }}>
              <input type="checkbox" checked={form.hasDownload} onChange={e => set('hasDownload', e.target.checked)} />
              支持下载
            </label>
            {/* 只在勾选"支持下载"后才显示文件名+上传按钮 */}
            {form.hasDownload && (
              <div className="dfg">
                <label>文件名</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ flex: 1 }} value={form.downloadFileName} onChange={e => set('downloadFileName', e.target.value)} placeholder="上传后自动填入" />
                  {/* 用 label 包裹隐藏的 file input，点击 label 等同于点击 input */}
                  <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
                    {uploading ? '上传中...' : '上传'}
                    <input type="file" style={{ display: 'none' }} onChange={e => onUpload(e.target.files[0])} />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 开关选项 */}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isPublished} onChange={e => set('isPublished', e.target.checked)} /> 已发布
          </label>
          {/* 收费时强制需要登录，禁用该复选框 */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', cursor: form.isPaid ? 'default' : 'pointer', opacity: form.isPaid ? 0.5 : 1 }}>
            <input
              type="checkbox"
              checked={form.requireLogin || form.isPaid}
              disabled={form.isPaid}
              onChange={e => set('requireLogin', e.target.checked)}
            /> 需要登录{form.isPaid && '（收费必须）'}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--warn)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.isPaid}
              onChange={e => {
                const paid = e.target.checked
                setForm(f => ({ ...f, isPaid: paid, requireLogin: paid ? true : f.requireLogin }))
              }}
            /> 收费下载
          </label>
        </div>

        {/* 收费时显示价格输入框 */}
        {form.isPaid && (
          <div className="dfg" style={{ marginTop: '0.75rem' }}>
            <label>价格（元）</label>
            <input type="number" min="0" step="0.01" placeholder="例如：9.9" value={form.price} onChange={e => set('price', e.target.value)} />
          </div>
        )}

        {formErr && <div className="err">{formErr}</div>}
        <button className="btn btn-primary" style={{ width: '100%', marginTop: '1.25rem' }} onClick={onSave}>保存</button>
      </div>
    </div>
  )
}
