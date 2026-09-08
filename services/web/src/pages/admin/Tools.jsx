// =====================================================
// pages/admin/Tools.jsx —— 工具管理页
// 职责：工具的增删改，含文件上传（弹窗内嵌上传，上传完自动填入文件名）
//   列表为卡片布局（移动友好，无横向滚动）
//   状态用彩色胶囊；操作收进 kebab（⋮）菜单，删除置底标红
// 路由：/admin/tools
// =====================================================

import React, { useEffect, useRef, useState } from 'react'
import { listAdminTools, createTool, updateTool, deleteTool, uploadFile, uploadToolVideo } from '../../api/admin'
import useToastStore from '../../store/toastStore'
import { confirmDialog } from '../../store/confirmStore'
import ToolFormModal from './ToolFormModal'

// 新增工具时的表单初始值（空白状态）
const EMPTY_FORM = {
  name: '', slug: '', category: '', iconEmoji: '🔧', description: '', readmeMarkdown: '',
  isOnline: false, onlineUrl: '', hasDownload: false, downloadFileName: '',
  isPublished: true, requireLogin: true, isPaid: false, price: '',
  videoUrl: '', videoDuration: '', folder: '',
}

// 工具名 → 默认文件夹名（uploads/tools/<工具名>）。
// 只削掉文件系统和 URL 会咬人的字符，中文原样保留——文件夹名就该是人看得懂的。
const folderFromName = (name) =>
  'tools/' + (name || '').trim().replace(/[/\\:*?"<>|#%]/g, '_').replace(/^\.+|\.+$/g, '').slice(0, 60).trim()

// 工具记录 → 接口请求体（复制/上下架时复用，字段与 createTool 对齐）
const toBody = (t) => ({
  name: t.name, slug: t.slug, category: t.category, iconEmoji: t.iconEmoji,
  description: t.description, readmeMarkdown: t.readmeMarkdown || null,
  isOnline: t.isOnline, onlineUrl: t.onlineUrl || null,
  hasDownload: t.hasDownload, downloadFileName: t.downloadFileName || null,
  isPublished: t.isPublished, requireLogin: t.requireLogin,
  isPaid: t.isPaid || false, price: parseFloat(t.price) || 0,
  videoUrl: t.videoUrl || null, videoDuration: parseInt(t.videoDuration, 10) || 0,
  folder: t.folder || null,
})

// 工具状态 → 彩色胶囊（基于真实字段，无新增字段）
//   未发布 → 下线；已发布但无在线/下载交付 → 审核中；已发布且可用 → 在线
const toolStatus = (t) => {
  if (!t.isPublished) return { cls: 'st-off', label: '下线' }
  if (!(t.isOnline || t.hasDownload)) return { cls: 'st-review', label: '审核中' }
  return { cls: 'st-live', label: '在线' }
}

export default function Tools() {
  const toast = useToastStore(s => s.toast)
  const [tools, setTools] = useState([])    // 工具列表
  const [modal, setModal] = useState(false) // 弹窗显示/隐藏
  const [form, setForm] = useState(EMPTY_FORM)  // 弹窗表单数据
  const [editId, setEditId] = useState(null)    // 正在编辑的工具 id（null=新增）
  const [formErr, setFormErr] = useState('')    // 表单错误信息
  const [uploading, setUploading] = useState(false)  // 文件上传中状态
  const [uploadPct, setUploadPct] = useState(0)      // 视频上传进度（大文件必须有进度，否则用户以为卡死）
  const [menuId, setMenuId] = useState(null)    // 当前展开 kebab 菜单的工具 id
  const [q, setQ] = useState('')                // 搜索关键词
  const [cat, setCat] = useState('')            // 分类筛选（''=全部）
  const [page, setPage] = useState(1)           // 当前页
  const PER = 10
  const wrapRef = useRef(null)

  // 加载工具列表
  const load = () => listAdminTools().then(setTools).catch(() => {})
  useEffect(() => { load() }, [])

  // 筛选 + 分页（搜索/筛选变化时回到第 1 页）
  useEffect(() => { setPage(1) }, [q, cat])
  const categories = [...new Set(tools.map(t => t.category).filter(Boolean))]
  const filtered = tools.filter(t =>
    (!q || t.name.toLowerCase().includes(q.toLowerCase())) &&
    (!cat || t.category === cat)
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER))
  const pageTools = filtered.slice((page - 1) * PER, page * PER)

  // 点击空白处关闭 kebab 菜单
  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !e.target.closest('.tool-actions')) setMenuId(null) }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // 打开新增弹窗：重置表单
  const openAdd = () => { setForm(EMPTY_FORM); setEditId(null); setFormErr(''); setModal(true) }

  // 打开编辑弹窗：用已有工具数据填充表单
  const openEdit = (t) => {
    setMenuId(null)
    setForm({
      name: t.name, slug: t.slug, category: t.category, iconEmoji: t.iconEmoji,
      description: t.description, readmeMarkdown: t.readmeMarkdown || '',
      isOnline: t.isOnline, onlineUrl: t.onlineUrl || '',
      hasDownload: t.hasDownload, downloadFileName: t.downloadFileName || '',
      isPublished: t.isPublished, requireLogin: t.requireLogin,
      isPaid: t.isPaid || false, price: t.price || '',
      videoUrl: t.videoUrl || '', videoDuration: t.videoDuration || '',
      folder: t.folder || '',
    })
    setEditId(t.id); setFormErr(''); setModal(true)
  }

  // 复制：以现有工具为模板打开新增弹窗（清空 slug 避免重复，名称加「副本」）
  const openDuplicate = (t) => {
    setMenuId(null)
    setForm({
      name: `${t.name} 副本`, slug: '', category: t.category, iconEmoji: t.iconEmoji,
      description: t.description, readmeMarkdown: t.readmeMarkdown || '',
      isOnline: t.isOnline, onlineUrl: t.onlineUrl || '',
      hasDownload: t.hasDownload, downloadFileName: t.downloadFileName || '',
      isPublished: false, requireLogin: t.requireLogin,
      isPaid: t.isPaid || false, price: t.price || '',
      // 副本共用原工具的文件（在线地址/下载包/讲解都指向同一批文件），
      // 但【文件夹留空】——两个工具指同一个文件夹，以后往里传东西就分不清是谁的了
      videoUrl: t.videoUrl || '', videoDuration: t.videoDuration || '',
      folder: '',
    })
    setEditId(null); setFormErr(''); setModal(true)
  }

  // 上架/下架：切换 isPublished
  const handleTogglePublish = async (t) => {
    setMenuId(null)
    try {
      await updateTool(t.id, toBody({ ...t, isPublished: !t.isPublished }))
      toast(t.isPublished ? '已下架' : '已上架'); load()
    } catch (e) { toast(e.message, true) }
  }

  // 保存（新增或更新）
  const handleSave = async () => {
    setFormErr('')
    const body = {
      ...form,
      onlineUrl: form.onlineUrl || null,
      downloadFileName: form.downloadFileName || null,
      readmeMarkdown: form.readmeMarkdown || null,
      price: parseFloat(form.price) || 0,
      videoUrl: form.videoUrl || null,
      videoDuration: parseInt(form.videoDuration, 10) || 0,
      folder: form.folder || null,
    }
    try {
      if (editId) await updateTool(editId, body)
      else await createTool(body)
      toast('保存成功'); setModal(false); load()
    } catch (e) { setFormErr(e.message) }
  }

  // 删除工具
  const handleDelete = async (t) => {
    setMenuId(null)
    if (!await confirmDialog(`确认删除「${t.name}」？`, { danger: true, confirmText: '删除' })) return
    try { await deleteTool(t.id); toast('已删除'); load() }
    catch (e) { toast(e.message, true) }
  }

  // 上传目标目录：表单填了就用表单的，没填就按工具名现算一个（tools/<工具名>）。
  // 没有工具名时返回空串 → 落 uploads 根，跟改造前一样，不至于卡住上传。
  const uploadDir = () => (form.folder || (form.name ? folderFromName(form.name) : ''))

  // 在编辑弹窗内上传工具文件，上传完后自动填入路径字段
  const handleUpload = async (file) => {
    if (!file) return
    setUploading(true)
    try {
      const dir = uploadDir()
      const data = await uploadFile(file, dir)
      // 存的是相对 uploads 的完整路径（tools/照片管家Pro/xxx.zip），不是纯文件名
      set('downloadFileName', data.path)
      if (dir && !form.folder) set('folder', dir)   // 顺手把文件夹字段坐实
      toast('上传成功')
    } catch (e) { toast(e.message, true) }
    finally { setUploading(false) }
  }

  // 上传视频讲解（走 500M 的专用端点），完成后填入 videoUrl
  const handleVideoUpload = async (file) => {
    if (!file) return
    setUploading(true)
    try {
      const dir = uploadDir()
      const data = await uploadToolVideo(file, dir, p => setUploadPct(p))
      set('videoUrl', data.url)
      if (dir && !form.folder) set('folder', dir)
      toast('视频上传成功')
    } catch (e) { toast(e.message, true) }
    finally { setUploading(false); setUploadPct(0) }
  }

  // 从工具列表计算统计数字（无需额外接口）
  const totalTools     = tools.length
  const totalDownloads = tools.reduce((s, t) => s + (t.downloadCount || 0), 0)
  const totalViews     = tools.reduce((s, t) => s + (t.viewCount || 0), 0)
  const paidTools      = tools.filter(t => t.isPaid).length

  return (
    <>
      {/* 标题 + 新增按钮 */}
      <div className="admin-page-head">
        <div>
          <h2 className="admin-page-title">工具管理</h2>
          <div className="admin-page-sub">管理和编辑平台上的所有工具</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>+ 新增工具</button>
      </div>

      {/* 统计条 */}
      <div className="pg-stats">
        <div className="pg-stat-item">
          <div className="pg-stat-num">{totalTools}</div>
          <div className="pg-stat-lbl">工具总数</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: '#3aa0ff' }}>{totalDownloads}</div>
          <div className="pg-stat-lbl">总下载</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--accent)' }}>{totalViews}</div>
          <div className="pg-stat-lbl">总浏览</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--warn)' }}>{paidTools}</div>
          <div className="pg-stat-lbl">付费工具</div>
        </div>
      </div>

      {/* 搜索框 */}
      <div className="tool-toolbar">
        <input className="tool-search" placeholder="搜索工具名称..." value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {/* 分类 Tab */}
      <div className="tool-cat-tabs">
        <button className={`tool-cat-tab ${cat === '' ? 'on' : ''}`} onClick={() => setCat('')}>全部</button>
        {categories.map(c => (
          <button key={c} className={`tool-cat-tab ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>

      {/* 工具卡片列表 */}
      <div className="tool-list" ref={wrapRef}>
        {pageTools.map(t => {
          const st = toolStatus(t)
          return (
            <div key={t.id} className="tool-card">
              <div className="tool-card-icon">{t.iconEmoji}</div>
              <div className="tool-card-main">
                <div className="tool-card-name">{t.name}</div>
                <div className="tool-card-meta">
                  <span className="tool-card-cat">{t.category || '未分类'}</span>
                  <span className="tool-card-stat">👁 {t.viewCount}</span>
                  <span className="tool-card-stat">⬇ {t.downloadCount}</span>
                </div>
              </div>
              <span className={`tool-status ${st.cls}`}><i className="tool-status-dot" />{st.label}</span>
              <div className="tool-actions">
                <button className="tool-kebab" onClick={() => setMenuId(menuId === t.id ? null : t.id)} aria-label="操作">⋮</button>
                {menuId === t.id && (
                  <div className="tool-menu">
                    <button onClick={() => openEdit(t)}>编辑</button>
                    <button onClick={() => openDuplicate(t)}>复制</button>
                    <button onClick={() => handleTogglePublish(t)}>{t.isPublished ? '下架' : '上架'}</button>
                    <button className="tool-menu-danger" onClick={() => handleDelete(t)}>🗑 删除</button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && <div className="chart-empty">没有匹配的工具</div>}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="tool-pager">
          <button className="pager-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
            <button key={n} className={`pager-num ${n === page ? 'active' : ''}`} onClick={() => setPage(n)}>{n}</button>
          ))}
          <button className="pager-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
        </div>
      )}

      {/* 新增/编辑弹窗 */}
      {modal && (
        <ToolFormModal
          form={form} setForm={setForm} editId={editId}
          formErr={formErr} uploading={uploading} uploadPct={uploadPct}
          defaultFolder={form.name ? folderFromName(form.name) : ''}
          onUpload={handleUpload} onVideoUpload={handleVideoUpload}
          onSave={handleSave} onClose={() => setModal(false)}
        />
      )}
    </>
  )
}
