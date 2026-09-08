// =====================================================
// pages/admin/FileManager.jsx —— 后台文件管理页（网盘式）
// 路由：/admin/files
// 职责：以文件夹层级浏览 uploads/ 下所有文件，显示真实使用状态
//       （在线工具/下载/二手/论坛/收款码等），支持：
//       进入/返回目录、搜索、按状态筛选、图片缩略图预览、
//       重命名、移动、新建文件夹、删除（使用中文件不可删，但可重命名/移动，
//       后端会自动同步所有引用）。
// 移动端：卡片式自适应布局
// =====================================================

import React, { useEffect, useMemo, useState } from 'react'
import { listFiles, deleteFile, renameFile, moveFile, createFolder,
  batchDeleteFiles, deleteFolder, cleanOrphans, organizePlan, organizeApply } from '../../api/admin'
import useToastStore from '../../store/toastStore'
import { confirmDialog } from '../../store/confirmStore'

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

const IMG_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']
const ICON_BY_EXT = {
  html: '🌐', htm: '🌐', pdf: '📕', zip: '🗜️', rar: '🗜️', '7z': '🗜️',
  doc: '📄', docx: '📄', xls: '📊', xlsx: '📊', ppt: '📑', pptx: '📑',
  txt: '📃', md: '📃', json: '🔧', js: '🔧', css: '🎨',
  mp4: '🎬', webm: '🎬', mov: '🎬', mp3: '🎵', wav: '🎵',
}
const extOf = (name) => (name.split('.').pop() || '').toLowerCase()
const isImage = (name) => IMG_EXT.includes(extOf(name))
// 取相对路径的所在目录（根目录为 ''）
const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

export default function FileManager() {
  const toast = useToastStore(s => s.toast)
  const [files, setFiles] = useState([])
  const [dirs, setDirs] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(new Set())
  const [deleting, setDeleting] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all') // all | free | inuse
  const [cwd, setCwd] = useState('')           // 当前所在目录（'' = 根）

  // 弹窗状态
  const [renameTarget, setRenameTarget] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [moveTarget, setMoveTarget] = useState(null)
  const [moveDir, setMoveDir] = useState('')
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    setLoading(true)
    setSelected(new Set())
    listFiles()
      .then(data => {
        setFiles(Array.isArray(data?.files) ? data.files : [])
        setDirs(Array.isArray(data?.dirs) ? data.dirs : [])
      })
      .catch(e => toast(e.response?.data?.message || e.message || '加载失败', true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const searching = query.trim().length > 0

  // 全局统计（所有文件）
  const stats = useMemo(() => {
    const total = files.length
    const inUse = files.filter(f => f.isInUse).length
    const size = files.reduce((s, f) => s + (f.size || 0), 0)
    return { total, inUse, free: total - inUse, size }
  }, [files])

  // 当前目录下的子文件夹（搜索时不显示文件夹）
  const subdirs = useMemo(() => {
    if (searching) return []
    return dirs
      .filter(d => dirOf(d) === cwd)
      .map(d => {
        const name = d.slice(d.lastIndexOf('/') + 1)
        const count = files.filter(f => f.path.startsWith(d + '/')).length
        return { path: d, name, count }
      })
  }, [dirs, files, cwd, searching])

  // 可见文件：搜索时跨全部目录平铺；否则只看当前目录
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return files.filter(f => {
      if (filter === 'free' && f.isInUse) return false
      if (filter === 'inuse' && !f.isInUse) return false
      if (searching) {
        return `${f.name} ${f.path} ${f.usedBy || ''}`.toLowerCase().includes(q)
      }
      return dirOf(f.path) === cwd
    })
  }, [files, query, filter, cwd, searching])

  // 当前可见且空闲（可被批量选中）的文件
  const selectableVisible = visible.filter(f => !f.isInUse)
  const allChecked = selectableVisible.length > 0 && selectableVisible.every(f => selected.has(f.path))

  const toggleAll = () => {
    setSelected(prev => {
      const next = new Set(prev)
      if (allChecked) selectableVisible.forEach(f => next.delete(f.path))
      else selectableVisible.forEach(f => next.add(f.path))
      return next
    })
  }

  const toggleOne = (path) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  const handleDelete = async (f) => {
    if (!await confirmDialog(`确定删除文件「${f.name}」？此操作不可撤销。`, { danger: true, confirmText: '删除' })) return
    try {
      await deleteFile(f.path)
      toast('已删除')
      load()
    } catch (e) {
      toast(e.response?.data?.message || e.message || '删除失败', true)
    }
  }

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return
    if (!await confirmDialog(`确定删除选中的 ${selected.size} 个文件？此操作不可撤销。`, { danger: true, confirmText: '全部删除' })) return
    setDeleting(true)
    try {
      // 一次请求批量删（后端只扫一遍库），替代旧的逐个 HTTP + 逐次全库扫描
      const r = await batchDeleteFiles([...selected])
      const skip = r.skipped?.length || 0
      skip === 0 ? toast(`已删除 ${r.deleted} 个文件`)
                 : toast(`删除 ${r.deleted} 个，跳过 ${skip} 个（使用中/已不存在）`, true)
    } catch (e) {
      toast(e.response?.data?.message || e.message || '删除失败', true)
    } finally { setDeleting(false); load() }
  }

  // —— 删除文件夹（内含使用中文件时后端整体拒删）——
  const handleDeleteFolder = async (d) => {
    const msg = d.count > 0
      ? `删除文件夹「${d.name}」及其中 ${d.count} 个文件？使用中的文件会阻止删除。此操作不可撤销。`
      : `删除空文件夹「${d.name}」？`
    if (!await confirmDialog(msg, { danger: true, confirmText: '删除文件夹' })) return
    try {
      const r = await deleteFolder(d.path)
      toast(`已删除文件夹（含 ${r.deletedFiles} 个文件）`)
      load()
    } catch (e) {
      const inUse = e.response?.data?.inUse
      toast(e.response?.data?.message || '删除失败', true)
      if (inUse?.length) console.warn('阻止删除，使用中：', inUse)
    }
  }

  // —— 一键清理所有空闲文件（先预览再确认）——
  const handleCleanOrphans = async () => {
    setBusy(true)
    let preview
    try { preview = await cleanOrphans(true) }
    catch (e) { toast(e.response?.data?.message || '预览失败', true); setBusy(false); return }
    finally { setBusy(false) }
    if (!preview.count) { toast('没有空闲文件可清理'); return }
    const mb = (preview.totalSize / 1024 / 1024).toFixed(1)
    if (!await confirmDialog(
      `将删除全站 ${preview.count} 个空闲文件，释放约 ${mb} MB 空间。\n使用中的文件不受影响，删除后空目录也会一并清除。此操作不可撤销。`,
      { danger: true, confirmText: `清理 ${preview.count} 个` })) return
    setDeleting(true)
    try {
      const r = await cleanOrphans(false)
      toast(`已清理 ${r.deleted} 个空闲文件`)
    } catch (e) {
      toast(e.response?.data?.message || '清理失败', true)
    } finally { setDeleting(false); load() }
  }

  const copyLink = (path) => {
    const url = `${window.location.origin}/uploads/${path}`
    navigator.clipboard?.writeText(url).then(() => toast('链接已复制')).catch(() => toast('复制失败', true))
  }

  // —— 重命名 ——
  const openRename = (f) => { setRenameTarget(f); setRenameValue(f.name) }
  const submitRename = async () => {
    const name = renameValue.trim()
    if (!name || name === renameTarget.name) { setRenameTarget(null); return }
    setBusy(true)
    try {
      await renameFile(renameTarget.path, name)
      toast(renameTarget.isInUse ? '已重命名，引用已自动同步' : '已重命名')
      setRenameTarget(null)
      load()
    } catch (e) {
      toast(e.response?.data?.message || e.message || '重命名失败', true)
    } finally { setBusy(false) }
  }

  // —— 移动 ——
  const openMove = (f) => { setMoveTarget(f); setMoveDir(dirOf(f.path)) }
  const submitMove = async () => {
    if (moveDir === dirOf(moveTarget.path)) { setMoveTarget(null); return }
    setBusy(true)
    try {
      await moveFile(moveTarget.path, moveDir)
      toast(moveTarget.isInUse ? '已移动，引用已自动同步' : '已移动')
      setMoveTarget(null)
      load()
    } catch (e) {
      toast(e.response?.data?.message || e.message || '移动失败', true)
    } finally { setBusy(false) }
  }

  // —— 归置工具文件 ——
  // 先干跑拿清单，把清单摆给人看（前 12 条 + 总数），确认后才照单执行。
  // 【不做"算完直接搬"】：这是批量、跨全站改引用的操作，看不见清单就按的按钮迟早会误按。
  const handleOrganize = async () => {
    setBusy(true)
    try {
      const plan = await organizePlan('tools')
      const moves = plan.plans.flatMap(p => p.moves)
      const skipped = plan.plans.flatMap(p => p.skipped)
      if (moves.length === 0) {
        toast(skipped.length ? `没有需要搬的文件（${skipped.length} 项跳过，见工具详情）` : '所有工具文件都已归置到位')
        return
      }
      const preview = moves.slice(0, 12).map(m => `· ${m.from}\n   → ${m.to}`).join('\n')
      const more = moves.length > 12 ? `\n…还有 ${moves.length - 12} 个` : ''
      const skipNote = skipped.length ? `\n\n跳过 ${skipped.length} 项（共用文件/找不到的文件），留在原处。` : ''
      const ok = await confirmDialog(
        `将移动 ${moves.length} 个文件到各自的工具文件夹：\n\n${preview}${more}${skipNote}\n\n站内引用会自动同步，旧地址会 301 到新地址。`,
        { confirmText: `确认归置 ${moves.length} 个` })
      if (!ok) return
      const folders = plan.plans.filter(p => p.moves.length > 0)
        .map(p => ({ toolId: p.toolId, folder: p.folder }))
      const res = await organizeApply({ moves, folders })
      toast(`已归置 ${res.moved} 个文件`)
      load()
    } catch (e) {
      toast(e.response?.data?.message || e.message || '归置失败', true)
    } finally { setBusy(false) }
  }

  // —— 新建文件夹 ——
  const submitNewFolder = async () => {
    const name = newFolderName.trim()
    if (!name) { setNewFolderOpen(false); return }
    if (name.includes('/') || name.includes('\\')) { toast('文件夹名不能包含 / 或 \\', true); return }
    setBusy(true)
    try {
      await createFolder(cwd ? `${cwd}/${name}` : name)
      toast('已新建文件夹')
      setNewFolderOpen(false); setNewFolderName('')
      load()
    } catch (e) {
      toast(e.response?.data?.message || e.message || '新建失败', true)
    } finally { setBusy(false) }
  }

  // 面包屑分段
  const crumbs = cwd ? cwd.split('/') : []
  // 移动目标可选目录：根 + 所有目录，去掉文件当前所在目录
  const moveOptions = moveTarget
    ? ['', ...dirs].filter(d => d !== dirOf(moveTarget.path))
    : []

  const FILTERS = [
    { key: 'all', label: `全部 ${stats.total}` },
    { key: 'free', label: `空闲 ${stats.free}` },
    { key: 'inuse', label: `使用中 ${stats.inUse}` },
  ]

  return (
    <div>
      {/* 头部 */}
      <div className="fm-head">
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>文件管理</h2>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            共 {stats.total} 个 · 占用 {fmtSize(stats.size)} ·{' '}
            <span style={{ color: '#16a34a' }}>空闲 {stats.free}</span> ·{' '}
            <span style={{ color: '#d97706' }}>使用中 {stats.inUse}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {stats.free > 0 && (
            <button className="btn btn-sm" style={{ background: '#e55', color: '#fff', border: 'none' }}
              onClick={handleCleanOrphans} disabled={busy || deleting}
              title="删除全站所有未被任何模块引用的空闲文件（先预览再确认）">
              🧹 一键清理空闲 {stats.free}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={handleOrganize} disabled={busy || deleting}
            title="把散落在外的工具文件收进各自的 tools/<工具名>/ 文件夹（先看清单再确认）">
            📦 归置工具文件
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setNewFolderOpen(true)}>＋ 文件夹</button>
          <button className="btn btn-ghost btn-sm" onClick={load}>↻ 刷新</button>
        </div>
      </div>

      {/* 面包屑导航 */}
      {!searching && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, fontSize: 13, margin: '0.6rem 0' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setCwd('')} style={{ padding: '2px 8px' }}>📂 uploads</button>
          {crumbs.map((seg, i) => {
            const target = crumbs.slice(0, i + 1).join('/')
            return (
              <React.Fragment key={target}>
                <span style={{ color: 'var(--muted)' }}>/</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setCwd(target)} style={{ padding: '2px 8px' }}>{seg}</button>
              </React.Fragment>
            )
          })}
        </div>
      )}

      {/* 工具栏：搜索 + 筛选 */}
      <div className="fm-toolbar">
        <input
          className="input"
          placeholder="搜索全部文件名 / 路径 / 用途…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 0, fontSize: 16 }}
        />
        <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter(f.key)}
            >{f.label}</button>
          ))}
        </div>
      </div>

      {/* 批量操作条 */}
      {selectableVisible.length > 0 && (
        <div className="fm-bulk">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={allChecked} onChange={toggleAll} />
            全选当前空闲（{selectableVisible.length}）
          </label>
          {selected.size > 0 && (
            <button
              className="btn btn-sm"
              style={{ background: '#e55', color: '#fff', border: 'none' }}
              onClick={handleDeleteSelected}
              disabled={deleting}
            >
              {deleting ? '删除中…' : `删除选中 (${selected.size})`}
            </button>
          )}
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '3rem' }}>加载中…</div>
      ) : (subdirs.length === 0 && visible.length === 0) ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '3rem' }}>
          {files.length === 0 ? '暂无文件' : searching ? '没有匹配的文件' : '此文件夹为空'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* 子文件夹 */}
          {subdirs.map(d => (
            <div
              key={'dir:' + d.path}
              className="fm-row"
              onClick={() => { setCwd(d.path); setQuery('') }}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '0.7rem 0.85rem', cursor: 'pointer',
              }}
            >
              <span className="fm-check" style={{ visibility: 'hidden' }} />
              <span className="fm-thumb"><span style={{ fontSize: 22 }}>📁</span></span>
              <div className="fm-main">
                <div className="fm-name-row">
                  <span className="fm-name" style={{ fontWeight: 600 }}>{d.name}</span>
                </div>
                <div className="fm-meta"><span>{d.count} 个文件</span></div>
              </div>
              <div className="fm-actions" onClick={e => e.stopPropagation()}>
                <button className="btn btn-ghost btn-sm" style={{ color: '#e55' }}
                  title="删除文件夹（含使用中文件时会被拒绝）"
                  onClick={() => handleDeleteFolder(d)}>删除</button>
                <span style={{ color: 'var(--muted)', fontSize: 18 }}>›</span>
              </div>
            </div>
          ))}

          {/* 文件 */}
          {visible.map(f => {
            const checked = selected.has(f.path)
            return (
              <div key={f.path} className="fm-row" style={{
                background: checked ? 'rgba(124,108,255,0.08)' : f.isInUse ? 'rgba(245,158,11,0.05)' : 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 10, padding: '0.7rem 0.85rem',
              }}>
                {/* 选择框（仅空闲可选） */}
                <input
                  type="checkbox"
                  className="fm-check"
                  checked={checked}
                  disabled={f.isInUse}
                  onChange={() => !f.isInUse && toggleOne(f.path)}
                  title={f.isInUse ? '使用中的文件不可选择' : ''}
                />

                {/* 缩略图 / 图标 */}
                <a href={`/uploads/${f.path}`} target="_blank" rel="noreferrer" className="fm-thumb" title="打开文件">
                  {isImage(f.name)
                    ? <img src={`/uploads/${f.path}`} loading="lazy" alt="" onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🖼️' }} />
                    : <span style={{ fontSize: 22 }}>{ICON_BY_EXT[extOf(f.name)] || '📁'}</span>}
                </a>

                {/* 主信息 */}
                <div className="fm-main">
                  <div className="fm-name-row">
                    <a href={`/uploads/${f.path}`} target="_blank" rel="noreferrer" className="fm-name">{f.name}</a>
                    {f.isInUse
                      ? <span className="fm-badge fm-badge-use">使用中</span>
                      : <span className="fm-badge fm-badge-free">空闲</span>}
                  </div>
                  {(searching && f.path.includes('/')) && (
                    <div className="fm-path">{f.path}</div>
                  )}
                  <div className="fm-meta">
                    <span>{fmtSize(f.size)}</span>
                    <span>·</span>
                    <span>{new Date(f.modifiedAt).toLocaleString('zh-CN', { hour12: false })}</span>
                  </div>
                  {f.isInUse && f.usedBy && (
                    <div className="fm-usedby" title={f.usedBy}>引用：{f.usedBy}</div>
                  )}
                </div>

                {/* 操作 */}
                <div className="fm-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => copyLink(f.path)} title="复制公开链接">复制</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => openRename(f)} title="重命名">改名</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => openMove(f)} title="移动到其它目录">移动</button>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: f.isInUse ? 'var(--muted)' : '#e55' }}
                    disabled={f.isInUse}
                    title={f.isInUse ? '使用中的文件不能删除' : '删除文件'}
                    onClick={() => !f.isInUse && handleDelete(f)}
                  >删除</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 重命名弹窗 */}
      {renameTarget && (
        <Modal title="重命名文件" onClose={() => setRenameTarget(null)}>
          <input
            className="input" autoFocus value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submitRename()}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          {renameTarget.isInUse && (
            <p style={{ fontSize: 12, color: '#d97706', margin: '0.6rem 0 0' }}>
              该文件正在被使用，重命名后会自动同步所有引用。
            </p>
          )}
          <ModalFooter onCancel={() => setRenameTarget(null)} onOk={submitRename} busy={busy} />
        </Modal>
      )}

      {/* 移动弹窗 */}
      {moveTarget && (
        <Modal title={`移动「${moveTarget.name}」`} onClose={() => setMoveTarget(null)}>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>选择目标文件夹：</div>
          <select className="input" value={moveDir} onChange={e => setMoveDir(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }}>
            {moveOptions.map(d => (
              <option key={d || '__root__'} value={d}>{d === '' ? '📂 uploads（根目录）' : '📁 ' + d}</option>
            ))}
          </select>
          {moveTarget.isInUse && (
            <p style={{ fontSize: 12, color: '#d97706', margin: '0.6rem 0 0' }}>
              该文件正在被使用，移动后会自动同步所有引用。
            </p>
          )}
          <ModalFooter onCancel={() => setMoveTarget(null)} onOk={submitMove} busy={busy} okText="移动" />
        </Modal>
      )}

      {/* 新建文件夹弹窗 */}
      {newFolderOpen && (
        <Modal title="新建文件夹" onClose={() => setNewFolderOpen(false)}>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
            位置：{cwd ? 'uploads/' + cwd : 'uploads（根目录）'}
          </div>
          <input
            className="input" autoFocus value={newFolderName}
            placeholder="文件夹名称"
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submitNewFolder()}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          <ModalFooter onCancel={() => setNewFolderOpen(false)} onOk={submitNewFolder} busy={busy} okText="创建" />
        </Modal>
      )}
    </div>
  )
}

// 简易弹窗外壳
function Modal({ title, onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
          padding: '1.1rem 1.2rem', width: '100%', maxWidth: 420, boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
        }}
      >
        <h3 style={{ margin: '0 0 0.8rem', fontSize: 16 }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

function ModalFooter({ onCancel, onOk, busy, okText = '确定' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '1rem' }}>
      <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>取消</button>
      <button className="btn btn-primary btn-sm" onClick={onOk} disabled={busy}>{busy ? '处理中…' : okText}</button>
    </div>
  )
}
