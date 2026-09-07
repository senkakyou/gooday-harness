// =====================================================
// pages/admin/ForumAdmin.jsx —— 后台论坛管理页
// 路由：/admin/forum
// 职责：管理论坛板块（增删改）、查看所有帖子、置顶/锁定/删除帖子
// =====================================================

import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getCategories,
  adminGetCategories, adminCreateCategory, adminUpdateCategory, adminDeleteCategory,
  adminGetThreads, togglePin, toggleLock, deleteThread
} from '../../api/forum'
import useToastStore from '../../store/toastStore'
import { confirmDialog } from '../../store/confirmStore'

const EMPTY_CAT = { name: '', slug: '', description: '', icon: '💬', sortOrder: 0, isVisible: true, adminOnly: false }

export default function ForumAdmin() {
  const toast = useToastStore(s => s.toast)
  const navigate = useNavigate()
  const [tab, setTab] = useState('categories') // 'categories' | 'threads'
  const [cats, setCats] = useState([])
  const [pubCats, setPubCats] = useState([])         // 公开分类（含 threadCount/postCount，用于统计条）
  const [editCat, setEditCat] = useState(null)       // null = 关闭, {} = 新建, {id,...} = 编辑
  const [form, setForm] = useState(EMPTY_CAT)
  const [threads, setThreads] = useState([])
  const [threadPage, setThreadPage] = useState(1)
  const [threadTotal, setThreadTotal] = useState(0)
  const [filterCat, setFilterCat] = useState('')

  const loadCats = () => {
    adminGetCategories().then(r => setCats(r.data))
    getCategories().then(r => setPubCats(r.data)).catch(() => {})
  }
  const loadThreads = (p = 1, catId = filterCat) => {
    adminGetThreads(catId || undefined, p).then(r => {
      setThreads(r.data.threads)
      setThreadTotal(r.data.total)
      setThreadPage(p)
    })
  }

  useEffect(() => { loadCats() }, [])
  useEffect(() => { if (tab === 'threads') loadThreads(1) }, [tab])

  const openNew = () => { setForm(EMPTY_CAT); setEditCat({}) }
  const openEdit = (c) => { setForm({ name: c.name, slug: c.slug, description: c.description, icon: c.icon, sortOrder: c.sortOrder, isVisible: c.isVisible, adminOnly: !!c.adminOnly }); setEditCat(c) }
  const closeForm = () => setEditCat(null)

  const handleSave = async () => {
    try {
      if (editCat.id) {
        await adminUpdateCategory(editCat.id, form)
        toast('板块已更新')
      } else {
        await adminCreateCategory(form)
        toast('板块已创建')
      }
      closeForm(); loadCats()
    } catch (e) {
      toast(e.message || '操作失败', true)
    }
  }

  const handleDeleteCat = async (id) => {
    if (!await confirmDialog('确定删除该板块？（板块内有帖子则无法删除）', { danger: true, confirmText: '删除' })) return
    try {
      await adminDeleteCategory(id)
      toast('已删除')
      loadCats()
    } catch (e) {
      toast(e.message || '删除失败', true)
    }
  }

  const handleTogglePin = async (threadId) => {
    try { await togglePin(threadId); loadThreads(threadPage) }
    catch (e) { toast(e.message || '操作失败', true) }
  }
  const handleToggleLock = async (threadId) => {
    try { await toggleLock(threadId); loadThreads(threadPage) }
    catch (e) { toast(e.message || '操作失败', true) }
  }
  const handleDeleteThread = async (threadId) => {
    if (!await confirmDialog('确定删除该帖子？', { danger: true, confirmText: '删除' })) return
    try { await deleteThread(threadId); toast('帖子已删除'); loadThreads(threadPage) }
    catch (e) { toast(e.message || '删除失败', true) }
  }

  // 统计条数据（用公开 API 的 threadCount/postCount，admin API 只返回 threads 数组）
  const totalThreads = pubCats.reduce((s, c) => s + (c.threadCount || 0), 0)
  const totalReplies = pubCats.reduce((s, c) => s + Math.max(0, (c.postCount || 0) - (c.threadCount || 0)), 0)
  const replyRate = totalThreads > 0 ? Math.round((totalReplies / totalThreads) * 10) / 10 : 0

  return (
    <div>
      <div className="admin-page-head" style={{ marginBottom: '1rem' }}>
        <div>
          <h2 className="admin-page-title">论坛管理</h2>
          <div className="admin-page-sub">管理板块和帖子</div>
        </div>
      </div>

      {/* 统计条 */}
      <div className="pg-stats">
        <div className="pg-stat-item">
          <div className="pg-stat-num">{cats.length}</div>
          <div className="pg-stat-lbl">板块</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--accent)' }}>{totalThreads}</div>
          <div className="pg-stat-lbl">帖子</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--accent2)' }}>{totalReplies}</div>
          <div className="pg-stat-lbl">回复</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--warn)' }}>{replyRate}</div>
          <div className="pg-stat-lbl">均回复/帖</div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {[['categories', '板块管理'], ['threads', '帖子管理']].map(([key, label]) => (
          <button
            key={key}
            className={`btn btn-sm ${tab === key ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(key)}
          >{label}</button>
        ))}
      </div>

      {/* ============ 板块管理 ============ */}
      {tab === 'categories' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button className="btn btn-primary btn-sm" onClick={openNew}>+ 新建板块</button>
          </div>

          {/* 新建/编辑表单 */}
          {editCat !== null && (
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '1.25rem', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: 15 }}>{editCat.id ? '编辑板块' : '新建板块'}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>板块名称</div>
                  <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="如：综合讨论" style={{ width: '100%', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>URL 标识（slug）</div>
                  <input className="input" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="如：general" style={{ width: '100%', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>图标（Emoji）</div>
                  <input className="input" value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} placeholder="💬" style={{ width: '100%', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>排序（数字越小越靠前）</div>
                  <input className="input" type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))} style={{ width: '100%', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>板块描述</div>
                <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="板块简介（可选）" style={{ width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <input type="checkbox" id="isVisible" checked={form.isVisible} onChange={e => setForm(f => ({ ...f, isVisible: e.target.checked }))} />
                <label htmlFor="isVisible" style={{ fontSize: 13 }}>显示（取消则在前台隐藏，但知道链接仍可读）</label>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '1rem' }}>
                <input type="checkbox" id="adminOnly" checked={form.adminOnly} onChange={e => setForm(f => ({ ...f, adminOnly: e.target.checked }))} style={{ marginTop: 3 }} />
                <label htmlFor="adminOnly" style={{ fontSize: 13 }}>
                  🔒 仅管理员可见
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>
                    这是访问控制，不只是隐藏入口：非管理员访问板块、帖子、回复、点赞一律返回「不存在」
                  </div>
                </label>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={closeForm}>取消</button>
                <button className="btn btn-primary btn-sm" onClick={handleSave}>保存</button>
              </div>
            </div>
          )}

          {/* 板块列表 */}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)' }}>
                {['图标', '名称', 'Slug', '排序', '状态', '操作'].map(h => (
                  <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cats.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  <td style={{ padding: '0.6rem 0.75rem', fontSize: 20 }}>{c.icon}</td>
                  <td style={{ padding: '0.6rem 0.75rem' }}>{c.name}</td>
                  <td style={{ padding: '0.6rem 0.75rem', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{c.slug}</td>
                  <td style={{ padding: '0.6rem 0.75rem', color: 'var(--muted)' }}>{c.sortOrder}</td>
                  <td style={{ padding: '0.6rem 0.75rem' }}>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, background: c.isVisible ? 'rgba(0,200,100,.15)' : 'var(--border)', color: c.isVisible ? '#0c6' : 'var(--muted)' }}>
                        {c.isVisible ? '显示' : '隐藏'}
                      </span>
                      {c.adminOnly && (
                        <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, background: 'rgba(230,120,60,.18)', color: '#e8874b' }}>
                          🔒 仅管理员
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '0.6rem 0.75rem' }}>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(c)}>编辑</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: '#e55' }} onClick={() => handleDeleteCat(c.id)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
              {cats.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>暂无板块</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ============ 帖子管理 ============ */}
      {tab === 'threads' && (
        <div>
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
            <select
              className="input"
              value={filterCat}
              onChange={e => { setFilterCat(e.target.value); loadThreads(1, e.target.value) }}
              style={{ width: 160 }}
            >
              <option value="">全部板块</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>共 {threadTotal} 个帖子</span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)' }}>
                {['标题', '板块', '作者', '浏览/回复', '状态', '操作'].map(h => (
                  <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {threads.map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  <td style={{ padding: '0.6rem 0.75rem', maxWidth: 240 }}>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer', color: 'var(--accent)' }} onClick={() => navigate(`/forum/t/${t.id}`)}>
                      {t.title}
                    </div>
                  </td>
                  <td style={{ padding: '0.6rem 0.75rem', color: 'var(--muted)', fontSize: 12 }}>{t.category.name}</td>
                  <td style={{ padding: '0.6rem 0.75rem', color: 'var(--muted)', fontSize: 12 }}>{t.author.username}</td>
                  <td style={{ padding: '0.6rem 0.75rem', color: 'var(--muted)', fontSize: 12 }}>{t.viewCount} / {t.replyCount}</td>
                  <td style={{ padding: '0.6rem 0.75rem' }}>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {t.isPinned && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--accent)', color: '#fff' }}>置顶</span>}
                      {t.isLocked && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--border)', color: 'var(--muted)' }}>锁定</span>}
                      {!t.isPinned && !t.isLocked && <span style={{ fontSize: 11, color: 'var(--muted)' }}>正常</span>}
                    </div>
                  </td>
                  <td style={{ padding: '0.6rem 0.75rem' }}>
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleTogglePin(t.id)}>{t.isPinned ? '取消置顶' : '置顶'}</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleToggleLock(t.id)}>{t.isLocked ? '解锁' : '锁定'}</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: '#e55' }} onClick={() => handleDeleteThread(t.id)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
              {threads.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>暂无帖子</td></tr>
              )}
            </tbody>
          </table>

          {/* 分页 */}
          {Math.ceil(threadTotal / 30) > 1 && (
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '1rem', justifyContent: 'center' }}>
              {Array.from({ length: Math.ceil(threadTotal / 30) }, (_, i) => i + 1).map(p => (
                <button key={p} className={`btn btn-sm ${p === threadPage ? 'btn-primary' : 'btn-ghost'}`} onClick={() => loadThreads(p)}>{p}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
