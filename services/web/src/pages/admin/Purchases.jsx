// =====================================================
// pages/admin/Purchases.jsx —— 付费购买记录管理页
// 职责：查看所有购买申请，对待确认的申请进行激活或拒绝
// 路由：/admin/purchases
//
// 购买状态流转：
//   pending（用户点"我已付款"）→ activated（管理员确认收款后激活）
//                              → refunded（管理员拒绝）
// =====================================================

import React, { useEffect, useState } from 'react'
import { listPurchases, activatePurchase, rejectPurchase, getPurchaseStats } from '../../api/purchases'
import useToastStore from '../../store/toastStore'
import { confirmDialog } from '../../store/confirmStore'

const STATUS_MAP  = { pending: '待确认', activated: '已激活', refunded: '已拒绝' }
const STATUS_PILL = { pending: 'st-pill-warn', activated: 'st-pill-green', refunded: 'st-pill-danger' }

export default function Purchases() {
  const toast = useToastStore(s => s.toast)
  const [list, setList] = useState([])
  const [filter, setFilter] = useState('')
  const [stats, setStats] = useState(null)

  const load = (status) => {
    setFilter(status)
    listPurchases(status).then(setList).catch(() => {})
  }

  useEffect(() => {
    load('')
    getPurchaseStats().then(setStats).catch(() => {})
  }, [])

  const handleActivate = async (p) => {
    if (!await confirmDialog('确认激活？用户将可以下载该工具')) return
    try {
      await activatePurchase(p.id)
      toast('已激活')
      load(filter)
      getPurchaseStats().then(setStats).catch(() => {})
    } catch (e) { toast(e.message, true) }
  }

  const handleReject = async (p) => {
    if (!await confirmDialog('确认拒绝该付款申请？', { danger: true, confirmText: '拒绝' })) return
    try {
      await rejectPurchase(p.id)
      toast('已拒绝')
      load(filter)
      getPurchaseStats().then(setStats).catch(() => {})
    } catch (e) { toast(e.message, true) }
  }

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h2 className="admin-page-title">购买记录</h2>
          <div className="admin-page-sub">用户付费工具购买申请</div>
        </div>
      </div>

      {/* 统计条 */}
      <div className="pg-stats">
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--warn)' }}>{stats?.pending ?? '—'}</div>
          <div className="pg-stat-lbl">待确认</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--green)' }}>{stats?.activated ?? '—'}</div>
          <div className="pg-stat-lbl">已激活</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: 'var(--green)' }}>
            {stats?.revenue != null ? `¥${stats.revenue}` : '—'}
          </div>
          <div className="pg-stat-lbl">累计收入</div>
        </div>
        <div className="pg-stat-item">
          <div className="pg-stat-num" style={{ color: '#ff4757' }}>{stats?.refunded ?? '—'}</div>
          <div className="pg-stat-lbl">已拒绝</div>
        </div>
      </div>

      {/* 状态筛选 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[['', '全部'], ['pending', '待确认'], ['activated', '已激活']].map(([v, l]) => (
          <button key={v}
            className={`tool-cat-tab ${filter === v ? 'on' : ''}`}
            onClick={() => load(v)}>{l}
          </button>
        ))}
      </div>

      {/* 购买列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {list.length === 0
          ? <div className="chart-empty">暂无记录</div>
          : list.map(p => (
            <div key={p.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              {/* 用户信息 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{p.username}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span>{p.email}</span>
                  <span>📦 {p.toolName}</span>
                  <span>{new Date(p.createdAt).toLocaleDateString('zh-CN')}</span>
                </div>
              </div>
              {/* 金额 + 状态 + 操作 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--green)', fontSize: 15 }}>¥{p.amount}</span>
                <span className={`st-pill ${STATUS_PILL[p.status] || 'st-pill-muted'}`}>{STATUS_MAP[p.status] || p.status}</span>
                {p.status === 'pending' && (
                  <>
                    <button className="btn btn-sm" style={{ background: 'var(--green)', color: '#fff' }} onClick={() => handleActivate(p)}>激活</button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleReject(p)}>拒绝</button>
                  </>
                )}
              </div>
            </div>
          ))
        }
      </div>
    </>
  )
}
