// pages/account/RequestsTab.jsx —— 个人中心·我的需求 Tab
import React, { useEffect, useState } from 'react'
import { myRequests, updateMyRequest, deleteMyRequest } from '../../api/requests'
import useToastStore from '../../store/toastStore'
import { confirmDialog } from '../../store/confirmStore'
import { Badge, fmt } from './shared'

export default function RequestsTab() {
  const toast = useToastStore(s => s.toast)
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState(null)
  const [editForm, setEditForm] = useState({})

  const load = () => myRequests().then(setList).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const openEdit = (r) => {
    setEditId(r.id)
    setEditForm({ title: r.title, description: r.description, budget: r.budget || '' })
  }

  const saveEdit = async () => {
    try {
      await updateMyRequest(editId, editForm)
      toast('已更新')
      setEditId(null)
      load()
    } catch (e) { toast(e.message || '操作失败', true) }
  }

  const del = async (id) => {
    if (!await confirmDialog('确定删除这条需求？', { danger: true, confirmText: '删除' })) return
    try {
      await deleteMyRequest(id)
      toast('已删除')
      load()
    } catch (e) { toast(e.message || '操作失败', true) }
  }

  if (loading) return <div style={{ color: 'var(--muted)' }}>加载中…</div>
  if (!list.length) return (
    <div style={{ color: 'var(--muted)', padding: '2rem 0' }}>
      暂无提交记录。在需求页提交的需求会显示在这里。
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {list.map(r => (
        <div key={r.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {editId === r.id ? (
            <div style={{ padding: '1rem 1.25rem' }}>
              <div style={{ marginBottom: '0.6rem' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>需求标题</div>
                <input className="input" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ marginBottom: '0.6rem' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>需求描述</div>
                <textarea className="input" rows={4} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>预算</div>
                <input className="input" value={editForm.budget} onChange={e => setEditForm(f => ({ ...f, budget: e.target.value }))} placeholder="如：200-500" style={{ width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>取消</button>
                <button className="btn btn-primary btn-sm" onClick={saveEdit}>保存</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ padding: '0.9rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{r.title}</div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Badge status={r.status} />
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>提交于 {fmt(r.createdAt)}</span>
                    {r.budget && <span style={{ color: 'var(--muted)', fontSize: 12 }}>· 预算 {r.budget}</span>}
                  </div>
                </div>
                {r.status === 'pending' && (
                  <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)}>编辑</button>
                    <button className="btn btn-ghost btn-sm" style={{ color: '#e55' }} onClick={() => del(r.id)}>删除</button>
                  </div>
                )}
              </div>
              <div style={{ padding: '0 1.25rem 0.9rem', fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {r.description}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
