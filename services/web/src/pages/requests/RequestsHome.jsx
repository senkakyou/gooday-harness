// =====================================================
// pages/requests/RequestsHome.jsx —— 发布定制需求页（按设计图）
// 路由：/requests
// 结构：英雄横幅 → ①选择需求类型(可多选) → ②描述(单框+引导+计数)
//       → ③上传文件(可选) → ④预算(单选) → ⑤联系方式 → 提交
// =====================================================

import React, { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { submitRequest, uploadRequestFile } from '../../api/requests'
import useToastStore from '../../store/toastStore'

// ① 需求类型（可多选，含 AI 工具 / 小程序网站）
const REQ_TYPES = [
  { label: '数据处理', icon: '📊' }, { label: '文件转换', icon: '📄' },
  { label: '自动化', icon: '⚙️' }, { label: '报表图表', icon: '📈' },
  { label: '爬虫采集', icon: '🌐' }, { label: 'AI工具', icon: '✨' },
  { label: '小程序/网站', icon: '🧩' }, { label: '其他', icon: '📦' },
]

// ② 描述引导（作为 textarea 占位提示）
const DESC_PLACEHOLDER =
  `📋 你想实现什么？  例如：自动整理 Excel 数据并生成统计报表\n` +
  `📥 输入是什么？  例如：Excel 文件、PDF、数据库、网址等\n` +
  `🎯 希望输出什么？  例如：生成报表、导出 Excel、自动发送邮件等\n` +
  `🔄 现在怎么做？  例如：目前人工复制粘贴处理，每次需要 2 小时\n` +
  `⭐ 其他要求（可选）  例如：支持 Windows 运行、每天自动执行、预算范围等`

// ④ 预算区间（单选）
const BUDGETS = ['不确定', '500元以下', '500-1000元', '1000-5000元', '5000元以上']

const DESC_MAX = 2000

const sectionTitle = (n, text, extra) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.9rem' }}>
    <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{text}</span>
    {extra && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{extra}</span>}
  </div>
)

export default function RequestsHome() {
  const navigate = useNavigate()
  const toast = useToastStore(s => s.toast)
  const fileInput = useRef(null)
  const [success, setSuccess] = useState(false)
  const [types, setTypes] = useState([])          // 多选类型
  const [desc, setDesc] = useState('')
  const [files, setFiles] = useState([])          // [{url,name}]
  const [uploading, setUploading] = useState(false)
  const [budget, setBudget] = useState('不确定')
  const [contactType, setContactType] = useState('wechat')
  const [contact, setContact] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/'))
  const toggleType = (t) => setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])

  const handleFiles = async (list) => {
    const arr = Array.from(list || [])
    if (!arr.length) return
    setUploading(true)
    for (const f of arr) {
      try {
        const data = await uploadRequestFile(f)
        setFiles(prev => [...prev, { url: data.url, name: data.name || f.name }])
      } catch (e) { toast(e.message || '上传失败', true) }
    }
    setUploading(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErr('')
    if (types.length === 0) { setErr('请至少选择一个需求类型'); return }
    if (desc.trim().length < 10) { setErr('需求描述至少 10 个字'); return }
    if (!contact.trim()) { setErr('请填写联系方式'); return }

    let description = desc.trim()
    if (files.length) description += `\n\n【附件】` + files.map(f => `${f.name}: ${f.url}`).join('  |  ')

    setLoading(true)
    try {
      await submitRequest({
        name: contact,
        title: types.join('、'),
        description,
        contactType,
        contact,
        budget: budget || null,
      })
      setTypes([]); setDesc(''); setFiles([]); setBudget('不确定'); setContact('')
      setSuccess(true)
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '1.4rem' }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '1.25rem 1rem 4rem' }}>

      {/* 英雄横幅 */}
      <div className="req-hero">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="req-hero-title">发布定制需求</div>
          <div className="req-hero-sub">描述越清晰，匹配越快，通常 24 小时内回复</div>
          <div className="req-hero-badges">
            <span>⚡ 快速评估</span><span>🔒 信息保密</span><span>💬 免费咨询</span>
          </div>
        </div>
        <div className="req-hero-art">📋</div>
      </div>

      {success ? (
        <div style={{ ...card, textAlign: 'center', padding: '2.5rem 2rem' }}>
          <div style={{ fontSize: 34, marginBottom: '0.5rem' }}>✅</div>
          <div style={{ fontSize: 14, color: 'var(--text)', marginBottom: '0.4rem' }}>已收到，通常 24 小时内联系你</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--accent2)', marginBottom: '1.5rem' }}>微信：yimilisun</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setSuccess(false)}>再提交一个</button>
            <button className="btn btn-primary btn-sm" onClick={goBack}>返回</button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* ① 选择需求类型 */}
          <div style={card}>
            {sectionTitle('1', '选择需求类型', '可多选')}
            <div className="req-type-grid">
              {REQ_TYPES.map(t => (
                <button key={t.label} type="button" onClick={() => toggleType(t.label)}
                  className={`req-type ${types.includes(t.label) ? 'on' : ''}`}>
                  <span className="req-type-icon">{t.icon}</span>{t.label}
                </button>
              ))}
            </div>
          </div>

          {/* ② 描述你的需求 */}
          <div style={card}>
            {sectionTitle('2', '描述你的需求', '按提示填写即可')}
            <div className="req-desc-wrap">
              <textarea
                rows={8} maxLength={DESC_MAX}
                placeholder={DESC_PLACEHOLDER}
                value={desc} onChange={e => setDesc(e.target.value)}
                className="req-desc"
              />
              <div className="req-counter">{desc.length} / {DESC_MAX}</div>
            </div>
          </div>

          {/* ③ 上传文件 */}
          <div style={card}>
            {sectionTitle('3', '上传文件', '可选 · 上传示例文件会提高匹配准确度')}
            <div className="req-upload" onClick={() => fileInput.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}>
              <input ref={fileInput} type="file" multiple hidden
                accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.ppt,.pptx,.txt,.png,.jpg,.jpeg,.gif,.webp"
                onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
              <div className="req-upload-ico">⬆️</div>
              <div className="req-upload-main">{uploading ? '上传中…' : '点击上传文件'}</div>
              <div className="req-upload-sub">支持 Excel / PDF / 图片 / Word 等（≤30MB）</div>
            </div>
            {files.length > 0 && (
              <div className="req-files">
                {files.map((f, i) => (
                  <div key={i} className="req-file">
                    <span className="req-file-name">📎 {f.name}</span>
                    <button type="button" className="req-file-del" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ④ 预算 */}
          <div style={card}>
            {sectionTitle('4', '预算', '选填')}
            <div className="req-budget">
              {BUDGETS.map(b => (
                <label key={b} className={`req-radio ${budget === b ? 'on' : ''}`}>
                  <input type="radio" name="budget" checked={budget === b} onChange={() => setBudget(b)} />
                  <span className="req-radio-dot" />{b}
                </label>
              ))}
            </div>
          </div>

          {/* ⑤ 联系方式 */}
          <div style={card}>
            {sectionTitle('5', '联系方式')}
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={contactType} onChange={e => setContactType(e.target.value)}
                style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px 10px', borderRadius: 8, fontSize: 16, outline: 'none', cursor: 'pointer' }}>
                <option value="wechat">微信</option>
                <option value="email">邮箱</option>
                <option value="telegram">Telegram</option>
                <option value="phone">手机</option>
              </select>
              <input type="text" placeholder="请输入联系方式" value={contact} onChange={e => setContact(e.target.value)}
                style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px 12px', borderRadius: 8, fontSize: 16, outline: 'none' }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: '0.5rem' }}>我们将通过该方式与您联系</div>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--green)' }}>✓ 通常 24 小时内回复</span>
              <span style={{ fontSize: 12, color: 'var(--green)' }}>✓ 不合适也会通知</span>
            </div>
          </div>

          {err && <div className="err">{err}</div>}

          <button className="btn btn-primary req-submit" disabled={loading}>
            {loading ? '提交中…' : '✨ 免费获取方案'}
          </button>
        </form>
      )}
    </div>
  )
}
