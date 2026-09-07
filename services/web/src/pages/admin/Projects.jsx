import React, { useEffect, useState } from 'react'
import {
  listProjects, getProject, createProject, updateProject, deleteProject,
  getProjectStats, projectFromTicket, listDecisions, createDecision, deleteDecision,
  listTasks, createTask, updateTask, deleteTask,
} from '../../api/projects'
import useToastStore from '../../store/toastStore'
import { confirmDialog } from '../../store/confirmStore'

const STATUS_MAP = {
  planning:    '规划中',
  in_progress: '进行中',
  testing:     '测试中',
  done:        '已完成',
  cancelled:   '已取消',
}
const STATUS_PILL = {
  planning:    'st-pill-muted',
  in_progress: 'st-pill-blue',
  testing:     'st-pill-warn',
  done:        'st-pill-green',
  cancelled:   'st-pill-muted',
}
const STATUS_COLOR = {
  planning:    'var(--muted)',
  in_progress: 'var(--accent)',
  testing:     '#f5a623',
  done:        '#52c41a',
  cancelled:   'var(--border)',
}
const DECISION_TYPE_MAP = {
  pricing: '定价',
  scope:   '需求范围',
  tech:    '技术方案',
  reject:  '拒绝',
  other:   '其他',
}

// ---- 新建项目弹窗 ----
function CreateModal({ onClose, onCreated }) {
  const toast = useToastStore(s => s.toast)
  const [form, setForm] = useState({
    title: '', description: '', ticketId: '', clientId: '',
    budget: '', quotedPrice: '', adminNote: '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.title.trim()) { toast('请填写项目标题', true); return }
    setSaving(true)
    try {
      await createProject({
        title: form.title,
        description: form.description,
        ticketId: form.ticketId ? parseInt(form.ticketId) : null,
        clientId: form.clientId ? parseInt(form.clientId) : null,
        budget: form.budget ? parseFloat(form.budget) : null,
        quotedPrice: form.quotedPrice ? parseFloat(form.quotedPrice) : null,
        adminNote: form.adminNote || null,
      })
      toast('项目已创建')
      onCreated()
    } catch (e) { toast(e.response?.data?.message || e.message || '创建失败', true) }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2><span className="accent-line" /> 新建项目</h2>
        <div className="dfg">
          <label>项目标题 *</label>
          <input className="input" value={form.title} onChange={e => set('title', e.target.value)}
            placeholder="项目名称" style={{ fontSize: 16 }} />
        </div>
        <div className="dfg">
          <label>描述</label>
          <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)}
            placeholder="项目描述"
            style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: 9, borderRadius: 4, fontSize: 16, outline: 'none', resize: 'vertical' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div className="dfg">
            <label>关联工单 ID</label>
            <input className="input" value={form.ticketId} onChange={e => set('ticketId', e.target.value)}
              placeholder="可选" style={{ fontSize: 16 }} />
          </div>
          <div className="dfg">
            <label>关联客户 ID</label>
            <input className="input" value={form.clientId} onChange={e => set('clientId', e.target.value)}
              placeholder="可选" style={{ fontSize: 16 }} />
          </div>
          <div className="dfg">
            <label>客户预算（元）</label>
            <input className="input" type="number" value={form.budget} onChange={e => set('budget', e.target.value)}
              placeholder="可选" style={{ fontSize: 16 }} />
          </div>
          <div className="dfg">
            <label>对客报价（元）</label>
            <input className="input" type="number" value={form.quotedPrice} onChange={e => set('quotedPrice', e.target.value)}
              placeholder="可选" style={{ fontSize: 16 }} />
          </div>
        </div>
        <div className="dfg">
          <label>内部备注</label>
          <input className="input" value={form.adminNote} onChange={e => set('adminNote', e.target.value)}
            placeholder="可选" style={{ fontSize: 16 }} />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn-ghost" onClick={onClose}>取消</button>
          <button className="btn" onClick={handleSubmit} disabled={saving}>{saving ? '创建中…' : '确认创建'}</button>
        </div>
      </div>
    </div>
  )
}

// ---- 项目详情弹窗 ----
function DetailModal({ projectId, onClose, onUpdated }) {
  const toast = useToastStore(s => s.toast)
  const [data, setData] = useState(null)
  const [decisions, setDecisions] = useState([])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [addingDecision, setAddingDecision] = useState(false)
  const [decisionForm, setDecisionForm] = useState({ content: '', rationale: '', decisionType: 'other' })
  const [fromTicketId, setFromTicketId] = useState('')
  const [tasks, setTasks] = useState([])
  const [newTaskTitle, setNewTaskTitle] = useState('')

  const loadTasks = async () => {
    try { setTasks(await listTasks(projectId)) } catch { /* ignore */ }
  }

  const load = async () => {
    try {
      const res = await getProject(projectId)
      setData(res.project)
      setDecisions(res.decisions || [])
      setForm({
        title: res.project.title,
        description: res.project.description,
        status: res.project.status,
        budget: res.project.budget ?? '',
        quotedPrice: res.project.quotedPrice ?? '',
        actualCost: res.project.actualCost ?? '',
        actualRevenue: res.project.actualRevenue ?? '',
        adminNote: res.project.adminNote ?? '',
        deliveryNotes: res.project.deliveryNotes ?? '',
        startDate: res.project.startDate ? res.project.startDate.slice(0, 10) : '',
        endDate: res.project.endDate ? res.project.endDate.slice(0, 10) : '',
      })
    } catch { toast('加载失败', true) }
  }
  useEffect(() => { load(); loadTasks() }, [projectId])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateProject(projectId, {
        ...form,
        budget: form.budget !== '' ? parseFloat(form.budget) : null,
        quotedPrice: form.quotedPrice !== '' ? parseFloat(form.quotedPrice) : null,
        actualCost: form.actualCost !== '' ? parseFloat(form.actualCost) : null,
        actualRevenue: form.actualRevenue !== '' ? parseFloat(form.actualRevenue) : null,
      })
      toast('已保存')
      setEditing(false)
      load()
      onUpdated()
    } catch (e) { toast(e.response?.data?.message || '保存失败', true) }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!await confirmDialog('确认删除这个项目？此操作不可撤销。')) return
    try {
      await deleteProject(projectId)
      toast('已删除')
      onClose()
      onUpdated()
    } catch (e) { toast(e.response?.data?.message || '删除失败', true) }
  }

  const handleFromTicket = async () => {
    const tid = parseInt(fromTicketId)
    if (!tid) { toast('请输入工单 ID', true); return }
    try {
      const res = await projectFromTicket(tid)
      toast(res.message || '项目已创建')
      onClose()
      onUpdated()
    } catch (e) { toast(e.response?.data?.message || '转化失败', true) }
  }

  const handleAddDecision = async () => {
    if (!decisionForm.content.trim()) { toast('请填写决策内容', true); return }
    try {
      await createDecision({ ...decisionForm, projectId })
      toast('决策已记录')
      setAddingDecision(false)
      setDecisionForm({ content: '', rationale: '', decisionType: 'other' })
      load()
    } catch (e) { toast(e.response?.data?.message || '记录失败', true) }
  }

  const handleDeleteDecision = async (id) => {
    if (!await confirmDialog('删除这条决策记录？')) return
    try {
      await deleteDecision(id)
      load()
    } catch { toast('删除失败', true) }
  }

  if (!data) return (
    <div className="modal-overlay">
      <div className="modal" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>加载中…</div>
    </div>
  )

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ maxHeight: '92vh', overflowY: 'auto' }}>
        <button className="modal-close" onClick={onClose}>×</button>

        {/* 标题 + 状态 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}><span className="accent-line" />{data.title}</h2>
          <span className={`st-pill ${STATUS_PILL[data.status]}`}>{STATUS_MAP[data.status]}</span>
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
          ID #{data.id}
          {data.ticket && <span> · 工单 {data.ticket.ticketNo}</span>}
          {data.client && <span> · 客户 {data.client.name}</span>}
          {data.assignee && <span> · 负责人 {data.assignee.username}</span>}
          <span> · 创建 {data.createdAt?.slice(0, 10)}</span>
        </div>

        {editing ? (
          /* ---- 编辑模式 ---- */
          <>
            <div className="dfg">
              <label>项目标题</label>
              <input className="input" value={form.title} onChange={e => set('title', e.target.value)} style={{ fontSize: 16 }} />
            </div>
            <div className="dfg">
              <label>描述</label>
              <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)}
                style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: 9, borderRadius: 4, fontSize: 16, outline: 'none', resize: 'vertical' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="dfg">
                <label>状态</label>
                <select className="input" value={form.status} onChange={e => set('status', e.target.value)} style={{ fontSize: 16 }}>
                  {Object.entries(STATUS_MAP).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="dfg">
                <label>客户预算（元）</label>
                <input className="input" type="number" value={form.budget} onChange={e => set('budget', e.target.value)} style={{ fontSize: 16 }} />
              </div>
              <div className="dfg">
                <label>对客报价（元）</label>
                <input className="input" type="number" value={form.quotedPrice} onChange={e => set('quotedPrice', e.target.value)} style={{ fontSize: 16 }} />
              </div>
              <div className="dfg">
                <label>实际成本（元）</label>
                <input className="input" type="number" value={form.actualCost} onChange={e => set('actualCost', e.target.value)} style={{ fontSize: 16 }} />
              </div>
              <div className="dfg">
                <label>实际到账（元）</label>
                <input className="input" type="number" value={form.actualRevenue} onChange={e => set('actualRevenue', e.target.value)} style={{ fontSize: 16 }} />
              </div>
              <div className="dfg">
                <label>开始日期</label>
                <input className="input" type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} style={{ fontSize: 16 }} />
              </div>
              <div className="dfg">
                <label>完成日期</label>
                <input className="input" type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)} style={{ fontSize: 16 }} />
              </div>
            </div>
            <div className="dfg">
              <label>交付说明</label>
              <textarea rows={2} value={form.deliveryNotes} onChange={e => set('deliveryNotes', e.target.value)}
                style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: 9, borderRadius: 4, fontSize: 16, outline: 'none', resize: 'vertical' }} />
            </div>
            <div className="dfg">
              <label>内部备注</label>
              <input className="input" value={form.adminNote} onChange={e => set('adminNote', e.target.value)} style={{ fontSize: 16 }} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setEditing(false)}>取消</button>
              <button className="btn" onClick={handleSave} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
            </div>
          </>
        ) : (
          /* ---- 只读模式 ---- */
          <>
            <div style={{ background: 'var(--surface)', padding: '12px 14px', borderRadius: 8, marginBottom: 14, fontSize: 14, color: 'var(--text-soft)', lineHeight: 1.7 }}>
              {data.description || <span style={{ color: 'var(--muted)' }}>暂无描述</span>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: 14 }}>
              {[
                ['预算', data.budget != null ? `¥${data.budget}` : '—'],
                ['报价', data.quotedPrice != null ? `¥${data.quotedPrice}` : '—'],
                ['成本', data.actualCost != null ? `¥${data.actualCost}` : '—'],
                ['到账', data.actualRevenue != null ? `¥${data.actualRevenue}` : '—'],
                ['开始', data.startDate?.slice(0, 10) || '—'],
                ['完成', data.endDate?.slice(0, 10) || '—'],
              ].map(([l, v]) => (
                <div key={l} style={{ background: 'var(--surface)', padding: '8px 12px', borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{l}</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{v}</div>
                </div>
              ))}
            </div>

            {data.deliveryNotes && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>交付说明</div>
                <div style={{ fontSize: 14, color: 'var(--text-soft)' }}>{data.deliveryNotes}</div>
              </div>
            )}
            {data.adminNote && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>内部备注</div>
                <div style={{ fontSize: 14, color: 'var(--text-soft)' }}>{data.adminNote}</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => setEditing(true)}>编辑</button>
              <button className="btn-ghost" style={{ color: '#ff4d4f' }} onClick={handleDelete}>删除</button>
            </div>
          </>
        )}

        {/* ---- 子任务列表 ---- */}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>
              执行任务
              {tasks.length > 0 && (
                <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>
                  {tasks.filter(t => t.status === 'done').length}/{tasks.length} 完成
                </span>
              )}
            </h3>
          </div>

          {tasks.length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: 14, textAlign: 'center', padding: '8px 0 4px' }}>暂无任务（擎天柱分析工单后自动生成）</div>
          )}

          {tasks.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <select
                value={t.status}
                onChange={async e => {
                  await updateTask(projectId, t.id, { status: e.target.value })
                  loadTasks()
                }}
                style={{ fontSize: 16, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '2px 4px', cursor: 'pointer' }}
              >
                <option value="todo">待办</option>
                <option value="in_progress">进行中</option>
                <option value="done">已完成</option>
              </select>
              <span style={{
                flex: 1, fontSize: 14,
                color: t.status === 'done' ? 'var(--muted)' : 'var(--text)',
                textDecoration: t.status === 'done' ? 'line-through' : 'none',
              }}>{t.title}</span>
              <button
                onClick={async () => { await deleteTask(projectId, t.id); loadTasks() }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 16, padding: '0 4px', lineHeight: 1 }}>×</button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input
              className="input"
              value={newTaskTitle}
              onChange={e => setNewTaskTitle(e.target.value)}
              onKeyDown={async e => {
                if (e.key === 'Enter' && newTaskTitle.trim()) {
                  await createTask(projectId, { title: newTaskTitle.trim(), sortOrder: tasks.length })
                  setNewTaskTitle('')
                  loadTasks()
                }
              }}
              placeholder="添加任务（回车确认）"
              style={{ flex: 1, fontSize: 14 }}
            />
            <button className="btn-ghost" style={{ fontSize: 13 }} onClick={async () => {
              if (!newTaskTitle.trim()) return
              await createTask(projectId, { title: newTaskTitle.trim(), sortOrder: tasks.length })
              setNewTaskTitle('')
              loadTasks()
            }}>添加</button>
          </div>
        </div>

        {/* ---- 决策日志 ---- */}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>决策日志 ({decisions.length})</h3>
            <button className="btn-ghost" style={{ fontSize: 13 }} onClick={() => setAddingDecision(v => !v)}>
              {addingDecision ? '取消' : '+ 记录决策'}
            </button>
          </div>

          {addingDecision && (
            <div style={{ background: 'var(--surface)', padding: 12, borderRadius: 8, marginBottom: 12 }}>
              <div className="dfg">
                <label>决策类型</label>
                <select className="input" value={decisionForm.decisionType}
                  onChange={e => setDecisionForm(f => ({ ...f, decisionType: e.target.value }))} style={{ fontSize: 16 }}>
                  {Object.entries(DECISION_TYPE_MAP).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="dfg">
                <label>决策内容 *</label>
                <textarea rows={2} value={decisionForm.content}
                  onChange={e => setDecisionForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="做了什么决定"
                  style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: 9, borderRadius: 4, fontSize: 16, outline: 'none', resize: 'vertical' }} />
              </div>
              <div className="dfg">
                <label>决策依据</label>
                <input className="input" value={decisionForm.rationale}
                  onChange={e => setDecisionForm(f => ({ ...f, rationale: e.target.value }))}
                  placeholder="为什么这么决定（可选）" style={{ fontSize: 16 }} />
              </div>
              <div style={{ textAlign: 'right' }}>
                <button className="btn" onClick={handleAddDecision}>记录</button>
              </div>
            </div>
          )}

          {decisions.length === 0 && !addingDecision && (
            <div style={{ color: 'var(--muted)', fontSize: 14, textAlign: 'center', padding: '12px 0' }}>暂无决策记录</div>
          )}

          {decisions.map(d => (
            <div key={d.id} style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ fontSize: 12, color: 'var(--muted)', marginRight: 8 }}>
                    {DECISION_TYPE_MAP[d.decisionType] || d.decisionType}
                  </span>
                  <span style={{ fontSize: 13 }}>{d.content}</span>
                </div>
                <button onClick={() => handleDeleteDecision(d.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 16, padding: '0 4px' }}>×</button>
              </div>
              {d.rationale && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>依据：{d.rationale}</div>}
              {d.outcome && <div style={{ fontSize: 12, color: '#52c41a', marginTop: 2 }}>结果：{d.outcome}</div>}
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{d.createdAt?.slice(0, 10)} · {d.decidedBy}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---- 主页面 ----
export default function Projects() {
  const toast = useToastStore(s => s.toast)
  const [projects, setProjects] = useState([])
  const [stats, setStats] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [detailId, setDetailId] = useState(null)
  const [fromTicketId, setFromTicketId] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [listRes, statsRes] = await Promise.all([
        listProjects({ status: statusFilter || undefined, pageSize: 50 }),
        getProjectStats(),
      ])
      setProjects(listRes.items || [])
      setStats(statsRes)
    } catch { toast('加载失败', true) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [statusFilter])

  const handleFromTicket = async () => {
    const tid = parseInt(fromTicketId)
    if (!tid) { toast('请输入工单 ID', true); return }
    try {
      const res = await projectFromTicket(tid)
      toast(res.message || '项目已创建')
      setFromTicketId('')
      load()
    } catch (e) { toast(e.response?.data?.message || '转化失败', true) }
  }

  const TABS = [
    { value: '', label: '全部' },
    { value: 'planning', label: `规划中 ${stats ? stats.planning : ''}` },
    { value: 'in_progress', label: `进行中 ${stats ? stats.inProgress : ''}` },
    { value: 'testing', label: `测试中 ${stats ? stats.testing : ''}` },
    { value: 'done', label: `已完成 ${stats ? stats.done : ''}` },
    { value: 'cancelled', label: '已取消' },
  ]

  return (
    <div>
      {/* 统计条 */}
      {stats && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
          {[
            { label: '总项目', value: stats.total, color: 'var(--accent)' },
            { label: '总收入', value: stats.totalRevenue ? `¥${stats.totalRevenue.toFixed(0)}` : '—', color: '#52c41a' },
            { label: '总成本', value: stats.totalCost ? `¥${stats.totalCost.toFixed(0)}` : '—', color: '#ff7a00' },
            { label: '净利润', value: stats.totalProfit ? `¥${stats.totalProfit.toFixed(0)}` : '—', color: '#f5a623' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 18px', minWidth: 100 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* 操作栏 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn" onClick={() => setShowCreate(true)}>+ 新建项目</button>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input className="input" value={fromTicketId} onChange={e => setFromTicketId(e.target.value)}
            placeholder="工单 ID" style={{ width: 90, fontSize: 16 }} />
          <button className="btn-ghost" onClick={handleFromTicket}>工单→项目</button>
        </div>
      </div>

      {/* 状态 Tab */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.value} onClick={() => setStatusFilter(t.value)}
            style={{
              padding: '5px 12px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 13,
              background: statusFilter === t.value ? 'var(--accent)' : 'var(--surface)',
              color: statusFilter === t.value ? '#fff' : 'var(--text)',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 项目列表 */}
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>加载中…</div>
      ) : projects.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>暂无项目</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {projects.map(p => (
            <div key={p.id}
              onClick={() => setDetailId(p.id)}
              style={{
                background: 'var(--surface)', borderRadius: 8, padding: '12px 16px',
                cursor: 'pointer', borderLeft: `4px solid ${STATUS_COLOR[p.status]}`,
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {p.client && <span>👤 {p.client.name}</span>}
                  {p.ticket && <span>🎫 {p.ticket.ticketNo}</span>}
                  {p.assignee && <span>🤖 {p.assignee.username}</span>}
                  <span>📅 {p.createdAt?.slice(0, 10)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span className={`st-pill ${STATUS_PILL[p.status]}`}>{STATUS_MAP[p.status]}</span>
                {p.quotedPrice != null && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#52c41a' }}>¥{p.quotedPrice}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load() }} />}
      {detailId && <DetailModal projectId={detailId} onClose={() => setDetailId(null)} onUpdated={load} />}
    </div>
  )
}
