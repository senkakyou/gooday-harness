// =====================================================
// pages/admin/Clients.jsx —— 客户档案管理页
// 路由：/admin/clients
// 职责：客户档案 CRUD、工单历史、AI 画像摘要展示与编辑
// =====================================================

import React, { useEffect, useState } from 'react'
import {
  listClients, getClient, createClient,
  updateClient, deleteClient, getClientStats
} from '../../api/clients'
import useToastStore from '../../store/toastStore'
import { confirmDialog } from '../../store/confirmStore'

// 订单状态文案。【只管怎么显示】——状态本身的真源在
// services/api/src/Services/TicketWorkflow.cs，这里多一个少一个都用 || 兜底。
const ORDER_STATUS = {
  NEW: '待接单', IN_PROGRESS: '开发中', DELIVERED: '待验收',
  CLOSED: '已结单', BLOCKED: '卡住了', CANCELLED: '已取消',
}
// 药丸配色。【这一处曾经漏改】：原来写 t.status === 'done'，
// 而 check.py 的「旧小写状态」判据【故意排除了 done/cancelled】（太通用，一查全是误报）——
// 也就是说这一类漏改它永远查不到。别把那条判据当网使。
const ORDER_PILL = {
  CLOSED: 'st-pill-green', CANCELLED: 'st-pill-muted', BLOCKED: 'st-pill-danger',
}

const STATUS_MAP = {
  prospect: '潜在',
  active:   '合作中',
  vip:      'VIP',
  inactive: '已流失',
}
const STATUS_COLOR = {
  prospect: 'var(--muted)',
  active:   'var(--accent)',
  vip:      '#f5a623',
  inactive: 'var(--border)',
}
const STATUS_PILL = {
  prospect: 'st-pill-muted',
  active:   'st-pill-blue',
  vip:      'st-pill-warn',
  inactive: 'st-pill-muted',
}
const CONTACT_ICON = { wechat: '💬', email: '📧', phone: '📱', unknown: '❓' }
const SOURCE_ICON  = { ruyi: '🤖', admin: '👤', form: '📝' }
const DECISION_MAP = { fast: '爽快拍板', slow: '需反复确认', committee: '要请示领导' }
const TECH_MAP     = { none: '完全不懂', basic: '基础认知', medium: '中等', pro: '专业' }

// ---- 新建/编辑弹窗 ----
function ClientFormModal({ initial, onClose, onSaved }) {
  const toast = useToastStore(s => s.toast)
  const isEdit = !!initial?.id
  const [form, setForm] = useState({
    name: '', contact: '', contactType: 'wechat',
    status: 'prospect', tags: '', budget: '',
    preferredContact: '', decisionStyle: '', techLevel: '',
    preferredStyle: '', adminNote: '',
    ...(initial || {}),
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast('客户称呼不能为空', true); return }
    setSaving(true)
    try {
      if (isEdit) {
        await updateClient(initial.id, form)
        toast('档案已更新')
      } else {
        await createClient({ ...form, source: 'admin' })
        toast('客户已建档')
      }
      onSaved()
    } catch (e) { toast(e.message || '操作失败', true) }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2><span className="accent-line" /> {isEdit ? '编辑客户档案' : '新建客户档案'}</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div className="dfg">
            <label>客户称呼 *</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="如：张先生" style={{ fontSize: 16 }} />
          </div>
          <div className="dfg">
            <label>状态</label>
            <select value={form.status} onChange={e => set('status', e.target.value)}>
              {Object.entries(STATUS_MAP).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="dfg">
            <label>联系方式</label>
            <input className="input" value={form.contact} onChange={e => set('contact', e.target.value)}
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
            <input className="input" value={form.budget || ''} onChange={e => set('budget', e.target.value)}
              placeholder="如：500-2000" style={{ fontSize: 16 }} />
          </div>
          <div className="dfg">
            <label>标签</label>
            <input className="input" value={form.tags || ''} onChange={e => set('tags', e.target.value)}
              placeholder="逗号分隔，如：小程序,急单" style={{ fontSize: 16 }} />
          </div>
          <div className="dfg">
            <label>决策风格</label>
            <select value={form.decisionStyle || ''} onChange={e => set('decisionStyle', e.target.value)}>
              <option value="">未知</option>
              <option value="fast">爽快拍板</option>
              <option value="slow">需反复确认</option>
              <option value="committee">要请示领导</option>
            </select>
          </div>
          <div className="dfg">
            <label>技术认知</label>
            <select value={form.techLevel || ''} onChange={e => set('techLevel', e.target.value)}>
              <option value="">未知</option>
              <option value="none">完全不懂</option>
              <option value="basic">基础认知</option>
              <option value="medium">中等</option>
              <option value="pro">专业</option>
            </select>
          </div>
        </div>

        <div className="dfg">
          <label>沟通风格偏好</label>
          <input className="input" value={form.preferredStyle || ''} onChange={e => set('preferredStyle', e.target.value)}
            placeholder="如：简洁说重点、要有案例" style={{ fontSize: 16 }} />
        </div>
        <div className="dfg">
          <label>偏好沟通方式</label>
          <input className="input" value={form.preferredContact || ''} onChange={e => set('preferredContact', e.target.value)}
            placeholder="如：微信/电话/平台私信" style={{ fontSize: 16 }} />
        </div>
        <div className="dfg">
          <label>内部备注（用户不可见）</label>
          <textarea rows={3} value={form.adminNote || ''} onChange={e => set('adminNote', e.target.value)}
            placeholder="站长手工备注，AI 不会覆盖此字段"
            style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: 9, borderRadius: 4, fontSize: 16, outline: 'none', resize: 'vertical' }} />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={saving}>
            {saving ? '保存中…' : (isEdit ? '保存' : '建档')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  )
}

// ---- 客户详情面板 ----
function ClientDetailPanel({ clientId, onClose, onUpdated }) {
  const toast = useToastStore(s => s.toast)
  const [data, setData] = useState(null)
  const [showEdit, setShowEdit] = useState(false)

  const load = () => {
    getClient(clientId)
      .then(setData)
      .catch(() => toast('加载失败', true))
  }

  useEffect(() => { load() }, [clientId])

  const handleDelete = async () => {
    if (!await confirmDialog(`确认删除客户「${data?.name}」的档案？`, { danger: true, confirmText: '删除' })) return
    try {
      await deleteClient(clientId)
      toast('已删除')
      onUpdated()
    } catch (e) { toast(e.message || '删除失败', true) }
  }

  if (!data) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>
      加载中…
    </div>
  )

  const { tickets = [], stats = {} } = data

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* 顶部操作栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, flex: 1, padding: 0, minWidth: 0 }}>
          <span style={{ color: 'var(--muted)', fontSize: 26, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>‹</span>
          <div style={{ minWidth: 0, textAlign: 'left' }}>
            <div style={{ fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.name}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {SOURCE_ICON[data.source]} {data.source === 'ruyi' ? '如意引流' : data.source === 'form' ? '表单提交' : '手动建档'}
              &nbsp;·&nbsp;建档 {new Date(data.createdAt).toLocaleDateString('zh-CN')}
            </div>
          </div>
        </button>
        <span className={`st-pill ${STATUS_PILL[data.status] || 'st-pill-muted'}`} style={{ flexShrink: 0 }}>{STATUS_MAP[data.status] || data.status}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowEdit(true)} style={{ flexShrink: 0 }}>编辑</button>
        <button className="btn btn-danger btn-sm" onClick={handleDelete} style={{ flexShrink: 0 }}>删除</button>
      </div>

      {/* 统计行 */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {[
          { label: '总工单', value: stats.ticketTotal ?? 0, color: 'var(--accent)' },
          { label: '已完成', value: stats.ticketDone ?? 0, color: 'var(--green)' },
          { label: '总金额', value: stats.totalAmount ? `¥${stats.totalAmount}` : '—', color: 'var(--warn)' },
        ].map(s => (
          <div key={s.label} style={{ textAlign: 'center', minWidth: 64 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* 基本信息 */}
      <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.875rem' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>基本信息</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: 13 }}>
          <div><span style={{ color: 'var(--muted)' }}>联系：</span>{CONTACT_ICON[data.contactType]} {data.contact || '—'}</div>
          <div><span style={{ color: 'var(--muted)' }}>预算：</span>{data.budget || '未知'}</div>
          {data.tags && <div style={{ gridColumn: '1/-1' }}><span style={{ color: 'var(--muted)' }}>标签：</span>
            {data.tags.split(',').map(t => (
              <span key={t} style={{ background: 'var(--accent)22', color: 'var(--accent)', padding: '1px 6px', borderRadius: 4, fontSize: 11, marginRight: 4 }}>{t.trim()}</span>
            ))}
          </div>}
          {data.lastActiveAt && <div style={{ gridColumn: '1/-1' }}><span style={{ color: 'var(--muted)' }}>最后活跃：</span>{new Date(data.lastActiveAt).toLocaleString('zh-CN')}</div>}
        </div>
      </div>

      {/* 偏好画像 */}
      {(data.decisionStyle || data.techLevel || data.preferredStyle || data.preferredContact) && (
        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.875rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>偏好画像</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: 13 }}>
            {data.decisionStyle && <div><span style={{ color: 'var(--muted)' }}>决策：</span>{DECISION_MAP[data.decisionStyle] || data.decisionStyle}</div>}
            {data.techLevel && <div><span style={{ color: 'var(--muted)' }}>技术：</span>{TECH_MAP[data.techLevel] || data.techLevel}</div>}
            {data.preferredContact && <div><span style={{ color: 'var(--muted)' }}>偏好联系：</span>{data.preferredContact}</div>}
            {data.preferredStyle && <div style={{ gridColumn: '1/-1' }}><span style={{ color: 'var(--muted)' }}>沟通风格：</span>{data.preferredStyle}</div>}
          </div>
        </div>
      )}

      {/* AI 画像摘要 */}
      {data.aiSummary && (
        <div style={{ background: 'linear-gradient(135deg, #1a1a2e22, #16213e22)', border: '1px solid var(--accent)44', borderRadius: 8, padding: '0.875rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span>🤖</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>AI 画像摘要</span>
            {data.aiSummaryUpdatedAt && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>
                {new Date(data.aiSummaryUpdatedAt).toLocaleDateString('zh-CN')} 更新
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{data.aiSummary}</div>
        </div>
      )}

      {/* 内部备注 */}
      {data.adminNote && (
        <div style={{ background: 'var(--warn)11', border: '1px solid var(--warn)44', borderRadius: 8, padding: '0.875rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--warn)', marginBottom: 6 }}>📝 站长备注</div>
          <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{data.adminNote}</div>
        </div>
      )}

      {/* 工单历史 */}
      <div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>工单历史（{tickets.length} 条）</div>
        {tickets.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12 }}>暂无工单</div>}
        {tickets.map(t => (
          <div key={t.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.6rem 0.875rem', marginBottom: 6, fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>{t.ticketNo}</span>
              <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
              <span className={`st-pill ${ORDER_PILL[t.status] || 'st-pill-blue'}`} style={{ fontSize: 10 }}>
                {ORDER_STATUS[t.status] || t.status}
              </span>
            </div>
            <div style={{ color: 'var(--muted)', display: 'flex', gap: 8 }}>
              <span>{new Date(t.createdAt).toLocaleDateString('zh-CN')}</span>
              {t.budget && <span>预算 {t.budget}</span>}
              {t.estimatedPrice != null && <span style={{ color: 'var(--green)' }}>报价 ¥{t.estimatedPrice}</span>}
            </div>
          </div>
        ))}
      </div>

      {showEdit && (
        <ClientFormModal
          initial={data}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load(); onUpdated?.() }}
        />
      )}
    </div>
  )
}

// ---- 主页面 ----
export default function Clients() {
  const toast = useToastStore(s => s.toast)
  const [list, setList] = useState([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState('')
  const [q, setQ] = useState('')
  const [stats, setStats] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640)

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const load = (status, search) => {
    const nextStatus = status !== undefined ? status : filter
    const nextQ = search !== undefined ? search : q
    setFilter(nextStatus)
    listClients({ status: nextStatus || undefined, q: nextQ || undefined, pageSize: 80 })
      .then(data => { setList(data.list); setTotal(data.total) })
      .catch(() => {})
  }

  const loadStats = () => {
    getClientStats().then(setStats).catch(() => {})
  }

  useEffect(() => {
    load('', '')
    loadStats()
  }, [])

  const handleRefresh = () => { load(filter, q); loadStats() }

  // 手机端查看详情时，整页替换为详情面板
  if (isMobile && selectedId) {
    return (
      <ClientDetailPanel
        key={selectedId}
        clientId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdated={() => { setSelectedId(null); handleRefresh() }}
      />
    )
  }

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h2 className="admin-page-title">客户档案</h2>
          <div className="admin-page-sub">定制开发客户信息、偏好画像、合作历史</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>+ 新建档案</button>
      </div>

      {/* 统计条 */}
      <div className="pg-stats">
        {[
          { label: '潜在', key: 'prospect', color: 'var(--muted)' },
          { label: '合作中', key: 'active',   color: 'var(--accent)' },
          { label: 'VIP',   key: 'vip',      color: '#f5a623' },
          { label: '已流失', key: 'inactive', color: 'var(--border)' },
          { label: '全部',   key: 'total',    color: 'var(--text)' },
        ].map(s => (
          <div key={s.key} className="pg-stat-item">
            <div className="pg-stat-num" style={{ color: s.color }}>{stats?.[s.key] ?? '—'}</div>
            <div className="pg-stat-lbl">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 搜索 + 筛选 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load(filter, q)}
          placeholder="搜索姓名/联系方式/标签…" style={{ fontSize: 16, flex: '1 1 180px', maxWidth: 280 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => load(filter, q)}>搜索</button>
        {[['', '全部'], ['prospect', '潜在'], ['active', '合作中'], ['vip', 'VIP'], ['inactive', '已流失']].map(([v, l]) => (
          <button key={v} className={`tool-cat-tab ${filter === v ? 'on' : ''}`} onClick={() => load(v, q)}>{l}</button>
        ))}
      </div>

      {/* 手机：列表全屏（详情已在上方 early return 处理）；PC：左右分栏 */}
      {isMobile ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {list.length === 0 && <div className="chart-empty">暂无客户档案</div>}
            {list.map(c => (
              <div key={c.id} onClick={() => setSelectedId(c.id)}
                style={{
                  padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                  borderLeft: `3px solid ${STATUS_COLOR[c.status] || 'var(--border)'}`,
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 13 }}>{SOURCE_ICON[c.source] || '👤'}</span>
                  <span style={{ fontWeight: 600, fontSize: 14, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  <span className={`st-pill ${STATUS_PILL[c.status] || 'st-pill-muted'}`} style={{ fontSize: 10 }}>{STATUS_MAP[c.status] || c.status}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 8 }}>
                  <span>{CONTACT_ICON[c.contactType]} {c.contact || '—'}</span>
                  {c.budget && <span>{c.budget}</span>}
                  {c.tags && <span>🏷 {c.tags.split(',').slice(0, 2).join(' ')}</span>}
                </div>
                {c.aiSummary && (
                  <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    🤖 {c.aiSummary.substring(0, 60)}…
                  </div>
                )}
              </div>
            ))}
          </div>
      ) : (
        <div style={{ display: 'flex', gap: '1rem', minHeight: 400, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {/* 左侧列表 */}
          <div style={{ width: selectedId ? 300 : '100%', flexShrink: 0, overflowY: 'auto', borderRight: selectedId ? '1px solid var(--border)' : 'none' }}>
            {list.length === 0 && <div className="chart-empty">暂无客户档案</div>}
            {list.map(c => (
              <div key={c.id} onClick={() => setSelectedId(c.id)}
                style={{
                  padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                  background: selectedId === c.id ? 'var(--surface2)' : 'transparent',
                  transition: 'background 0.15s',
                  borderLeft: `3px solid ${STATUS_COLOR[c.status] || 'var(--border)'}`,
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 13 }}>{SOURCE_ICON[c.source] || '👤'}</span>
                  <span style={{ fontWeight: 600, fontSize: 14, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  <span className={`st-pill ${STATUS_PILL[c.status] || 'st-pill-muted'}`} style={{ fontSize: 10 }}>{STATUS_MAP[c.status] || c.status}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 8 }}>
                  <span>{CONTACT_ICON[c.contactType]} {c.contact || '—'}</span>
                  {c.budget && <span>{c.budget}</span>}
                  {c.tags && <span>🏷 {c.tags.split(',').slice(0, 2).join(' ')}</span>}
                </div>
                {c.aiSummary && (
                  <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    🤖 {c.aiSummary.substring(0, 60)}…
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 右侧详情 */}
          {selectedId && (
            <ClientDetailPanel
              key={selectedId}
              clientId={selectedId}
              onClose={() => setSelectedId(null)}
              onUpdated={() => { setSelectedId(null); handleRefresh() }}
            />
          )}
        </div>
      )}

      {/* 弹窗 */}
      {showCreate && (
        <ClientFormModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); handleRefresh() }}
        />
      )}
    </>
  )
}
