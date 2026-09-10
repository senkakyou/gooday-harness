// =====================================================
// pages/admin/Tickets.jsx —— 订单控制台
// 路由：/admin/tickets
//
// 大海在这一页做四件事：改需求和金额、下开工令、放行验收、结单。
//
// 【按钮从后端返回的 available 来，前端不自己维护一份状态机】：
// 上一版前端有一张自己的 STATUS_MAP + 迁移判断，和后端各说各话。
// 现在合法迁移表只在 Services/TicketWorkflow.cs 一处，
// 这一页只负责把它给的动作画成按钮（policies G03 单一真源）。
// =====================================================

import React, { useEffect, useState } from 'react'
import {
  listTickets, getTicket, getTicketLog, createTicket,
  updateTicket, transitionTicket, deleteTicket, getTicketStats,
} from '../../api/tickets'
import useToastStore from '../../store/toastStore'
import { confirmDialog } from '../../store/confirmStore'

// 只负责「怎么显示」，不负责「能不能做」——后者是后端的事
const STATUS_TEXT = {
  NEW:         '待接单',
  IN_PROGRESS: '开发中',
  DELIVERED:   '待验收',
  CLOSED:      '已结单',
  BLOCKED:     '卡住了',
  CANCELLED:   '已取消',
}
const STATUS_PILL = {
  NEW:         'st-pill-warn',
  IN_PROGRESS: 'st-pill-blue',
  DELIVERED:   'st-pill-blue',
  CLOSED:      'st-pill-green',
  BLOCKED:     'st-pill-danger',
  CANCELLED:   'st-pill-muted',
}

// 动作名 → 按钮文案。后端多给一个动作时这里没有对应文案，
// 就原样显示动作名——【宁可难看，也不要把按钮藏起来】。
const EVENT_TEXT = {
  start:   '开工',
  release: '放行验收',
  close:   '结单',
  rework:  '打回返工',
  block:   '标记卡住',
  unblock: '解除卡住',
  cancel:  '取消订单',
}
const EVENT_STYLE = {
  start:   'btn-primary',
  release: 'btn-primary',
  close:   'btn-primary',
  cancel:  'btn-ghost',
  block:   'btn-ghost',
}

const fmt = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '—')

export default function Tickets() {
  const toast = useToastStore(s => s.toast)
  const [list, setList] = useState([])
  const [stats, setStats] = useState(null)
  const [filter, setFilter] = useState('')
  const [sel, setSel] = useState(null)
  const [busy, setBusy] = useState('')

  const load = () => {
    listTickets(filter ? { status: filter, pageSize: 100 } : { pageSize: 100 })
      .then(d => setList(d.list || []))
      .catch(e => toast(e.message || '加载失败', true))
    getTicketStats().then(setStats).catch(() => {})
  }
  useEffect(load, [filter])

  return (
    <div style={{ padding: '1rem' }}>
      <h2><span className="accent-line" /> 订单</h2>

      {stats && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0.8rem 0 1rem' }}>
          <Chip label="全部" n={stats.total} on={filter === ''} onClick={() => setFilter('')} />
          {Object.entries(stats.byStatus).map(([k, n]) => (
            <Chip key={k} label={STATUS_TEXT[k] || k} n={n}
                  on={filter === k} onClick={() => setFilter(filter === k ? '' : k)} />
          ))}
        </div>
      )}

      <NewTicketForm onDone={load} toast={toast} />

      {list.length === 0 && (
        <div style={{ color: 'var(--muted)', padding: '2rem 0', textAlign: 'center' }}>
          没有订单。客户从需求表单或如意那边进来后会出现在这里。
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map(t => (
          <div key={t.id} style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '0.85rem 1rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <code style={{ fontSize: 13, color: 'var(--muted)' }}>{t.ticketNo}</code>
              <span className={`st-pill ${STATUS_PILL[t.status] || ''}`}>
                {STATUS_TEXT[t.status] || t.status}
              </span>
              <strong style={{ flex: 1, minWidth: 180 }}>{t.title}</strong>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                {t.amount != null ? `¥${t.amount}` : '未定价'}
              </span>
              <button className="btn btn-sm btn-ghost"
                      onClick={() => setSel(sel === t.id ? null : t.id)}>
                {sel === t.id ? '收起' : '展开'}
              </button>
            </div>

            {t.blockedReason && (
              <div style={{ marginTop: 6, fontSize: 13, color: 'var(--danger)' }}>
                卡住了：{t.blockedReason}
              </div>
            )}

            <div style={{ marginTop: 6, fontSize: 13, color: 'var(--muted)' }}>
              {t.clientName || '（未填客户）'} · {t.clientContact || '无联系方式'} · 建于 {fmt(t.createdAt)}
            </div>

            {sel === t.id && (
              <Detail id={t.id} busy={busy} setBusy={setBusy}
                      onChanged={load} toast={toast} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Chip({ label, n, on, onClick }) {
  return (
    <button onClick={onClick} className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`}>
      {label} {n}
    </button>
  )
}

function NewTicketForm({ onDone, toast }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ title: '', description: '', clientName: '', clientContact: '' })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const submit = async () => {
    try {
      await createTicket({ ...f, clientId: null })
      toast('已建单')
      setF({ title: '', description: '', clientName: '', clientContact: '' })
      setOpen(false); onDone()
    } catch (e) { toast(e.message || '建单失败', true) }
  }

  if (!open) return (
    <button className="btn btn-sm btn-ghost" style={{ marginBottom: '1rem' }}
            onClick={() => setOpen(true)}>+ 手动建单</button>
  )
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
      <input className="input" placeholder="一句话说明想做什么" value={f.title}
             onChange={e => set('title', e.target.value)} style={{ marginBottom: 8 }} />
      <textarea className="input" rows={4} placeholder="需求原文（越具体越好）" value={f.description}
                onChange={e => set('description', e.target.value)} style={{ marginBottom: 8 }} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input className="input" placeholder="客户称呼" value={f.clientName}
               onChange={e => set('clientName', e.target.value)} />
        <input className="input" placeholder="联系方式" value={f.clientContact}
               onChange={e => set('clientContact', e.target.value)} />
      </div>
      {/* 【建单时没有金额输入】：金额在下面展开的详情里填，
          和「与客户确认细节」是同一个动作，不该在建单这一步就问。 */}
      <button className="btn btn-sm btn-primary" onClick={submit}>建单</button>
      <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>取消</button>
    </div>
  )
}

function Detail({ id, busy, setBusy, onChanged, toast }) {
  const [t, setT] = useState(null)
  const [log, setLog] = useState([])
  const [amount, setAmount] = useState('')
  const [desc, setDesc] = useState('')

  const load = () => {
    getTicket(id).then(d => {
      setT(d)
      setAmount(d.amount == null ? '' : String(d.amount))
      setDesc(d.description || '')
    }).catch(e => toast(e.message, true))
    getTicketLog(id).then(d => setLog(d.list || [])).catch(() => {})
  }
  useEffect(load, [id])

  if (!t) return <div style={{ color: 'var(--muted)', padding: '0.8rem 0' }}>加载中…</div>

  const saveContent = async () => {
    setBusy(`save-${id}`)
    try {
      await updateTicket(id, {
        description: desc,
        amount: amount === '' ? null : Number(amount),
      })
      toast('已保存'); load(); onChanged()
    } catch (e) { toast(e.message || '保存失败', true) }
    finally { setBusy('') }
  }

  const doEvent = async (evt) => {
    let reason = null
    if (evt === 'block') {
      reason = window.prompt('卡在哪？（必填，不写不让进 BLOCKED）')
      if (!reason || !reason.trim()) return
    } else {
      const ok = await confirmDialog({
        title: EVENT_TEXT[evt] || evt,
        message: `确定对 ${t.ticketNo} 执行「${EVENT_TEXT[evt] || evt}」吗？`,
      })
      if (!ok) return
    }
    setBusy(`${evt}-${id}`)
    try {
      const r = await transitionTicket(id, evt, reason)
      toast(r.notify?.notified ? '已放行，如意已通知客户' : `已${EVENT_TEXT[evt] || evt}`)
      load(); onChanged()
    } catch (e) {
      // 后端把「此刻不能做」和「参数错」分开了：409 是状态不对，400 是闸门拦下
      toast(e.message || '操作失败', true)
    } finally { setBusy('') }
  }

  const del = async () => {
    if (!await confirmDialog({ title: '删除订单', message: `${t.ticketNo} 及其工作记录都会删掉，确定？` })) return
    try { await deleteTicket(id); toast('已删除'); onChanged() }
    catch (e) { toast(e.message, true) }
  }

  return (
    <div style={{ marginTop: '0.9rem', paddingTop: '0.9rem', borderTop: '1px solid var(--border)' }}>
      <textarea className="input" rows={6} value={desc} onChange={e => setDesc(e.target.value)} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
        <label style={{ fontSize: 13, color: 'var(--muted)' }}>金额 ¥</label>
        <input className="input" style={{ maxWidth: 140 }} value={amount} inputMode="decimal"
               placeholder="与客户谈定后填" onChange={e => setAmount(e.target.value)} />
        <button className="btn btn-sm btn-ghost" disabled={busy === `save-${id}`}
                onClick={saveContent}>保存需求和金额</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        金额空着也能开工；但**结单前必须填**，否则财务表对不上而账面看着是好的。
      </div>

      {/* 动作按钮：完全由后端的 available 决定 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {(t.available || []).map(evt => (
          <button key={evt} className={`btn btn-sm ${EVENT_STYLE[evt] || 'btn-ghost'}`}
                  disabled={busy === `${evt}-${id}`}
                  onClick={() => doEvent(evt)}>
            {EVENT_TEXT[evt] || evt}
          </button>
        ))}
        <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={del}>删除</button>
      </div>

      <div style={{ fontSize: 13 }}>
        <div style={{ color: 'var(--muted)', marginBottom: 6 }}>工作记录</div>
        {log.length === 0 && <div style={{ color: 'var(--muted)' }}>还没有记录</div>}
        {log.map(l => (
          <div key={l.id} style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
            <code style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmt(l.at)}</code>
            <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{l.actorName || '系统'}</span>
            <span>{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
