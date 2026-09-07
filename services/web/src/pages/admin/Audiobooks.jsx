// =====================================================
// pages/admin/Audiobooks.jsx —— 后台·听书管理
// 增删改书 + 管理章节（音频/视频 · 上传/外链）+ 媒体上传
// =====================================================

import React, { useEffect, useState } from 'react'
import {
  listBooks, getBook, createBook, updateBook, deleteBook,
  addChapter, updateChapter, deleteChapter, uploadMedia,
} from '../../api/audiobooks'
import useToastStore from '../../store/toastStore'

const CATEGORIES = ['小说', '历史', '商业', '儿童', '科普', '人文', '其他']
const emptyBook = { title: '', author: '', narrator: '', category: '其他', coverUrl: '', epubUrl: '', description: '', isPublished: true, orderNo: 0 }
const emptyChapter = { title: '', mediaType: 'audio', source: 'link', mediaUrl: '', duration: 0, orderNo: 0 }

const inp = { width: '100%', fontSize: 16, padding: '0.5rem 0.7rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', marginBottom: 8 }

export default function AdminAudiobooks() {
  const toast = useToastStore(s => s.toast)
  const [books, setBooks] = useState([])
  const [editing, setEditing] = useState(null)   // null | emptyBook(新建) | book(编辑)
  const [managing, setManaging] = useState(null) // 正在管理章节的书 detail
  const [uploading, setUploading] = useState(false)

  const reload = () => listBooks({ pageSize: 50 }).then(d => setBooks(d.items || []))
  useEffect(() => { reload() }, [])

  // ---- 书：保存（新建/编辑）----
  const saveBook = async () => {
    if (!editing.title?.trim()) return toast('书名不能为空', true)
    try {
      if (editing.id) await updateBook(editing.id, editing)
      else await createBook(editing)
      toast('已保存'); setEditing(null); reload()
    } catch (e) { toast(e.response?.data?.message || '保存失败', true) }
  }
  const delBook = async (b) => {
    if (!window.confirm(`删除《${b.title}》及其全部章节？上传的媒体文件也会一并删除，不可恢复。`)) return
    try { await deleteBook(b.id); toast('已删除'); reload() } catch (e) { toast('删除失败', true) }
  }

  // ---- 封面上传 ----
  const uploadCover = async (file) => {
    if (!file) return
    setUploading(true)
    try { const r = await uploadMedia(withFile(file)); setEditing(s => ({ ...s, coverUrl: r.url })); toast('封面已上传') }
    catch (e) { toast(e.response?.data?.message || '上传失败', true) } finally { setUploading(false) }
  }
  // ---- EPUB 文字版上传 ----
  const uploadEpub = async (file) => {
    if (!file) return
    setUploading(true)
    try { const r = await uploadMedia(withFile(file)); setEditing(s => ({ ...s, epubUrl: r.url })); toast('EPUB 已上传') }
    catch (e) { toast(e.response?.data?.message || '上传失败', true) } finally { setUploading(false) }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: 0 }}>🎧 听书管理</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...emptyBook })}>+ 新增听书</button>
      </div>

      {/* 书列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {books.map(b => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.6rem 0.8rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <div style={{ width: 40, height: 53, borderRadius: 6, flexShrink: 0, background: b.coverUrl ? `center/cover url(${b.coverUrl})` : 'linear-gradient(135deg,#ec4899,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{b.coverUrl ? '' : '🎧'}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{b.title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{b.author || '—'} · {b.chapterCount} 章 · {b.playCount} 播放</div>
            </div>
            <button className="btn btn-sm" onClick={async () => setManaging(await getBook(b.id))}>章节</button>
            <button className="btn btn-sm" onClick={async () => setEditing(await getBook(b.id))}>编辑</button>
            <button className="btn btn-sm" style={{ color: '#ff4d6d' }} onClick={() => delBook(b)}>删除</button>
          </div>
        ))}
        {books.length === 0 && <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>还没有听书，点右上角新增</p>}
      </div>

      {/* ===== 书编辑弹层 ===== */}
      {editing && (
        <Modal title={editing.id ? '编辑听书' : '新增听书'} onClose={() => setEditing(null)}>
          <input style={inp} placeholder="书名 *" value={editing.title} onChange={e => setEditing(s => ({ ...s, title: e.target.value }))} />
          <input style={inp} placeholder="作者" value={editing.author} onChange={e => setEditing(s => ({ ...s, author: e.target.value }))} />
          <input style={inp} placeholder="主播" value={editing.narrator} onChange={e => setEditing(s => ({ ...s, narrator: e.target.value }))} />
          <select style={inp} value={editing.category} onChange={e => setEditing(s => ({ ...s, category: e.target.value }))}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input style={{ ...inp, marginBottom: 0 }} placeholder="封面图 URL（外链）或上传" value={editing.coverUrl} onChange={e => setEditing(s => ({ ...s, coverUrl: e.target.value }))} />
            <label className="btn btn-sm" style={{ whiteSpace: 'nowrap', cursor: 'pointer' }}>
              {uploading ? '…' : '上传图'}
              <input type="file" accept="image/*" hidden onChange={e => uploadCover(e.target.files[0])} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input style={{ ...inp, marginBottom: 0 }} placeholder="文字版 EPUB URL（外链）或上传，选填" value={editing.epubUrl} onChange={e => setEditing(s => ({ ...s, epubUrl: e.target.value }))} />
            <label className="btn btn-sm" style={{ whiteSpace: 'nowrap', cursor: 'pointer' }}>
              {uploading ? '…' : '传EPUB'}
              <input type="file" accept=".epub" hidden onChange={e => uploadEpub(e.target.files[0])} />
            </label>
          </div>
          <textarea style={{ ...inp, minHeight: 70 }} placeholder="简介" value={editing.description} onChange={e => setEditing(s => ({ ...s, description: e.target.value }))} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            <label style={{ fontSize: 14, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={editing.isPublished} onChange={e => setEditing(s => ({ ...s, isPublished: e.target.checked }))} /> 上架显示
            </label>
            <label style={{ fontSize: 14, color: 'var(--muted)' }}>排序
              <input type="number" style={{ ...inp, width: 70, marginBottom: 0, marginLeft: 6, display: 'inline-block' }} value={editing.orderNo} onChange={e => setEditing(s => ({ ...s, orderNo: Number(e.target.value) }))} />
            </label>
          </div>
          <button className="btn btn-primary" onClick={saveBook}>保存</button>
        </Modal>
      )}

      {/* ===== 章节管理弹层 ===== */}
      {managing && (
        <ChapterManager book={managing} toast={toast} onClose={() => { setManaging(null); reload() }}
          reloadBook={async () => setManaging(await getBook(managing.id))} setUploading={setUploading} uploading={uploading} />
      )}
    </div>
  )
}

// 把单文件包成 FormData（字段名 file，对应后端 IFormFile file）
function withFile(file) { const fd = new FormData(); fd.append('file', file); return fd }

function Modal({ title, onClose, children }) {
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: 16 }}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, width: '100%', maxWidth: 480, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 22 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---- 章节管理 ----
function ChapterManager({ book, toast, onClose, reloadBook, setUploading, uploading }) {
  const [form, setForm] = useState({ ...emptyChapter, orderNo: (book.chapters?.length || 0) + 1 })
  const chapters = book.chapters || []

  const upload = async (file) => {
    if (!file) return
    setUploading(true)
    try {
      const r = await uploadMedia(withFile(file))   // 返回 { url, mediaType, source }
      setForm(s => ({ ...s, mediaUrl: r.url, mediaType: r.mediaType, source: 'upload' }))
      toast('媒体已上传')
    } catch (e) { toast(e.response?.data?.message || '上传失败', true) } finally { setUploading(false) }
  }
  const add = async () => {
    if (!form.mediaUrl?.trim()) return toast('请填外链或上传媒体', true)
    try { await addChapter(book.id, form); toast('已添加'); setForm({ ...emptyChapter, orderNo: (chapters.length || 0) + 2 }); reloadBook() }
    catch (e) { toast(e.response?.data?.message || '添加失败', true) }
  }
  const del = async (c) => {
    if (!window.confirm(`删除章节「${c.title}」？上传的媒体文件也会删除。`)) return
    try { await deleteChapter(c.id); toast('已删除'); reloadBook() } catch { toast('删除失败', true) }
  }

  return (
    <Modal title={`章节管理 · ${book.title}`} onClose={onClose}>
      {/* 已有章节 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        {chapters.map((c, i) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.4rem 0.6rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <span>{c.mediaType === 'video' ? '🎬' : '🎧'}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.orderNo}. {c.title || `第${i + 1}章`}</span>
            <button className="btn btn-sm" style={{ color: '#ff4d6d' }} onClick={() => del(c)}>删</button>
          </div>
        ))}
        {chapters.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>暂无章节，下面添加</p>}
      </div>

      {/* 新增章节 */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>＋ 新增章节</div>
        <input style={inp} placeholder="章节标题（如 第一章）" value={form.title} onChange={e => setForm(s => ({ ...s, title: e.target.value }))} />
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <select style={{ ...inp, marginBottom: 0 }} value={form.mediaType} onChange={e => setForm(s => ({ ...s, mediaType: e.target.value }))}>
            <option value="audio">🎧 音频</option>
            <option value="video">🎬 视频</option>
          </select>
          <select style={{ ...inp, marginBottom: 0 }} value={form.source} onChange={e => setForm(s => ({ ...s, source: e.target.value }))}>
            <option value="link">外链</option>
            <option value="upload">上传</option>
          </select>
        </div>
        {form.source === 'link'
          ? <input style={inp} placeholder="媒体外链 URL" value={form.mediaUrl} onChange={e => setForm(s => ({ ...s, mediaUrl: e.target.value }))} />
          : (
            <div style={{ marginBottom: 8 }}>
              <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                {uploading ? '上传中…' : (form.mediaUrl ? '✓ 已上传，可重选' : '选择音频/视频文件')}
                <input type="file" accept="audio/*,video/*" hidden onChange={e => upload(e.target.files[0])} />
              </label>
              {form.mediaUrl && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, wordBreak: 'break-all' }}>{form.mediaUrl}</div>}
            </div>
          )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <input type="number" style={{ ...inp, width: 90, marginBottom: 0 }} placeholder="时长(秒)" value={form.duration} onChange={e => setForm(s => ({ ...s, duration: Number(e.target.value) }))} />
          <input type="number" style={{ ...inp, width: 90, marginBottom: 0 }} placeholder="排序" value={form.orderNo} onChange={e => setForm(s => ({ ...s, orderNo: Number(e.target.value) }))} />
        </div>
        <button className="btn btn-primary" onClick={add}>添加章节</button>
      </div>
    </Modal>
  )
}
