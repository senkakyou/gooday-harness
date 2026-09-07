// =====================================================
// pages/admin/Tickets.jsx —— 工单管理页
// 职责：查看/创建/更新工单，支持状态筛选、优先级标识、详情编辑
// 路由：/admin/tickets
// =====================================================

import React, { useEffect, useState } from 'react'
import {
  listTickets, getTicket, createTicket,
  updateTicket, deleteTicket, getTicketStats
} from '../../api/tickets'
import useToastStore from '../../store/toastStore'
import { confirmDialog } from '../../store/confirmStore'

const STATUS_MAP = {
  pending:          '待确认',
  analyst_complete: '待客户确认报价',
  confirmed:        '已确认待付款',
  in_progress:      '开发中',
  reviewing:        '终审中',
  delivering:       '交付待验收',
  testing:          '测试中',
  done:             '已完成',
  failed:           '失败待处理',
  customer_rejected:'客户拒收',
  refunding:        '退款中',
  refunded:         '已退款',
  cancelled:        '已取消',
}
const STATUS_PILL = {
  pending:          'st-pill-warn',
  analyst_complete: 'st-pill-warn',
  confirmed:        'st-pill-blue',
  in_progress:      'st-pill-blue',
  reviewing:        'st-pill-blue',
  delivering:       'st-pill-blue',
  testing:          'st-pill-warn',
  done:             'st-pill-green',
  failed:           'st-pill-danger',
  customer_rejected:'st-pill-danger',
  refunding:        'st-pill-warn',
  refunded:         'st-pill-muted',
  cancelled:        'st-pill-muted',
}
const PRIORITY_COLOR = {
  urgent: '#ff4d4f',
  high:   '#ff7a00',
  normal: 'var(--muted)',
  low:    'var(--border)',
}
const PRIORITY_LABEL = { urgent: '紧急', high: '高', normal: '普通', low: '低' }
const SOURCE_ICON = { ruyi: '🤖', admin: '👤' }
const CONTACT_ICON = { wechat: '💬', email: '📧', phone: '📱' }

// 新建工单弹窗（空表单）
function CreateModal({ onClose, onCreated }) {
  const toast = useToastStore(s => s.toast)
  const [form, setForm] = useState({
    title: '', description: '', clientName: '', clientContact: '',
    contactType: 'wechat', budget: '', priority: 'normal',
    source: 'admin', adminNote: '', dueAt: '',
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.title.trim()) { toast('请填写工单标题', true); return }
    if (!form.description.trim()) { toast('请填写需求描述', true); return }
    if (!form.clientName.trim()) { toast('请填写客户称呼', true); return }
    setSaving(true)
    try {
      const res = await createTicket({
        title: form.title, description: form.description,
        clientName: form.clientName, clientContact: form.clientContact,
        contactType: form.contactType, budget: form.budget,
        priority: form.priority, source: form.source,
        adminNote: form.adminNote || null,
        dueAt: form.dueAt || null,
        clientId: null, devRequestId: null,
      })
      toast(`工单已创建：${res.ticketNo}`)
      onCreated()
    } catch (e) { toast(e.message || '创建失败', true) }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2><span className="accent-line" /> 新建工单</h2>

        <div className="dfg">
          <label>工单标题 *</label>
          <input className="input" value={form.title} onChange={e => set('title', e.target.value)}
            placeholder="简洁描述需求主题" style={{ fontSize: 16 }} />
        </div>
        <div className="dfg">
          <label>需求描述 *</label>
          <textarea rows={4} value={form.description} onChange={e => set('description', e.target.value)}
            placeholder="详细描述客户需求" style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: 9, borderRadius: 4, fontSize: 16, outline: 'none', resize: 'vertical' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div className="dfg">
            <label>客户称呼 *</label>
            <input className="input" value={form.clientName} onChange={e => set('clientName', e.target.value)}
              placeholder="如：张先生" style={{ fontSize: 16 }} />
          </div>
          <div className="dfg">
            <label>联系方式</label>
            <input className="input" value={form.clientContact} onChange={e => set('clientContact', e.target.value)}
              placeholder="微信号/手机/邮箱" style={{ fontSize: 16 }} />
          </div>
          <div className="dfg">
            <label>联系类型</label>
            <select value={form.contactType} onChange={e => set('contactType', e.target.value)}>
              <option value="wechat">微信</option>
              <option value="phone">手机</option>
              <option value="email">邮箱</option>
            </select>
          </div>
          <div className="dfg">
            <label>预算区间</label>
            <input className="input" value={form.budget} onChange={e => set('budget', e.target.value)}
              placeholder="如：1000-3000" style={{ fontSize: 16 }} />
          </div>
          <div className="dfg">
            <label>优先级</label>
            <select value={form.priority} onChange={e => set('priority', e.target.value)}>
              <option value="low">低</option>
              <option value="normal">普通</option>
              <option value="high">高</option>
              <option value="urgent">紧急</option>
            </select>
          </div>
          <div className="dfg">
            <label>截止日期</label>
            <input type="date" className="input" value={form.dueAt} onChange={e => set('dueAt', e.target.value)}
              style={{ fontSize: 16 }} />
          </div>
        </div>
        <div className="dfg">
          <label>内部备注</label>
          <textarea rows={2} value={form.adminNote} onChange={e => set('adminNote', e.target.value)}
            placeholder="客户不可见的内部说明" style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: 9, borderRadius: 4, fontSize: 16, outline: 'none', resize: 'vertical' }} />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={saving}>
            {saving ? '创建中…' : '创建工单'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  )
}

// 详情/编辑弹窗
function DetailModal({ ticketId, onClose, onUpdated }) {
  const toast = useToastStore(s => s.toast)
  const [ticket, setTicket] = useState(null)
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [note, setNote] = useState('')
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getTicket(ticketId).then(t => {
      setTicket(t)
      setStatus(t.status)
      setPriority(t.priority)
      setNote(t.adminNote || '')
      setPrice(t.estimatedPrice != null ? String(t.estimatedPrice) : '')
    }).catch(() => toast('加载失败', true))
  }, [ticketId])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateTicket(ticketId, {
        status,
        priority,
        adminNote: note,
        estimatedPrice: price !== '' ? parseFloat(price) : null,
      })
      toast('已保存')
      onUpdated()
    } catch (e) { toast(e.message || '保存失败', true) }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!await confirmDialog(`确认删除工单 ${ticket?.ticketNo}？`, { danger: true, confirmText: '删除' })) return
    try {
      await deleteTicket(ticketId)
      toast('已删除')
      onUpdated()
    } catch (e) { toast(e.message || '删除失败', true) }
  }

  if (!ticket) return (
    <div className="modal-overlay">
      <div className="modal" style={{ textAlign: 'center', padding: '2rem' }}>加载中…</div>
    </div>
  )

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2>
          <span className="accent-line" />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)', marginRight: 8 }}>{ticket.ticketNo}</span>
          {ticket.title}
        </h2>

        {/* 基本信息块 */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>客户</div>
              <div>{ticket.clientName}</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>联系</div>
              <div style={{ fontFamily: 'var(--mono)', color: 'var(--accent2)' }}>
                {CONTACT_ICON[ticket.contactType] || ''} {ticket.clientContact || '—'}
              </div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>预算</div>
              <div>{ticket.budget || '待定'}</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>来源</div>
              <div>{SOURCE_ICON[ticket.source] || ''} {ticket.source === 'ruyi' ? '如意生成' : '手动创建'}</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>创建时间</div>
              <div>{new Date(ticket.createdAt).toLocaleString('zh-CN')}</div>
            </div>
            {ticket.dueAt && (
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>截止日期</div>
                <div>{new Date(ticket.dueAt).toLocaleDateString('zh-CN')}</div>
              </div>
            )}
          </div>
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>需求描述</div>
            <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{ticket.description}</div>
          </div>
        </div>

        {/* 可编辑字段 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div className="dfg">
            <label>状态</label>
            <select value={status} onChange={e => setStatus(e.target.value)}>
              {Object.entries(STATUS_MAP).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="dfg">
            <label>优先级</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}>
              {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        <div className="dfg">
          <label>报价（元）</label>
          <input className="input" type="number" value={price} onChange={e => setPrice(e.target.value)}
            placeholder="留空表示未报价" style={{ fontSize: 16 }} />
        </div>

        <div className="dfg">
          <label>内部备注</label>
          <textarea rows={3} value={note} onChange={e => setNote(e.target.value)}
            style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: 9, borderRadius: 4, fontSize: 16, outline: 'none', resize: 'vertical' }} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>删除</button>
        </div>
      </div>
    </div>
  )
}

// ---- 主页面 ----
export default function Tickets() {
  const toast = useToastStore(s => s.toast)
  const [list, setList] = useState([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState('')
  const [stats, setStats] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = (status) => {
    setFilter(status)
    listTickets({ status: status || undefined, pageSize: 50 })
      .then(data => { setList(data.list); setTotal(data.total) })
      .catch(() => {})
  }

  useEffect(() => {
    load('')
    getTicketStats().then(setStats).catch(() => {})
  }, [])

  const handleRefresh = () => {
    load(filter)
    getTicketStats().then(setStats).catch(() => {})
  }

  const handleDetailClose = () => { setDetailId(null) }
  const handleDetailUpdated = () => { setDetailId(null); handleRefresh() }
  const handleCreateClose = () => setShowCreate(false)
  const handleCreated = () => { setShowCreate(false); handleRefresh() }

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h2 className="admin-page-title">工单管理</h2>
          <div className="admin-page-sub">定制开发工单全生命周期跟踪</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>+ 新建工单</button>
      </div>

      {/* 统计条 */}
      <div className="pg-stats">
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--warn)' }}>{stats?.pending ?? '—'}</div>
          <div className="pg-stat-lbl">待确认</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: '#3aa0ff' }}>{stats?.confirmed ?? '—'}</div>
          <div className="pg-stat-lbl">已确认</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--accent)' }}>{stats?.inProgress ?? '—'}</div>
          <div className="pg-stat-lbl">进行中</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--green)' }}>{stats?.done ?? '—'}</div>
          <div className="pg-stat-lbl">已完成</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--muted)' }}>{total}</div>
          <div className="pg-stat-lbl">当前筛选</div>
        </div>
      </div>

      {/* 状态筛选 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[
          ['', '全部'],
          ['pending', '待确认'],
          ['analyst_complete', '待客户确认报价'],
          ['confirmed', '已确认待付款'],
          ['in_progress', '开发中'],
          ['delivering', '交付待验收'],
          ['done', '已完成'],
          ['failed', '失败待处理'],
          ['customer_rejected', '客户拒收'],
          ['refunding', '退款中'],
          ['refunded', '已退款'],
          ['cancelled', '已取消'],
        ].map(([v, l]) => (
          <button key={v}
            className={`tool-cat-tab ${filter === v ? 'on' : ''}`}
            onClick={() => load(v)}>{l}
          </button>
        ))}
      </div>

      {/* 工单列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {list.map(t => (
          <div key={t.id} style={{
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '0.75rem 1rem',
            display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
            borderLeft: `3px solid ${PRIORITY_COLOR[t.priority] || 'var(--border)'}`,
          }}>
            {/* 来源图标 */}
            <span style={{ fontSize: 16, flexShrink: 0 }}>{SOURCE_ICON[t.source] || '📋'}</span>

            {/* 主信息 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>{t.ticketNo}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{t.title}</span>
                {t.priority !== 'normal' && (
                  <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: `${PRIORITY_COLOR[t.priority]}22`, color: PRIORITY_COLOR[t.priority], fontWeight: 600 }}>
                    {PRIORITY_LABEL[t.priority]}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span>{t.clientName}</span>
                <span>{CONTACT_ICON[t.contactType] || ''} {t.clientContact || '—'}</span>
                <span>{t.budget || '预算待定'}</span>
                <span>{new Date(t.createdAt).toLocaleDateString('zh-CN')}</span>
                {t.dueAt && <span style={{ color: 'var(--warn)' }}>截止 {new Date(t.dueAt).toLocaleDateString('zh-CN')}</span>}
              </div>
            </div>

            {/* 状态 + 操作 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span className={`st-pill ${STATUS_PILL[t.status] || 'st-pill-muted'}`}>{STATUS_MAP[t.status] || t.status}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setDetailId(t.id)}>查看</button>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="chart-empty">暂无工单</div>}
      </div>

      {/* 弹窗 */}
      {showCreate && <CreateModal onClose={handleCreateClose} onCreated={handleCreated} />}
      {detailId && <DetailModal ticketId={detailId} onClose={handleDetailClose} onUpdated={handleDetailUpdated} />}
    </>
  )
}
