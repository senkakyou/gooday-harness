// pages/account/PurchasesTab.jsx —— 个人中心·我的购买 Tab
import React, { useEffect, useState } from 'react'
import { myPurchases, cancelMyPurchase } from '../../api/purchases'
import useToastStore from '../../store/toastStore'
import { confirmDialog } from '../../store/confirmStore'
import { Badge, fmt } from './shared'

export default function PurchasesTab() {
  const toast = useToastStore(s => s.toast)
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => myPurchases().then(setList).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const cancel = async (id) => {
    if (!await confirmDialog('确定取消这条购买申请？')) return
    try {
      await cancelMyPurchase(id)
      toast('已取消')
      load()
    } catch (e) { toast(e.message || '操作失败', true) }
  }

  if (loading) return <div style={{ color: 'var(--muted)' }}>加载中…</div>
  if (!list.length) return <div style={{ color: 'var(--muted)', padding: '2rem 0' }}>暂无购买记录</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {list.map(p => (
        <div key={p.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{p.toolName}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Badge status={p.status} />
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>¥{p.amount}</span>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>· 提交于 {fmt(p.createdAt)}</span>
              {p.activatedAt && <span style={{ color: 'var(--muted)', fontSize: 12 }}>· 激活于 {fmt(p.activatedAt)}</span>}
            </div>
          </div>
          {p.status === 'pending' && (
            <button className="btn btn-ghost btn-sm" style={{ color: '#e55', flexShrink: 0 }} onClick={() => cancel(p.id)}>
              取消申请
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
