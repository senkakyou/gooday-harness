// =====================================================
// pages/admin/Finance.jsx —— 财务管理页
// 路由：/admin/finance
// =====================================================

import React, { useEffect, useState, useCallback } from 'react'
import {
  listFinance, createFinance, updateFinance,
  deleteFinance, getFinanceOverview
} from '../../api/finance'
import useToastStore from '../../store/toastStore'
import { confirmDialog } from '../../store/confirmStore'

const TYPE_MAP = { income: '收入', expense: '支出' }
const PAY_STATUS_MAP = {
  pending: '待收款', received: '已收款', partial: '部分收款', refunded: '已退款'
}
const PAY_STATUS_PILL = {
  pending:  'st-pill-warn',
  received: 'st-pill-green',
  partial:  'st-pill-blue',
  refunded: 'st-pill-muted',
}
const CAT_MAP = {
  project: '项目', tool: '工具', refund: '退款', server: '服务器', domain: '域名', other: '其他'
}
const METHOD_MAP = {
  wechat: '微信', alipay: '支付宝', bank: '银行转账', cash: '现金', other: '其他'
}

// 当月账期
const currentPeriod = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// 统计卡片
function StatCard({ label, value, color, sub }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
      padding: '14px 18px', minWidth: 120, flex: 1,
    }}>
      <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--text)' }}>
        ¥{Number(value || 0).toFixed(2)}
      </div>
      {sub && <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// 新建 / 编辑弹窗
function RecordModal({ record, onClose, onSaved }) {
  const toast = useToastStore(s => s.toast)
  const isEdit = !!record?.id
  const [form, setForm] = useState(isEdit ? {
    type: record.type,
    amount: String(record.amount),
    category: record.category,
    title: record.title,
    note: record.note || '',
    paymentStatus: record.paymentStatus,
    paymentMethod: record.paymentMethod || '',
    accountPeriod: record.accountPeriod || currentPeriod(),
    receivedAt: record.receivedAt ? record.receivedAt.slice(0, 10) : '',
  } : {
    type: 'income', amount: '', category: 'project',
    title: '', note: '', paymentStatus: 'pending',
    paymentMethod: 'wechat', accountPeriod: currentPeriod(), receivedAt: '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.title.trim()) { toast('请填写标题', true); return }
    if (!form.amount || isNaN(Number(form.amount))) { toast('请填写有效金额', true); return }
    setSaving(true)
    try {
      const payload = {
        type: form.type,
        amount: parseFloat(form.amount),
        category: form.category,
        title: form.title,
        note: form.note || null,
        paymentStatus: form.paymentStatus,
        paymentMethod: form.paymentMethod || null,
        accountPeriod: form.accountPeriod || null,
        receivedAt: form.receivedAt || null,
        ticketId: null, clientId: null,
      }
      if (isEdit) await updateFinance(record.id, payload)
      else await createFinance(payload)
      toast(isEdit ? '已更新' : '已创建')
      onSaved()
    } catch (e) { toast(e.message || '保存失败', true) }
    finally { setSaving(false) }
  }

  const row = (label, children) => (
    <div className="dfg" style={{ gap: 4 }}>
      <label style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 2 }}>{label}</label>
      {children}
    </div>
  )

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2><span className="accent-line" /> {isEdit ? '编辑财务记录' : '新建财务记录'}</h2>

        <div className="dfg" style={{ gap: 12 }}>
          {row('类型',
            <select className="input" value={form.type} onChange={e => set('type', e.target.value)}>
              <option value="income">收入</option>
              <option value="expense">支出</option>
            </select>
          )}
          {row('金额（元）',
            <input className="input" type="number" step="0.01" min="0" value={form.amount}
              onChange={e => set('amount', e.target.value)} placeholder="0.00" />
          )}
          {row('分类',
            <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
              {Object.entries(CAT_MAP).map(([v, l]) =>
                <option key={v} value={v}>{l}</option>
              )}
            </select>
          )}
          {row('标题',
            <input className="input" value={form.title}
              onChange={e => set('title', e.target.value)} placeholder="例：小明网站定制开发" />
          )}
          {row('备注',
            <textarea className="input" rows={2} value={form.note}
              onChange={e => set('note', e.target.value)} placeholder="可不填" />
          )}
          {row('收款状态',
            <select className="input" value={form.paymentStatus} onChange={e => set('paymentStatus', e.target.value)}>
              {Object.entries(PAY_STATUS_MAP).map(([v, l]) =>
                <option key={v} value={v}>{l}</option>
              )}
            </select>
          )}
          {row('付款方式',
            <select className="input" value={form.paymentMethod} onChange={e => set('paymentMethod', e.target.value)}>
              <option value="">不填</option>
              {Object.entries(METHOD_MAP).map(([v, l]) =>
                <option key={v} value={v}>{l}</option>
              )}
            </select>
          )}
          {row('账期（月份）',
            <input className="input" value={form.accountPeriod}
              onChange={e => set('accountPeriod', e.target.value)} placeholder="2026-06" />
          )}
          {row('实际收款日期',
            <input className="input" type="date" value={form.receivedAt}
              onChange={e => set('receivedAt', e.target.value)} />
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn-outline" onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Finance() {
  const toast = useToastStore(s => s.toast)
  const [overview, setOverview] = useState(null)
  const [records, setRecords] = useState([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState({ type: '', paymentStatus: '', period: '' })
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20
  const [modal, setModal] = useState(null) // null | 'create' | record

  const loadOverview = useCallback(async () => {
    try { setOverview(await getFinanceOverview()) } catch {}
  }, [])

  const loadList = useCallback(async () => {
    try {
      const res = await listFinance({ ...filter, page, pageSize: PAGE_SIZE })
      setRecords(res.records || [])
      setTotal(res.total || 0)
    } catch (e) { toast('加载失败', true) }
  }, [filter, page])

  useEffect(() => { loadOverview(); loadList() }, [loadOverview, loadList])

  const handleDelete = async (r) => {
    if (!await confirmDialog(`确认删除「${r.title}」？`)) return
    try {
      await deleteFinance(r.id)
      toast('已删除')
      loadList(); loadOverview()
    } catch (e) { toast('删除失败', true) }
  }

  const setF = (k, v) => { setFilter(f => ({ ...f, [k]: v })); setPage(1) }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 12px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>💰 财务管理</h2>
        <button className="btn-primary" onClick={() => setModal('create')}>+ 新增</button>
      </div>

      {/* 年度总览 */}
      {overview && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
          <StatCard label={`${overview.year} 年收入`} value={overview.totalIncome} color="#22c55e" />
          <StatCard label={`${overview.year} 年支出`} value={overview.totalExpense} color="#f97316" />
          <StatCard label={`${overview.year} 年利润`} value={overview.profit}
            color={overview.profit >= 0 ? '#22c55e' : '#ef4444'} />
          <StatCard label="待收款" value={overview.pending} color="#facc15"
            sub={`已收 ¥${Number(overview.received || 0).toFixed(2)}`} />
          <StatCard label="历史累计利润" value={overview.cumProfit}
            color={overview.cumProfit >= 0 ? '#22c55e' : '#ef4444'} />
        </div>
      )}

      {/* 月度折线概览 */}
      {overview?.monthly?.length > 0 && (
        <div style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '12px 16px', marginBottom: 20,
        }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>月度收支</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {overview.monthly.map(m => (
              <div key={m.period} style={{ fontSize: 12 }}>
                <span style={{ color: 'var(--muted)' }}>{m.period.slice(5)}月 </span>
                <span style={{ color: '#22c55e' }}>+{Number(m.income).toFixed(0)}</span>
                {m.expense > 0 && <span style={{ color: '#f97316' }}> -{Number(m.expense).toFixed(0)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 筛选 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select className="input" style={{ width: 'auto' }} value={filter.type} onChange={e => setF('type', e.target.value)}>
          <option value="">全部类型</option>
          <option value="income">收入</option>
          <option value="expense">支出</option>
        </select>
        <select className="input" style={{ width: 'auto' }} value={filter.paymentStatus} onChange={e => setF('paymentStatus', e.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(PAY_STATUS_MAP).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input className="input" style={{ width: 110 }} placeholder="账期 2026-06"
          value={filter.period} onChange={e => setF('period', e.target.value)} />
        <span style={{ color: 'var(--muted)', fontSize: 13, alignSelf: 'center' }}>共 {total} 条</span>
      </div>

      {/* 列表 */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {records.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>暂无财务记录</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>标题</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>类型</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>金额</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>状态</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>账期</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>时间</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px' }}>
                    <div style={{ fontWeight: 500 }}>{r.title}</div>
                    {r.note && <div style={{ color: 'var(--muted)', fontSize: 11 }}>{r.note}</div>}
                    {r.source === 'auto' && <span style={{ fontSize: 10, color: 'var(--muted)' }}>🤖 自动生成</span>}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ color: r.type === 'income' ? '#22c55e' : '#f97316' }}>
                      {r.type === 'income' ? '▲' : '▼'} {TYPE_MAP[r.type]}
                    </span>
                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>{CAT_MAP[r.category] || r.category}</div>
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600,
                    color: r.type === 'income' ? '#22c55e' : '#f97316' }}>
                    ¥{Number(r.amount).toFixed(2)}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <span className={`st-pill ${PAY_STATUS_PILL[r.paymentStatus] || 'st-pill-muted'}`}>
                      {PAY_STATUS_MAP[r.paymentStatus] || r.paymentStatus}
                    </span>
                    {r.paymentMethod && (
                      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
                        {METHOD_MAP[r.paymentMethod] || r.paymentMethod}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>
                    {r.accountPeriod || '-'}
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>
                    {new Date(r.createdAt).toLocaleDateString('zh-CN')}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      <button className="btn-outline" style={{ padding: '3px 10px', fontSize: 12 }}
                        onClick={() => setModal(r)}>编辑</button>
                      <button className="btn-outline" style={{ padding: '3px 10px', fontSize: 12, color: '#ef4444' }}
                        onClick={() => handleDelete(r)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button className="btn-outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
          <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--muted)' }}>{page} / {totalPages}</span>
          <button className="btn-outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
        </div>
      )}

      {/* 弹窗 */}
      {modal && (
        <RecordModal
          record={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadList(); loadOverview() }}
        />
      )}
    </div>
  )
}
