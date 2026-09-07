import { useState, useEffect, useRef } from 'react'
import { getAccessLogs, getAccessLogStats, cleanupAccessLogs, clearAllAccessLogs } from '../../api/admin'

const TAB_LIST  = 'list'
const TAB_STATS = 'stats'

export default function AdminAccessLogs() {
  const [tab, setTab]         = useState(TAB_LIST)
  const [logs, setLogs]       = useState([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [loading, setLoading] = useState(false)
  const [stats, setStats]     = useState(null)

  const [filterIp,       setFilterIp]       = useState('')
  const [filterPath,     setFilterPath]      = useState('')
  const [filterDateFrom, setFilterDateFrom]  = useState('')
  const [filterDateTo,   setFilterDateTo]    = useState('')

  const pageSize = 50
  const canvasRef = useRef(null)

  const fetchLogs = async (p = 1) => {
    setLoading(true)
    try {
      const data = await getAccessLogs({
        page: p, pageSize,
        ip:       filterIp       || undefined,
        path:     filterPath     || undefined,
        dateFrom: filterDateFrom || undefined,
        dateTo:   filterDateTo   || undefined,
      })
      setLogs(data.items)
      setTotal(data.total)
      setPage(p)
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    const data = await getAccessLogStats()
    setStats(data)
  }

  useEffect(() => { fetchLogs(1) }, [])
  useEffect(() => { if (tab === TAB_STATS) fetchStats() }, [tab])
  useEffect(() => { if (stats && canvasRef.current) drawChart(stats.hourly) }, [stats])

  const drawChart = (hourly) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const pad = { top: 10, right: 10, bottom: 30, left: 36 }
    const max = Math.max(...hourly, 1)
    ctx.clearRect(0, 0, W, H)

    const innerW = W - pad.left - pad.right
    const innerH = H - pad.top - pad.bottom
    const barW   = innerW / 24

    // 网格线
    ctx.strokeStyle = '#2a2a38'
    ctx.lineWidth   = 1
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + innerH - (i / 4) * innerH
      ctx.beginPath()
      ctx.moveTo(pad.left, y)
      ctx.lineTo(pad.left + innerW, y)
      ctx.stroke()
      ctx.fillStyle = '#6b6b80'
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(Math.round(max * i / 4), pad.left - 4, y + 3)
    }

    // 柱子
    hourly.forEach((v, h) => {
      const barH = (v / max) * innerH
      const x    = pad.left + h * barW + 2
      const y    = pad.top + innerH - barH
      ctx.fillStyle = '#6366f1'
      ctx.fillRect(x, y, barW - 4, barH)
      if (h % 4 === 0) {
        ctx.fillStyle = '#6b6b80'
        ctx.font = '10px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(`${h}时`, x + (barW - 4) / 2, H - 8)
      }
    })
  }

  const handleCleanup = async (days) => {
    if (!window.confirm(`确定要删除 ${days} 天前的访问记录吗？`)) return
    const { deleted } = await cleanupAccessLogs(days)
    alert(`已删除 ${deleted} 条记录`)
    fetchLogs(1)
    if (tab === TAB_STATS) fetchStats()
  }

  const handleClearAll = async () => {
    if (!window.confirm('确定要清空所有访问记录吗？此操作不可恢复！')) return
    const { deleted } = await clearAllAccessLogs()
    alert(`已清空 ${deleted} 条记录`)
    setLogs([])
    setTotal(0)
    setStats(null)
    if (tab === TAB_STATS) fetchStats()
  }

  const statusColor = (code) => {
    if (code >= 500) return '#ef4444'
    if (code >= 400) return '#f59e0b'
    if (code >= 300) return '#6366f1'
    return '#10b981'
  }

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>访问记录</h2>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>共 {total} 条</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => handleCleanup(30)}
            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #d1d5db',
              background: '#fff', cursor: 'pointer', fontSize: 13 }}>
            清理 30 天前
          </button>
          <button onClick={handleClearAll}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none',
              background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            一键清空
          </button>
        </div>
      </div>

      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid #e5e7eb' }}>
        {[{ key: TAB_LIST, label: '访问列表' }, { key: TAB_STATS, label: '统计概览' }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '8px 20px', border: 'none', cursor: 'pointer', fontSize: 14,
              background: 'none', fontWeight: tab === t.key ? 700 : 400,
              color: tab === t.key ? '#6366f1' : 'var(--muted)',
              borderBottom: tab === t.key ? '2px solid #6366f1' : '2px solid transparent',
              marginBottom: -1,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === TAB_LIST && (
        <>
          {/* 筛选栏 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <input value={filterIp} onChange={e => setFilterIp(e.target.value)}
              placeholder="IP 筛选"
              style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6,
                fontSize: 14, width: 140 }} />
            <input value={filterPath} onChange={e => setFilterPath(e.target.value)}
              placeholder="路径关键字"
              style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6,
                fontSize: 14, width: 180 }} />
            <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }} />
            <span style={{ lineHeight: '34px', color: 'var(--muted)' }}>至</span>
            <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }} />
            <button onClick={() => fetchLogs(1)}
              style={{ padding: '6px 16px', borderRadius: 6, border: 'none',
                background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 14 }}>
              查询
            </button>
            <button onClick={() => {
              setFilterIp(''); setFilterPath(''); setFilterDateFrom(''); setFilterDateTo('')
              setTimeout(() => fetchLogs(1), 0)
            }}
              style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #d1d5db',
                background: '#fff', cursor: 'pointer', fontSize: 14 }}>
              重置
            </button>
          </div>

          {/* 表格 */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                  {['时间', 'IP', '方法', '路径', '状态', '耗时', '用户'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb',
                      fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>加载中…</td></tr>
                ) : logs.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>暂无记录</td></tr>
                ) : logs.map(row => (
                  <tr key={row.id} style={{ borderBottom: '1px solid #f3f4f6' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={{ padding: '7px 12px', whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                      {new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false })}
                    </td>
                    <td style={{ padding: '7px 12px', fontFamily: 'monospace' }}>{row.ip}</td>
                    <td style={{ padding: '7px 12px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        background: row.method === 'GET' ? '#dbeafe' : '#fce7f3',
                        color: row.method === 'GET' ? '#1d4ed8' : '#be185d' }}>
                        {row.method}
                      </span>
                    </td>
                    <td style={{ padding: '7px 12px', maxWidth: 300, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.path}>
                      {row.path}
                    </td>
                    <td style={{ padding: '7px 12px' }}>
                      <span style={{ fontWeight: 600, color: statusColor(row.statusCode) }}>
                        {row.statusCode}
                      </span>
                    </td>
                    <td style={{ padding: '7px 12px', color: row.durationMs > 1000 ? '#ef4444' : 'var(--muted)' }}>
                      {row.durationMs}ms
                    </td>
                    <td style={{ padding: '7px 12px', color: 'var(--muted)' }}>
                      {row.username ?? <span style={{ fontSize: 11 }}>匿名</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 20, flexWrap: 'wrap' }}>
              <button disabled={page <= 1} onClick={() => fetchLogs(page - 1)}
                style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #d1d5db',
                  background: '#fff', cursor: page <= 1 ? 'default' : 'pointer',
                  opacity: page <= 1 ? 0.4 : 1 }}>上一页</button>
              <span style={{ padding: '5px 12px', color: 'var(--muted)', fontSize: 13 }}>
                第 {page} / {totalPages} 页
              </span>
              <button disabled={page >= totalPages} onClick={() => fetchLogs(page + 1)}
                style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #d1d5db',
                  background: '#fff', cursor: page >= totalPages ? 'default' : 'pointer',
                  opacity: page >= totalPages ? 0.4 : 1 }}>下一页</button>
            </div>
          )}
        </>
      )}

      {tab === TAB_STATS && (
        <div>
          {!stats ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--muted)' }}>加载中…</div>
          ) : (
            <>
              {/* 数据卡片 */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
                {[
                  { label: '今日 PV',  value: stats.todayPv,     color: '#818cf8' },
                  { label: '今日 UV',  value: stats.todayUv,     color: '#34d399' },
                  { label: '今日错误', value: stats.todayErrors,  color: '#f87171' },
                ].map(c => (
                  <div key={c.label} style={{
                    flex: '1 1 140px', background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '18px 24px', textAlign: 'center'
                  }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: c.color }}>{c.value}</div>
                    <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 4 }}>{c.label}</div>
                  </div>
                ))}
              </div>

              {/* 24 小时趋势图 */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                padding: 20, marginBottom: 24 }}>
                <div style={{ fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>今日 24 小时请求分布</div>
                <canvas ref={canvasRef} width={700} height={160}
                  style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>

              {/* Top 路径 / Top IP */}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {[
                  { title: 'Top 10 路径', data: stats.topPaths, keyField: 'path' },
                  { title: 'Top 10 IP',   data: stats.topIps,   keyField: 'ip'   },
                ].map(({ title, data, keyField }) => (
                  <div key={title} style={{ flex: '1 1 300px', background: 'var(--surface)',
                    border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
                    <div style={{ fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>{title}</div>
                    {data.map((row, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between',
                        padding: '6px 0', borderBottom: i < data.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap', flex: 1, marginRight: 12, fontFamily: keyField === 'ip' ? 'monospace' : '' }}>
                          {row[keyField]}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#6366f1', flexShrink: 0 }}>
                          {row.count}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
