// =====================================================
// pages/admin/Stats.jsx —— 后台数据概览页（按效果图）
// 结构：欢迎横幅(系统状态) → 数据概览卡片 → 7天下载折线 → 分类占比环形 → 快捷功能
// 路由：/admin
// =====================================================

import React, { useEffect, useState } from 'react'
import { getStats, getSystem } from '../../api/admin'
import { getRequestStats } from '../../api/requests'
import { getPurchaseStats } from '../../api/purchases'
import useAuthStore from '../../store/authStore'

// 周环比 → 趋势徽章数据
const trendOf = (cur, prev) => {
  if (prev > 0) return { pct: Math.round(((cur - prev) / prev) * 100), up: cur >= prev }
  if (cur > 0) return { pct: 100, up: true }
  return null
}

// ---- 迷你趋势图（卡片右侧 sparkline，带面积填充） ----
function Spark({ data, color = 'var(--accent)' }) {
  if (!data || data.length < 2) return null
  const W = 120, H = 42
  const max = Math.max(...data), min = Math.min(...data)
  const range = (max - min) || 1
  const x = i => (W * i) / (data.length - 1)
  const y = v => H - 4 - ((H - 8) * (v - min)) / range
  const pts = data.map((v, i) => `${x(i)},${y(v)}`)
  const line = 'M' + pts.join(' L')
  const area = `${line} L${x(data.length - 1)},${H} L0,${H} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" preserveAspectRatio="none">
      <path d={area} fill={color} fillOpacity="0.13" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ---- 近7天下载折线（带高亮峰值 tooltip） ----
function LineChart({ data }) {
  const W = 560, H = 180, pad = 30, padB = 34
  if (!data || data.length === 0) return <div className="chart-empty">暂无数据</div>
  const max = Math.max(1, ...data.map(d => d.count))
  const innerW = W - pad * 2, innerH = H - pad - padB
  const x = i => pad + (data.length === 1 ? innerW / 2 : (innerW * i) / (data.length - 1))
  const y = v => pad + innerH - (innerH * v) / max
  const pts = data.map((d, i) => `${x(i)},${y(d.count)}`).join(' ')
  const area = `M${x(0)},${pad + innerH} ${pts} L${x(data.length - 1)},${pad + innerH} Z`
  const peak = data.reduce((m, d, i) => (d.count > data[m].count ? i : m), 0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg-tall" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="lc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* 横向网格 */}
      {[0, 0.5, 1].map(f => (
        <line key={f} x1={pad} x2={W - pad} y1={pad + innerH * f} y2={pad + innerH * f}
          stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4" />
      ))}
      <path d={area} fill="url(#lc)" />
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2.5"
        strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <g key={d.date}>
          <circle cx={x(i)} cy={y(d.count)} r={i === peak ? 0 : 3} fill="var(--accent)" />
          <text x={x(i)} y={H - 12} textAnchor="middle" className="chart-axis">{d.date}</text>
        </g>
      ))}
      {/* 峰值 tooltip */}
      <g>
        <circle cx={x(peak)} cy={y(data[peak].count)} r="5" fill="var(--accent)" stroke="#fff" strokeWidth="2" />
        <rect x={x(peak) - 18} y={y(data[peak].count) - 30} width="36" height="20" rx="5" fill="var(--accent)" />
        <text x={x(peak)} y={y(data[peak].count) - 16} textAnchor="middle" className="chart-tip">{data[peak].count}</text>
      </g>
    </svg>
  )
}

// ---- 分类占比环形饼图 ----
function Donut({ data }) {
  if (!data || data.length === 0) return <div className="chart-empty">暂无数据</div>
  const total = data.reduce((s, d) => s + d.count, 0) || 1
  const colors = ['var(--accent)', 'var(--accent2)', 'var(--warn)', 'var(--green)', '#e05299', '#3aa0ff', '#f59e0b', '#a78bfa', '#34d399']
  const R = 52, sw = 16, C = 2 * Math.PI * R
  let acc = 0
  const segs = data.map((d, i) => {
    const frac = d.count / total
    const seg = { color: colors[i % colors.length], dash: frac * C, offset: -acc * C, pct: Math.round(frac * 100), ...d }
    acc += frac
    return seg
  })
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 140 140" className="donut-svg">
        <g transform="rotate(-90 70 70)">
          <circle cx="70" cy="70" r={R} fill="none" stroke="var(--bg)" strokeWidth={sw} />
          {segs.map((s, i) => (
            <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={s.color} strokeWidth={sw}
              strokeDasharray={`${s.dash} ${C - s.dash}`} strokeDashoffset={s.offset} />
          ))}
        </g>
        <text x="70" y="66" textAnchor="middle" className="donut-num">{total}</text>
        <text x="70" y="86" textAnchor="middle" className="donut-label">总工具</text>
      </svg>
      <div className="donut-legend">
        {segs.map((s, i) => (
          <div key={i} className="legend-row">
            <span className="legend-dot" style={{ background: s.color }} />
            <span className="legend-name">{s.category || '未分类'}</span>
            <span className="legend-val">{s.count} <span className="legend-pct">({s.pct}%)</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Stats() {
  const user = useAuthStore(s => s.user)
  const [stats, setStats] = useState(null)
  const [reqStats, setReqStats] = useState(null)
  const [purStats, setPurStats] = useState(null)
  const [sys, setSys] = useState(null)

  useEffect(() => {
    getStats().then(setStats).catch(() => {})
    getRequestStats().then(setReqStats).catch(() => {})
    getPurchaseStats().then(setPurStats).catch(() => {})
    let alive = true
    const tick = () => getSystem().then(d => alive && setSys(d)).catch(() => {})
    tick()
    const id = setInterval(tick, 30000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  // 按时段问候
  const hour = new Date().getHours()
  const greet = hour < 6 ? '凌晨好' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'

  const dl7 = stats?.downloads7d || []
  const recent7 = dl7.reduce((s, d) => s + d.count, 0)
  const tr = stats?.trends
  const sr = stats?.series || {}

  // 系统状态条（独立一行模块）
  const sysItems = [
    { label: '系统', val: sys ? (sys.ok ? '正常' : '异常') : '检测中', good: true },
    { label: 'CPU', val: sys ? `${sys.cpu}%` : '—' },
    { label: '内存', val: sys ? `${sys.memory}%` : '—' },
    { label: '硬盘', val: sys ? `${sys.disk}%` : '—' },
    { label: '在线', val: sys ? sys.online : '—' },
  ]

  // 数据概览卡片（每张右侧配趋势图）
  const cards = [
    { icon: '📦', cls: 'ic-a', spk: 'var(--accent)', label: '工具总数', val: stats?.totalTools, sub: stats?.recentAddedTools != null ? `最近新增 ${stats.recentAddedTools}` : '', trend: tr && trendOf(tr.toolsThis, tr.toolsPrev), spark: sr.tools },
    { icon: '👤', cls: 'ic-b', spk: 'var(--accent2)', label: '注册用户', val: stats?.totalUsers, sub: tr ? `本周 +${tr.usersThis}` : '', trend: tr && trendOf(tr.usersThis, tr.usersPrev), spark: sr.users },
    { icon: '⬇️', cls: 'ic-c', spk: '#3aa0ff', label: '累计下载', val: stats?.totalDownloads, sub: stats ? `近7天 +${recent7}` : '', trend: tr && trendOf(tr.downloadsThis, tr.downloadsPrev), spark: sr.downloads },
    { icon: '💬', cls: 'ic-d', spk: 'var(--warn)', label: '待处理需求', val: reqStats?.pending, sub: reqStats?.done != null ? `已完成 ${reqStats.done}` : '', spark: sr.requests },
    { icon: '💳', cls: 'ic-e', spk: '#e05299', label: '待确认购买', val: purStats?.pending, sub: '', spark: sr.purchases },
    { icon: '💰', cls: 'ic-f', spk: 'var(--green)', label: '累计收入', val: purStats ? `¥${purStats.revenue}` : null, sub: '', spark: sr.revenue },
  ]

  return (
    <>
      {/* 欢迎横幅（头部） */}
      <div className="admin-hero">
        <div className="admin-hero-main">
          <div className="admin-hero-greet">{greet}，{user?.username || 'admin'} <span>👋</span></div>
          <div className="admin-hero-sub">欢迎回来，今日系统运行{sys && !sys.ok ? '存在异常' : '一切正常'}</div>
        </div>
        <div className="admin-hero-art">📊</div>
      </div>

      {/* 系统状态（独立一行模块） */}
      <div className="sysbar-card">
        {sysItems.map((m, i) => (
          <div key={m.label} className="sysbar-item">
            {i === 0 && <span className={`sysbar-dot ${sys && !sys.ok ? 'bad' : 'ok'}`} />}
            <span className="sysbar-label">{m.label}</span>
            <span className={`sysbar-val ${m.good ? 'good' : ''}`}>{m.val}</span>
          </div>
        ))}
      </div>

      {/* 数据概览 */}
      <div className="admin-sec-head"><h2>数据概览</h2></div>
      <div className="stat-grid">
        {cards.map(c => (
          <div key={c.label} className="stat-card">
            <div className="stat-card-info">
              <div className="stat-card-top">
                <span className={`stat-card-icon ${c.cls}`}>{c.icon}</span>
                {c.trend && (
                  <span className={`stat-trend ${c.trend.up ? 'up' : 'down'}`}>
                    {c.trend.up ? '↑' : '↓'} {Math.abs(c.trend.pct)}%
                  </span>
                )}
              </div>
              <div className="stat-card-val">{c.val ?? '-'}</div>
              <div className="stat-card-label">{c.label}</div>
              {c.sub && <div className="stat-card-hint">{c.sub}</div>}
            </div>
            <div className="stat-card-spark"><Spark data={c.spark} color={c.spk} /></div>
          </div>
        ))}
      </div>

      {/* 图表区 */}
      <div className="chart-grid">
        <div className="chart-card">
          <div className="chart-title">最近 7 天下载趋势</div>
          <LineChart data={stats?.downloads7d} />
        </div>
        <div className="chart-card">
          <div className="chart-title">工具分类占比</div>
          <Donut data={stats?.categoryBreakdown} />
        </div>
      </div>

    </>
  )
}
