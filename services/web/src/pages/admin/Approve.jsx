// pages/admin/Approve.jsx —— 小额自动放行审批设置
import React, { useEffect, useState } from 'react'
import { getSettings, updateSetting } from '../../api/settings'
import useToastStore from '../../store/toastStore'

const NUM_FIELDS = [
  { key: 'AutoApprove.Limit',            label: '单笔限额（元）',     hint: '工单金额 ≤ 此值才可能自动放行' },
  { key: 'AutoApprove.DailyCap',         label: '当日累计上限（元）', hint: '当天自动放行总额超过即全部转人工' },
  { key: 'AutoApprove.PerCustomerDaily', label: '同客户每日单数',    hint: '同一客户当天自动放行的最多单数（防拆单）' },
]

export default function Approve() {
  const toast = useToastStore(s => s.toast)
  const [cfg, setCfg] = useState(null)
  const [saving, setSaving] = useState('')

  const load = () => getSettings().then(setCfg).catch(() => toast('加载配置失败', true))
  useEffect(() => { load() }, [])

  const save = async (key, value) => {
    setSaving(key)
    try {
      await updateSetting(key, String(value))
      setCfg(c => ({ ...c, [key]: String(value) }))
      toast('已保存')
    } catch (e) { toast(e.message || '保存失败', true) }
    finally { setSaving('') }
  }

  if (!cfg) return <div style={{ padding: '1rem', color: 'var(--muted)' }}>加载中…</div>

  const enabled = String(cfg['AutoApprove.Enabled']) === 'true'

  return (
    <div style={{ padding: '1rem', maxWidth: 680 }}>
      <h2><span className="accent-line" /> 审批设置 · 小额自动放行</h2>
      <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>
        开启后，客户付款且满足下方全部条件的小额工单将由招财自动确认开工，无需站长逐单确认；
        不满足或关闭时仍转站长「确 工单号」人工确认。自动放行的单仍会事后对账，进当日日报。
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
        padding: '14px 16px', margin: '1rem 0' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            自动放行总开关 {enabled
              ? <span style={{ color: 'var(--green)' }}>· 已开启</span>
              : <span style={{ color: 'var(--muted)' }}>· 已关闭（影子观察）</span>}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
            建议先关闭观察一周（日报里能看到"本可自动放行"的影子记录），确认无误再开启。
          </div>
        </div>
        <button
          className={`btn btn-sm ${enabled ? 'btn-ghost' : 'btn-primary'}`}
          disabled={saving === 'AutoApprove.Enabled'}
          onClick={() => save('AutoApprove.Enabled', enabled ? 'false' : 'true')}>
          {saving === 'AutoApprove.Enabled' ? '…' : (enabled ? '关闭' : '开启')}
        </button>
      </div>

      {NUM_FIELDS.map(f => (
        <div key={f.key} className="dfg" style={{ marginBottom: '1rem' }}>
          <label>{f.label}</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="input" type="number" min="0" defaultValue={cfg[f.key]}
              style={{ fontSize: 16, maxWidth: 160 }}
              onKeyDown={e => { if (e.key === 'Enter') save(f.key, e.target.value) }}
              id={`set-${f.key}`} />
            <button className="btn btn-primary btn-sm" disabled={saving === f.key}
              onClick={() => save(f.key, document.getElementById(`set-${f.key}`).value)}>
              {saving === f.key ? '…' : '保存'}
            </button>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>{f.hint}</div>
        </div>
      ))}
    </div>
  )
}
