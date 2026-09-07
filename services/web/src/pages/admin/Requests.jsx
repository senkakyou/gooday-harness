// =====================================================
// pages/admin/Requests.jsx —— 定制需求管理页
// 职责：查看用户提交的所有定制需求，更新状态/备注，删除
// 路由：/admin/requests
// =====================================================

import React, { useEffect, useState } from 'react'
import { listRequests, updateRequest, deleteRequest, getRequestStats } from '../../api/requests'
import useToastStore from '../../store/toastStore'
import { confirmDialog } from '../../store/confirmStore'

const STATUS_MAP   = { pending: '待处理', talking: '沟通中', done: '已完成', rejected: '不接受' }
const STATUS_PILL  = { pending: 'st-pill-warn', talking: 'st-pill-blue', done: 'st-pill-green', rejected: 'st-pill-muted' }
const CONTACT_ICON = { wechat: '💬', email: '📧', phone: '📱' }

// 需求类型图标映射
const TYPE_ICON = { 功能: '⚙️', 设计: '🎨', 系统: '🖥️', 其他: '📌' }

export default function Requests() {
  const toast = useToastStore(s => s.toast)
  const [list, setList] = useState([])
  const [filter, setFilter] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailStatus, setDetailStatus] = useState('')
  const [detailNote, setDetailNote] = useState('')
  const [stats, setStats] = useState(null)

  const load = (status) => {
    setFilter(status)
    listRequests(status).then(setList).catch(() => {})
  }

  useEffect(() => {
    load('')
    getRequestStats().then(setStats).catch(() => {})
  }, [])

  const handleSave = async () => {
    try {
      await updateRequest(detail.id, { status: detailStatus, adminNote: detailNote })
      toast('已保存')
      setDetail(null)
      load(filter)
      getRequestStats().then(setStats).catch(() => {})
    } catch (e) { toast(e.message, true) }
  }

  const handleDelete = async () => {
    if (!await confirmDialog('确认删除该需求？', { danger: true, confirmText: '删除' })) return
    try {
      await deleteRequest(detail.id)
      toast('已删除')
      setDetail(null)
      load(filter)
      getRequestStats().then(setStats).catch(() => {})
    } catch (e) { toast(e.message, true) }
  }

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h2 className="admin-page-title">需求管理</h2>
          <div className="admin-page-sub">用户提交的定制开发需求</div>
        </div>
      </div>

      {/* 统计条 */}
      <div className="pg-stats">
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--warn)' }}>{stats?.pending ?? '—'}</div>
          <div className="pg-stat-lbl">待处理</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: '#3aa0ff' }}>{stats?.talking ?? '—'}</div>
          <div className="pg-stat-lbl">沟通中</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--green)' }}>{stats?.done ?? '—'}</div>
          <div className="pg-stat-lbl">已完成</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--muted)' }}>{list.length}</div>
          <div className="pg-stat-lbl">当前筛选</div>
        </div>
      </div>

      {/* 状态筛选按钮 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[['', '全部'], ['pending', '待处理'], ['talking', '沟通中'], ['done', '已完成']].map(([v, l]) => (
          <button key={v}
            className={`tool-cat-tab ${filter === v ? 'on' : ''}`}
            onClick={() => load(v)}>{l}
          </button>
        ))}
      </div>

      {/* 需求列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {list.map(r => (
          <div key={r.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {/* 类型图标 */}
            <span style={{ fontSize: 18, flexShrink: 0 }}>{TYPE_ICON[r.type] || '📌'}</span>
            {/* 主信息 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{r.title}</span>
                {r.type && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(124,108,255,.12)', color: 'var(--accent)', fontFamily: 'var(--mono)' }}>{r.type}</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span>{r.name}</span>
                <span>{CONTACT_ICON[r.contactType] || ''} {r.contact}</span>
                <span>{r.budget || '预算待定'}</span>
                <span>{new Date(r.createdAt).toLocaleDateString('zh-CN')}</span>
              </div>
            </div>
            {/* 状态 + 操作 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span className={`st-pill ${STATUS_PILL[r.status] || 'st-pill-muted'}`}>{STATUS_MAP[r.status] || r.status}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => { setDetail(r); setDetailStatus(r.status); setDetailNote(r.adminNote || '') }}>查看</button>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="chart-empty">暂无需求</div>}
      </div>

      {/* 详情弹窗 */}
      {detail && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal modal-lg" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
            <button className="modal-close" onClick={() => setDetail(null)}>×</button>
            <h2><span className="accent-line" /> 需求详情</h2>

            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div><span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>称呼</span><div>{detail.name}</div></div>
                <div><span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>预算</span><div>{detail.budget || '待定'}</div></div>
                <div><span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>联系</span><div style={{ fontFamily: 'var(--mono)', color: 'var(--accent2)' }}>{detail.contact}</div></div>
                <div><span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>时间</span><div>{new Date(detail.createdAt).toLocaleDateString('zh-CN')}</div></div>
              </div>
              <div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>标题</span>
                <div style={{ fontWeight: 500, marginBottom: '0.5rem' }}>{detail.title}</div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>详细描述</span>
                <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.7, marginTop: 4, whiteSpace: 'pre-wrap' }}>{detail.description}</div>
              </div>
            </div>

            <div className="dfg">
              <label>更新状态</label>
              <select value={detailStatus} onChange={e => setDetailStatus(e.target.value)}>
                <option value="pending">待处理</option>
                <option value="talking">沟通中</option>
                <option value="done">已完成</option>
                <option value="rejected">不接受</option>
              </select>
            </div>

            <div className="dfg">
              <label>备注（内部）</label>
              <textarea rows={3} value={detailNote} onChange={e => setDetailNote(e.target.value)}
                style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: 9, borderRadius: 4, fontSize: 16, outline: 'none', resize: 'vertical' }} />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={handleSave}>保存</button>
              <button className="btn btn-danger btn-sm" onClick={handleDelete}>删除</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
