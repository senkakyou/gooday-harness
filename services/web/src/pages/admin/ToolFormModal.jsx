// =====================================================
// pages/admin/ToolFormModal.jsx —— 工具新增/编辑弹窗
// 从 admin/Tools.jsx 抽离；表单状态与回调由父组件传入
// =====================================================

import React from 'react'

export default function ToolFormModal({
  form, setForm, editId, formErr, uploading, uploadPct = 0, defaultFolder = '',
  onUpload, onVideoUpload, onSave, onClose,
}) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  // 视频来源看 URL 形态，不另设开关：http 开头=外链，其余=站内文件。
  // 后端也是这么判的，两边同一套规则，不会出现"选了外链却填站内路径"的矛盾记录
  const videoIsLink = /^https?:\/\//i.test(form.videoUrl || '')
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

        {/* 归置目录：这个工具的文件都往这里放 */}
        <div className="dfg">
          <label>文件夹</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              style={{ flex: 1 }}
              value={form.folder}
              onChange={e => set('folder', e.target.value)}
              placeholder={defaultFolder || 'tools/工具名（支持中文）'}
            />
            {defaultFolder && form.folder !== defaultFolder && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('folder', defaultFolder)}>
                按工具名
              </button>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            留空则上传时按工具名自动生成。文件名不能含 / \ : * ? " &lt; &gt; | # %
          </div>
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
                <label>文件路径</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ flex: 1 }} value={form.downloadFileName} onChange={e => set('downloadFileName', e.target.value)} placeholder="上传后自动填入（含文件夹）" />
                  {/* 用 label 包裹隐藏的 file input，点击 label 等同于点击 input */}
                  <label className="btn btn-ghost btn-sm" style={{ cursor: uploading ? 'default' : 'pointer' }}>
                    {uploading ? '上传中...' : '上传'}
                    {/* 选完清空 value：不清的话同一个文件再选一次不触发 onChange，看着像没反应 */}
                    <input type="file" style={{ display: 'none' }} disabled={uploading}
                      onChange={e => { onUpload(e.target.files[0]); e.target.value = '' }} />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 视频讲解：站内上传 或 外链（B站等）。VideoUrl 有值就等于"有讲解"，没有单独的开关 */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '0.75rem', marginTop: '0.5rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
            🎬 视频讲解{form.videoUrl ? (videoIsLink ? '（外链）' : '（站内文件）') : '（未设置）'}
          </div>
          <div className="dfg">
            <label>视频地址</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                style={{ flex: 1 }}
                value={form.videoUrl}
                onChange={e => set('videoUrl', e.target.value)}
                placeholder="B站链接，或点右侧上传 mp4"
              />
              <label className="btn btn-ghost btn-sm" style={{ cursor: uploading ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                {uploading ? (uploadPct ? `${uploadPct}%` : '上传中...') : '上传'}
                <input type="file" accept="video/mp4,video/webm" style={{ display: 'none' }}
                  disabled={uploading}
                  onChange={e => { onVideoUpload?.(e.target.files[0]); e.target.value = '' }} />
              </label>
              {form.videoUrl && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { set('videoUrl', ''); set('videoDuration', '') }}>
                  清除
                </button>
              )}
            </div>
          </div>
          {/* 上传大文件时给条进度，否则用户不知道是在传还是卡死了 */}
          {uploading && uploadPct > 0 && (
            <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden', margin: '2px 0 8px' }}>
              <div style={{ width: `${uploadPct}%`, height: '100%', background: 'var(--accent)' }} />
            </div>
          )}
          <div className="dfg">
            <label>时长（秒）</label>
            <input type="number" min="0" value={form.videoDuration}
              onChange={e => set('videoDuration', e.target.value)} placeholder="选填，卡片上显示 8:32" />
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            上传只收 mp4 / webm，单个最大 500MB。讲解一律公开，不跟"需要登录/收费"挂钩。
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
