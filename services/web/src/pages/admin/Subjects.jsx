import React, { useEffect, useState } from 'react'
import { adminListSubjects, adminCreateSubject, adminUpdateSubject, adminDeleteSubject } from '../../api/courses'
import useToastStore from '../../store/toastStore'
import { subjectColor, withAlpha } from '../../utils/subjectTheme'
import SubjectIcon from '../../components/SubjectIcon'

const EMOJIS = ['📚','🧪','⚛️','➗','📐','🌍','🏛️','📝','🎨','🎵','💻','🤖','🔭','🧬','🖥️','🎸']

const empty = { name: '', iconEmoji: '📚', sortOrder: 0, isActive: true }

export default function Subjects() {
  const toast = useToastStore(s => s.toast)
  const [subjects, setSubjects] = useState([])
  const [modal, setModal] = useState(null)   // null | { mode: 'create'|'edit', data }
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)

  const load = () => adminListSubjects().then(r => setSubjects(r.data))
  useEffect(() => { load() }, [])

  const openCreate = () => { setForm(empty); setModal({ mode: 'create' }) }
  const openEdit = (s) => { setForm({ name: s.name, iconEmoji: s.iconEmoji, sortOrder: s.sortOrder, isActive: s.isActive }); setModal({ mode: 'edit', id: s.id }) }

  const save = async () => {
    if (!form.name.trim()) { toast('名称不能为空', true); return }
    setSaving(true)
    try {
      if (modal.mode === 'create') await adminCreateSubject(form)
      else await adminUpdateSubject(modal.id, form)
      await load()
      setModal(null)
      toast('保存成功')
    } catch (e) {
      const msg = typeof e.response?.data === 'string' ? e.response.data : '保存失败'
      toast(msg, true)
    }
    finally { setSaving(false) }
  }

  const del = async (id) => {
    if (!confirm('确定删除？删除后该学科下的老师关联将断开。')) return
    try {
      await adminDeleteSubject(id)
      await load()
      toast('已删除')
    } catch (e) {
      const msg = typeof e.response?.data === 'string' ? e.response.data : '删除失败'
      toast(msg, true)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontWeight: 700, fontSize: '1.4rem', margin: 0 }}>学科管理</h2>
        <button onClick={openCreate} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>+ 新增学科</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
        {subjects.map(s => {
          const c = subjectColor(s)
          return (
          <div key={s.id} style={{ borderRadius: 12, padding: '1rem 1.1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            border: `1px solid ${withAlpha(c, 0.35)}`,
            background: `linear-gradient(155deg, ${withAlpha(c, 0.16)} 0%, var(--surface) 60%)`,
            opacity: s.isActive ? 1 : 0.55 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: `radial-gradient(circle at 50% 38%, ${withAlpha(c, 0.42)}, ${withAlpha(c, 0.10)} 70%)`,
                boxShadow: `inset 0 0 0 1px ${withAlpha(c, 0.35)}, 0 0 14px ${withAlpha(c, 0.35)}` }}>
                <SubjectIcon emoji={s.iconEmoji} color={c} size={26} />
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: s.isActive ? '#10b981' : 'var(--muted)' }}>{s.isActive ? '已启用' : '已禁用'} · 排序{s.sortOrder}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => openEdit(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--accent)', padding: '2px 4px' }}>编辑</button>
              <button onClick={() => del(s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#ef4444', padding: '2px 4px' }}>删除</button>
            </div>
          </div>
        )})}
        {subjects.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 14, gridColumn: '1/-1', padding: '2rem 0', textAlign: 'center' }}>暂无学科，点击右上角新增</div>}
      </div>

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: '1.75rem', width: 380, maxWidth: '92vw' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>{modal.mode === 'create' ? '新增学科' : '编辑学科'}</div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, marginBottom: 6 }}>名称</div>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 16, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, marginBottom: 6 }}>图标</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {EMOJIS.map(e => (
                  <button key={e} onClick={() => setForm(f => ({ ...f, iconEmoji: e }))}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, border: `2px solid ${form.iconEmoji === e ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: 0, cursor: 'pointer', background: form.iconEmoji === e ? 'var(--accent-soft)' : 'transparent' }}>
                    <SubjectIcon emoji={e} color={form.iconEmoji === e ? '#a855f7' : '#6b7280'} size={24} />
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, marginBottom: 6 }}>排序（数字小排前）</div>
                <input type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 16, background: 'var(--bg)', color: 'var(--text)' }} />
              </div>
              <div>
                <div style={{ fontSize: 13, marginBottom: 6 }}>状态</div>
                <select value={form.isActive ? '1' : '0'} onChange={e => setForm(f => ({ ...f, isActive: e.target.value === '1' }))}
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 16, background: 'var(--bg)', color: 'var(--text)' }}>
                  <option value="1">启用</option>
                  <option value="0">禁用</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={save} disabled={saving}
                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                {saving ? '保存中…' : '保存'}
              </button>
              <button onClick={() => setModal(null)} style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', cursor: 'pointer' }}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
