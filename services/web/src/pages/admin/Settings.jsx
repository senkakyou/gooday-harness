// pages/admin/Settings.jsx —— 系统设置（智能体开关 + 模型配置）
import React, { useEffect, useState } from 'react'
import { getSettings, updateSetting, clearChat } from '../../api/settings'
import useToastStore from '../../store/toastStore'

const TABS = ['智能体', '模型', '模块']

// 首页模块显示开关（键 Module.{key}.Enabled，默认全开；与首页 ModuleNav 一致）
const MODULES = [
  { key: 'requests',   label: '需求',    icon: '📋' },
  { key: 'forum',      label: '论坛',    icon: '💬' },
  { key: 'courses',    label: '课程',    icon: '🎓' },
  { key: 'audiobooks', label: '听书',  icon: '🎧' },
  { key: 'games',      label: '游戏',    icon: '🎮' },
  { key: 'secondhand', label: '二手',    icon: '🛍️' },
  { key: 'invest',     label: '投资',    icon: '📈' },
]

const AGENTS = [
  { name: '灵犀',  label: '灵犀（质量门禁 / 内部运维）', note: '切换非 Claude 时将失去工具调用能力（Bash/Read 等）' },
  { name: '如意',  label: '如意（前台接待，唯一对外窗口）', note: '' },
  // 擎天柱 / 威震天 / 招财 已于 2026-09-10 退役（docs/decisions/006）：
  // 需求分析与开发收归主 Agent + workflows/order，财务回归人工。
]

const MODEL_OPTIONS = [
  { value: 'claude',   label: 'Claude',           desc: 'Anthropic Claude（默认）' },
  { value: 'qwen',     label: '千问 (Qwen)',       desc: '阿里云通义千问，需 DASHSCOPE_API_KEY' },
  { value: 'deepseek', label: 'DeepSeek',          desc: '深度求索，需 DEEPSEEK_API_KEY' },
  { value: 'chatgpt',  label: 'ChatGPT',           desc: 'OpenAI GPT-4o，需 OPENAI_API_KEY' },
]

export default function Settings() {
  const toast = useToastStore(s => s.toast)
  const [tab, setTab] = useState('智能体')
  const [cfg, setCfg] = useState(null)
  const [saving, setSaving] = useState('')
  const [pendingModels, setPendingModels] = useState({})

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

  const saveModel = async (agentName) => {
    const key = `Agent.${agentName}.Model`
    const val = pendingModels[agentName] ?? (cfg?.[key] || 'claude')
    await save(key, val)
    setPendingModels(p => { const n = {...p}; delete n[agentName]; return n })
  }

  const [clearing, setClearing] = useState(false)

  const handleClearChat = async () => {
    if (!window.confirm('确认清空全部留言？此操作不可恢复。')) return
    setClearing(true)
    try {
      const r = await clearChat()
      toast(r.message || '留言已清空')
    } catch (e) { toast(e.message || '清空失败', true) }
    finally { setClearing(false) }
  }

  if (!cfg) return <div style={{ padding: '1rem', color: 'var(--muted)' }}>加载中…</div>

  const ruyiDirect  = String(cfg['Ruyi.DirectChat']) === 'true'
  const chatEnabled = String(cfg['ChatBox.Enabled']) !== 'false'

  return (
    <div style={{ padding: '1rem', maxWidth: 720 }}>
      <h2><span className="accent-line" /> 系统设置</h2>

      {/* 标签页 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '8px 18px', fontSize: 15, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? 'var(--accent)' : 'var(--muted)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
            }}>
            {t}
          </button>
        ))}
      </div>

      {/* ---- 智能体标签 ---- */}
      {tab === '智能体' && (
        <div>
          <h3 style={{ marginBottom: 6 }}>如意前台 · 直接会话</h3>
          <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
            开启后，任何已登录用户都可以主动给如意发消息，如意将直接接待。<br/>
            关闭时（默认），只有如意先主动联系过的用户才能回复如意——适合邀请制接待场景。
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
            padding: '14px 16px' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                允许客户主动联系如意&nbsp;
                {ruyiDirect
                  ? <span style={{ color: 'var(--green)', fontSize: 13 }}>· 已开启</span>
                  : <span style={{ color: 'var(--muted)', fontSize: 13 }}>· 已关闭（仅如意主动）</span>}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                关闭时如意主动发过消息的用户仍可永久回复，不受影响。
              </div>
            </div>
            <button
              className={`btn btn-sm ${ruyiDirect ? 'btn-ghost' : 'btn-primary'}`}
              disabled={saving === 'Ruyi.DirectChat'}
              onClick={() => save('Ruyi.DirectChat', ruyiDirect ? 'false' : 'true')}>
              {saving === 'Ruyi.DirectChat' ? '…' : (ruyiDirect ? '关闭' : '开启')}
            </button>
          </div>

          <h3 style={{ marginTop: 28, marginBottom: 6 }}>首页留言板</h3>
          <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
            控制全站右下角悬浮留言按钮的显示状态，以及清空历史留言记录。
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
            padding: '14px 16px', marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                显示留言板悬浮按钮&nbsp;
                {chatEnabled
                  ? <span style={{ color: 'var(--green)', fontSize: 13 }}>· 已显示</span>
                  : <span style={{ color: 'var(--muted)', fontSize: 13 }}>· 已隐藏</span>}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                隐藏后留言数据保留，开启后立即恢复显示。
              </div>
            </div>
            <button
              className={`btn btn-sm ${chatEnabled ? 'btn-ghost' : 'btn-primary'}`}
              disabled={saving === 'ChatBox.Enabled'}
              onClick={() => save('ChatBox.Enabled', chatEnabled ? 'false' : 'true')}>
              {saving === 'ChatBox.Enabled' ? '…' : (chatEnabled ? '隐藏' : '显示')}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
            padding: '14px 16px' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>清空全部留言</div>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                删除所有公开留言记录，操作不可恢复。
              </div>
            </div>
            <button
              className="btn btn-sm"
              style={{ background: '#c0392b', color: '#fff', border: 'none' }}
              disabled={clearing}
              onClick={handleClearChat}>
              {clearing ? '清空中…' : '清空留言'}
            </button>
          </div>
        </div>
      )}

      {/* ---- 模型标签 ---- */}
      {tab === '模型' && (
        <div>
          <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
            各智能体默认使用 Claude。切换为第三方模型前，请先在服务器 <code>.env</code> 中配置对应的 API Key，
            否则切换后 bot 将无法回复。
          </p>
          {AGENTS.map(agent => {
            const key = `Agent.${agent.name}.Model`
            const current = cfg[key] || 'claude'
            const pending = pendingModels[agent.name]
            const display = pending ?? current
            const isDirty = pending !== undefined && pending !== current
            const isSaving = saving === key
            return (
              <div key={agent.name} style={{
                display: 'flex', alignItems: 'flex-start', gap: 16,
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '14px 16px', marginBottom: 12
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{agent.label}</div>
                  {agent.note && (
                    <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 3 }}>⚠️ {agent.note}</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  <select
                    className="input"
                    style={{ fontSize: 16, padding: '6px 10px', minWidth: 160 }}
                    value={display}
                    onChange={e => setPendingModels(p => ({ ...p, [agent.name]: e.target.value }))}>
                    {MODEL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value} title={opt.desc}>{opt.label}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={isSaving || !isDirty}
                    style={{ opacity: isDirty ? 1 : 0.4 }}
                    onClick={() => saveModel(agent.name)}>
                    {isSaving ? '…' : '保存'}
                  </button>
                </div>
              </div>
            )
          })}
          <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--surface)',
            border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--muted)' }}>
            <strong>API Key 配置位置：</strong>服务器 <code>/opt/gooday-harness/.env</code><br/>
            千问：<code>DASHSCOPE_API_KEY=sk-...</code>&nbsp;&nbsp;
            DeepSeek：<code>DEEPSEEK_API_KEY=sk-...</code>&nbsp;&nbsp;
            ChatGPT：<code>OPENAI_API_KEY=sk-...</code>
          </div>
        </div>
      )}

      {tab === '模块' && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
            控制首页底部模块导航对用户的显示。关闭后该模块从首页隐藏（默认全部显示）。
          </p>
          {MODULES.map(mod => {
            const k = `Module.${mod.key}.Enabled`
            const on = String(cfg[k]) !== 'false'   // 默认显示
            return (
              <div key={mod.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 15, color: 'var(--text)', fontWeight: 600 }}>
                  {mod.icon} {mod.label}
                  <span style={{ fontSize: 12, color: on ? '#10b981' : 'var(--muted)', marginLeft: 10, fontWeight: 400 }}>
                    {on ? '显示中' : '已隐藏'}
                  </span>
                </span>
                <button className="btn btn-sm"
                  style={{ background: on ? 'transparent' : 'var(--accent)', color: on ? 'var(--muted)' : '#fff',
                    border: '1px solid var(--border)' }}
                  disabled={saving === k}
                  onClick={() => save(k, on ? 'false' : 'true')}>
                  {saving === k ? '…' : (on ? '隐藏' : '显示')}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
