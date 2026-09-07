// =====================================================
// pages/Invest.jsx —— 「投资」模块：收息者买点评分卡
// 路由：/invest
// 职责：固定自选列表(8只: 3 ETF基准 + 5 个股) + 任意代码查询 + 个股五维评分详情
// 数据：GET /api/invest/watchlist · GET /api/invest/stock/{code}
// 定位：研究辅助,非投资建议(页面有免责与纪律区)。移动端：列表→全屏详情。
// =====================================================

import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../store/authStore'
import useToastStore from '../store/toastStore'

const GRADE_COLORS = { '击球区': '#16a34a', '逼近区': '#eab308', '观察区': '#f97316', '不符合': '#9ca3af' }
const fmt = (x, d = 1) => (x === null || x === undefined) ? '—' : Number(x).toFixed(d)

export default function Invest() {
  const navigate = useNavigate()
  const isAdmin = useAuthStore(st => st.user?.role === 'admin')
  const toast = useToastStore(st => st.toast)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState(null)        // 详情卡数据
  const [detailLoading, setDetailLoading] = useState(false)
  const [bt, setBt] = useState(null)                // 回测验证报告
  const [btOpen, setBtOpen] = useState(false)

  useEffect(() => {
    fetch('/api/invest/watchlist')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setErr('行情加载失败,稍后再试'); setLoading(false) })
    fetch('/api/invest/backtest-report')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setBt(d))
      .catch(() => {})
  }, [])

  const openDetail = (code) => {
    setDetailLoading(true)
    fetch(`/api/invest/stock/${code}`)
      .then(async r => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.message || '查询失败')
        setDetail(d)
      })
      .catch(e => setErr(e.message || '查询失败'))
      .finally(() => setDetailLoading(false))
  }

  const search = () => {
    let code = query.trim().replace(/\D/g, '')
    if (code.length >= 1 && code.length <= 4) code = code.padStart(5, '0')  // 港股短码补零(700→00700)
    if (code.length !== 5 && code.length !== 6) { setErr('请输入6位A股或5位港股代码'); return }
    setErr('')
    openDetail(code)
  }

  const toggleWatch = async (d) => {
    const inWatch = d.source === '自选'
    try {
      const r = await fetch(`/api/invest/watch/${d.code}`, {
        method: inWatch ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: inWatch ? undefined : JSON.stringify({ name: d.name }),
      })
      const res = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(res.message || '操作失败')
      setDetail({ ...d, source: inWatch ? '查询' : '自选' })
      toast(inWatch ? '已取消自选' : '已加入自选,榜单下次刷新生效')
    } catch (e) { toast(e.message || '操作失败', true) }
  }

  // —— 详情全屏视图 ——
  if (detail) {
    const d = detail
    const gc = GRADE_COLORS[d.grade] || 'var(--muted)'
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '0.8rem 1rem 5rem' }}>
        {/* 返回：箭头+标题整体可点 */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <button onClick={() => setDetail(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0, flex: 1 }}>
            <span style={{ color: 'var(--muted)', fontSize: 26, lineHeight: 1, padding: '0 4px' }}>‹</span>
            <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{d.name} {d.code}</span>
          </button>
          {isAdmin && (
            <button className="btn btn-ghost btn-sm" onClick={() => toggleWatch(d)} style={{ flexShrink: 0 }}>
              {d.source === '自选' ? '★ 取消自选' : '☆ 加自选'}
            </button>
          )}
        </div>

        {/* 介绍说明：这家做什么(行业 + 主营一句话) */}
        {d.type !== 'etf' && (d.intro || (d.industry && d.industry !== '其他')) && (
          <div style={{ marginBottom: 10, padding: '0.6rem 0.8rem', borderRadius: 10, background: 'rgba(148,163,184,0.12)', fontSize: 13, lineHeight: 1.65, color: 'var(--text)' }}>
            <span style={{ fontWeight: 700 }}>📇 这家公司做什么</span>
            {d.industry && d.industry !== '其他' && (
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--accent)', background: 'rgba(14,165,233,0.12)', borderRadius: 6, padding: '1px 8px' }}>{d.industry}</span>
            )}
            {d.intro
              ? <div style={{ marginTop: 4, color: 'var(--muted)' }}>{d.intro}</div>
              : <div style={{ marginTop: 4, color: 'var(--muted)' }}>主营简介暂缺,以下为评分详情。</div>}
          </div>
        )}

        {/* 总分卡 */}
        <div style={{ background: 'var(--surface)', border: `1px solid ${gc}55`, borderRadius: 14, padding: '1rem', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 40, fontWeight: 800, color: gc }}>{d.score}</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: gc }}>{d.grade}</span>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>满分100 · 分越高当前越值得买</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 6 }}>
            {d.type === 'etf'
              ? <>现价 ¥{d.price} · 总回报口径（分红含在净值里,细节以基金公告为准）</>
              : d.market === 'hk'
                ? <>现价 {d.currency}{d.price} · 🇭🇰{d.hkShareType} · <b>税后到手息 {d.divYield}%</b>（毛息 {d.grossDivYield}%，已扣港股通红利税{d.hkTaxRate}%）· PE {fmt(d.pe)} · PB {fmt(d.pb, 2)}</>
                : <>现价 ¥{d.price} · 股息率 {d.divYield}%（TTM每股分红 ¥{fmt(d.divTtm, 3)}）· PE {fmt(d.pe)} · PB {fmt(d.pb, 2)} · 市值 {fmt(d.mktCapYi, 0)} 亿</>}
          </div>
          {d.hkTaxNote && (
            <div style={{ fontSize: 11.5, color: '#dc2626', marginTop: 4 }}>ⓘ {d.hkTaxNote}</div>
          )}
          {/* A/H 对比：同一公司在A股/港股都在池里时,并排比到手收益 */}
          {(() => {
            if (!d.ahKey || !data?.items) return null
            const twin = data.items.find(x => x.ahKey === d.ahKey && x.market && x.market !== d.market && x.type === 'stock')
            if (!twin) return null
            const better = (twin.divYield || 0) > (d.divYield || 0)
            return (
              <div style={{ fontSize: 12.5, marginTop: 8, padding: '0.55rem 0.7rem', borderRadius: 8, background: 'rgba(139,92,246,0.10)', border: '1px solid rgba(139,92,246,0.3)', lineHeight: 1.7 }}>
                🔀 <b>A/H 对比</b>（同一家公司，比税后到手息）<br />
                当前{d.market === 'hk' ? '🇭🇰H股' : '🇨🇳A股'} {d.code}：到手息 <b>{d.divYield}%</b> · 分{d.score}<br />
                另一边{twin.market === 'hk' ? '🇭🇰H股' : '🇨🇳A股'} {twin.code}：到手息 <b>{twin.divYield}%</b> · 分{twin.score}
                <span style={{ color: better ? '#dc2626' : 'var(--green)', fontWeight: 700 }}>
                  {'　'}→ {better ? '另一边到手息更高' : '当前这边到手息更高'}
                </span>
                <button onClick={() => openDetail(twin.code)} style={{ marginLeft: 6, fontSize: 11, background: 'none', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 6, padding: '1px 8px', cursor: 'pointer' }}>看另一边 ›</button>
              </div>
            )
          })()}
          <div style={{ fontSize: 13, marginTop: 8, padding: '0.5rem 0.7rem', borderRadius: 8, background: 'rgba(14,165,233,0.08)', color: 'var(--text)' }}>
            🎯 {d.strikeNote}
          </div>
          {d.score >= 90 && (
            <div style={{ fontSize: 13, marginTop: 8, padding: '0.5rem 0.7rem', borderRadius: 8, border: '1px solid #f59e0b', background: 'rgba(245,158,11,0.12)', fontWeight: 700 }}>
              🔥 重仓级机会（≥90分）——历史罕见的深度低估,核对基本面后可按纪律动用重仓资金
            </div>
          )}
          {d.verdict && (
            <div style={{ fontSize: 13, marginTop: 8, padding: '0.5rem 0.7rem', borderRadius: 8, background: 'rgba(22,163,74,0.08)', color: 'var(--text)', lineHeight: 1.6 }}>
              💬 {d.verdict}
            </div>
          )}
        </div>

        {/* 买入参考三档 */}
        {d.buyBands && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '1rem', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>买入参考</div>
            <div style={{ display: 'flex', gap: 8, textAlign: 'center' }}>
              <div style={{ flex: 1, padding: '0.55rem 0.3rem', borderRadius: 10, background: 'var(--surface2)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>现价</div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>¥{d.price}</div>
              </div>
              <div style={{ flex: 1, padding: '0.55rem 0.3rem', borderRadius: 10, background: 'rgba(234,179,8,0.12)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>建议买入(80分)</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#eab308' }}>{d.buyBands.suggest ? `¥${d.buyBands.suggest}` : '—'}</div>
              </div>
              <div style={{ flex: 1, padding: '0.55rem 0.3rem', borderRadius: 10, background: 'rgba(22,163,74,0.12)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>重仓(90分)</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#16a34a' }}>{d.buyBands.heavy ? `¥${d.buyBands.heavy}` : '—'}</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
              分批纪律：到建议价买 1/3,再跌 8% 补 1/3,重仓价以下才用最后 1/3。
            </div>
          </div>
        )}

        {/* 五维明细 */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '1rem', marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>五维评分</div>
          {d.dims.map(dim => (
            <div key={dim.key} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                <span style={{ fontWeight: 600 }}>{dim.key} · {dim.name}</span>
                <span style={{ color: 'var(--muted)' }}>{dim.score}/{dim.max}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--surface2)', overflow: 'hidden' }}>
                <div style={{ width: `${100 * dim.score / dim.max}%`, height: '100%', borderRadius: 3, background: 'linear-gradient(90deg,#0ea5e9,#0369a1)' }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{dim.detail}</div>
            </div>
          ))}
        </div>

        {/* 回报预估 */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '1rem', marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>预期年化回报（保守估）</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 28, fontWeight: 800, color: d.expReturn >= 12 ? '#16a34a' : d.expReturn >= 8 ? '#eab308' : '#9ca3af' }}>{d.expReturn}%</span>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>{d.expReturnNote}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
            = 股息率 + 分红增长(近8年回归打对折) ± 股息率分位修正 · 对照锚：红利ETF长期约8–10%
          </div>
        </div>

        {/* 价格统计 */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '1rem', marginBottom: 10, fontSize: 13 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>价格统计（十年月线）</div>
          <Spark spark={d.spark} price={d.price} strike={d.buyBands?.suggest} />
          {d.type !== 'etf' && d.divYieldPct10y != null && <>股息率分位 {d.divYieldPct10y}%(高=便宜) · </>}
          价格分位 {d.pricePercentile10y}% · 年化波动 {d.annVol}% · 最大回撤 {d.maxDrawdown10y}%
          <div style={{ marginTop: 4, color: 'var(--muted)' }}>
            持有年化：{['1年', '2年', '3年', '4年', '5年'].map(k => `${k} ${fmt(d.annReturns?.[k])}%`).join(' · ')}
            {d.type === 'etf' ? (d.trBased ? '（累计净值，含分红）' : '（价格口径，不含分红）') : '（价格口径，不含分红，股息另算）'}
          </div>
        </div>

        {/* 回本 + 适合谁 */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '1rem', marginBottom: 10, fontSize: 13 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>这只股适合你吗</div>
          {d.type !== 'etf' && (
            <div style={{ marginBottom: 6 }}>
              ⏳ 股息回本：{d.paybackYears ? `约 ${d.paybackYears} 年回本(按当前股息+增长复利,不算股价涨跌)` : '当前无分红,谈不上回本'}
            </div>
          )}
          <div style={{ color: '#16a34a' }}>✔ 适合：{(d.suitability?.fit || []).join('；')}</div>
          <div style={{ color: '#ef4444', marginTop: 3 }}>✘ 不适合：{(d.suitability?.unfit || []).join('；')}</div>
        </div>

        {/* 小白话名词解释（默认收起） */}
        <details style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '0.9rem 1rem', marginBottom: 10, fontSize: 13, lineHeight: 1.9 }}>
          <summary style={{ fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>📖 看不懂？名词秒懂（小白版）</summary>
          <div style={{ marginTop: 8, color: 'var(--text)' }}>
            <b>股息率</b>：花100块买它，一年发你几块钱现金红包。息7% = 每年到手7块。<br />
            <b>股息率分位（高=便宜）</b>：把现在的"发红包比例"放进它自己过去十年里排名。99% = 十年里最划算的档位；10% = 红包比例快到十年最低，买贵了。<br />
            <b>价格分位</b>：现价在过去十年价格里的排位。90% = 比十年里九成时间都贵。<br />
            <b>持有年化</b>：假设N年前买入拿到今天，平均每年赚（亏）百分之几。<br />
            <b>年化波动</b>：价格颠簸程度，数字越大坐得越晕。20%以下算平稳。<br />
            <b>最大回撤</b>：十年里从最高点最惨跌过多少。55% = 腰斩过——买前先问自己：跌一半睡得着吗？<br />
            <b>PE（市盈率）</b>：按现在的利润，几年能把整个公司"赚"回来。7倍 ≈ 7年回本，越低越便宜。<br />
            <b>PB（市净率）</b>：股价是公司家底（净资产）的几倍。低于1倍 = 按家底打折卖。<br />
            <b>对国债利差</b>：比"把钱借给国家"（最安全的收益）多赚几个点，这是你冒风险应得的补偿。<br />
            <b>击球价（80分）</b>：跌到这个价，综合评分进入"值得分批买入"区。<br />
            <b>重仓价（90分）</b>：历史级便宜、可以下重手的价格（单只仓位纪律照守）。<br />
            <b>预期年化回报</b>：按当前分红 + 分红增长毛估的长期年收益，是估算不是保证。<br />
            <b>股息回本</b>：不看股价涨跌，光靠每年分红几年收回本金。<br />
            <b>五维评分</b>：A股息（发多少钱）/ B可靠（会不会赖账）/ C买点（贵不贵）/ D风险（稳不稳）/ E存续（这门生意还能做多久），满分100，分越高当前越值得买。
          </div>
        </details>

        <Disclaimer bond={d.bondYield} />
      </div>
    )
  }

  // —— 列表视图 ——
  const items = data?.items || []
  const stocks = items.filter(i => i.score !== null && i.score !== undefined).sort((a, b) => b.score - a.score)
  const errors = items.filter(i => i.error)

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '0.8rem 1rem 5rem' }}>
      <h2 style={{ margin: '0 0 2px', fontSize: 20 }}>📈 高股息投资 · 买点评分卡</h2>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        收息视角五维评分（股息30/可靠25/买点20/风险15/存续10）· 满分100,分越高当前越值得买 · A股与🇭🇰港股同榜（港股按扣20%红利税后的到手息比较）· 研究辅助,非投资建议
        {data?.updatedAt && <span> · 数据更新 {new Date(data.updatedAt).toLocaleString('zh-CN',{hour12:false,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}（每交易日16:05定点刷新）</span>}
      </div>

      {/* 模型回测验证 —— point-in-time 历史回测,零偷看未来 */}
      {bt && (() => {
        const ic12 = bt.rankic?.['12']?.ic ?? 0
        const pf = bt.portfolio
        const P = pf?.portfolios || {}
        const excess = pf?.full_vs_bench?.excess_ann
        const ir = pf?.full_vs_bench?.ir
        const win = pf?.full_vs_bench
        const dn = { A: '股息', B: '可靠', C: '买点', D: '风险', E: '存续' }
        const pct = x => (x == null ? '—' : (x * 100).toFixed(1) + '%')
        return (
          <div style={{ margin: '0 0 12px', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <button onClick={() => setBtOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '0.6rem 0.8rem', background: 'rgba(22,163,74,0.08)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 15 }}>🔬</span>
              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>模型已历史回测验证</span>
              {excess != null && <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 700 }}>十年年化跑赢红利基准 +{(excess * 100).toFixed(1)}pp</span>}
              <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12 }}>{btOpen ? '收起 ▲' : '详情 ▼'}</span>
            </button>
            {btOpen && (
              <div style={{ padding: '0.7rem 0.9rem', fontSize: 12.5, color: 'var(--text)', lineHeight: 1.7 }}>
                <div style={{ color: 'var(--muted)', marginBottom: 6 }}>
                  用 {bt.universe} 只 A 股 · {bt.window} 全历史,每月末按“当天能看到的信息”重打分（不偷看未来），共 {bt.obs?.toLocaleString?.() || bt.obs} 次打分。
                </div>
                {pf && (
                  <div style={{ margin: '2px 0 6px', padding: '6px 8px', borderRadius: 8, background: 'rgba(22,163,74,0.06)' }}>
                    <b>组合实测</b>（按分数选前10只、月度调仓、含成本；池含53只退市暴雷股,已修正幸存者偏差）：
                    年化 <b style={{ color: '#16a34a' }}>{pct(P.full?.ann)}</b> vs 红利ETF基准 {pct(P.bench?.ann)} ——
                    超额 <b>+{excess != null ? (excess * 100).toFixed(1) : '—'}pp/年</b>、信息比率 {ir}、分年胜率 {win?.win_years}/{win?.total_years}、最大回撤 {pct(P.full?.mdd)}。
                  </div>
                )}
                {P.naive && (
                  <div style={{ margin: '2px 0', color: 'var(--text)' }}>
                    <b>为什么要五维、不能只追高息</b>：只按股息率排前10只,年化 <b style={{ color: '#ef4444' }}>{pct(P.naive.ann)}</b>、最大回撤 <b style={{ color: '#ef4444' }}>{pct(P.naive.mdd)}</b> —— 一头扎进暴雷高息股(如退市地产)。模型靠可靠/买点/风险维把这些陷阱挡在组合外。
                  </div>
                )}
                <div><b>排序能力</b>：分数越高、未来 12 个月收益越高——RankIC {ic12 >= 0 ? '+' : ''}{ic12.toFixed(2)}（&gt;0.03 即有效,分层高分档 +13% → 低分档 −3% 单调递减）。</div>
                <div style={{ margin: '4px 0' }}>
                  <b>各维贡献</b>（含暴雷样本检验）：{['A', 'B', 'C', 'D', 'E'].map(k => {
                    const v = bt.dim_ic?.[k]?.ic ?? 0
                    const strong = v >= 0.15
                    return <span key={k} style={{ display: 'inline-block', marginRight: 8, color: strong ? '#16a34a' : 'var(--text)' }}>{dn[k]} {v >= 0 ? '+' : ''}{v.toFixed(2)}</span>
                  })}
                  <span style={{ color: 'var(--muted)' }}>——五维均有效;风险维(风险/存续)把回撤从23%压到16%。</span>
                </div>
                {bt.hk && (
                  <div style={{ marginTop: 4, padding: '6px 8px', borderRadius: 8, background: 'rgba(234,179,8,0.10)', color: 'var(--text)' }}>
                    <b>⚠️ 港股另说</b>：港股样本小(32只)、数据弱,回测里本模型<b>跑输"等权持有全部港股红利股"</b>
                    （全模型年化 {(bt.hk.portfolios?.full?.ann * 100).toFixed(1)}% vs 整篮子 {(bt.hk.portfolios?.basket?.ann * 100).toFixed(1)}%）——
                    A 股模型不迁移到港股。<b>港股评分仅供参考,勿据以重仓</b>;A 股结论不受影响(两市分开)。
                  </div>
                )}
                <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--muted)' }}>
                  point-in-time 口径（财报按披露日、分红按除息日、后复权算收益）· A股已含退市股修正幸存者偏差 · 生成于 {bt.generated} · 研究验证,非投资建议。
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* 使用须知：这是筛子不是下单按钮,四条纪律 */}
      <details style={{ margin: '0 0 12px', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <summary style={{ padding: '0.6rem 0.8rem', background: 'rgba(234,179,8,0.08)', cursor: 'pointer', fontWeight: 700, fontSize: 13, color: 'var(--text)', listStyle: 'none' }}>
          📋 使用须知（点开看,这是筛子不是下单按钮）
        </summary>
        <div style={{ padding: '0.7rem 0.9rem', fontSize: 12.5, lineHeight: 1.75, color: 'var(--text)' }}>
          <div style={{ marginBottom: 5 }}><b>1. 它验证过的是「选股+买点」,不是仓位和卖出。</b>用它找候选和击球价,按纪律<b>分批建仓、行业分散</b>(同业≥3只会一起涨跌,别把机会全给一个行业);别看到 ≥80 就满仓。</div>
          <div style={{ marginBottom: 5 }}><b>2. 模型已冻结。</b>回测的封存测试期已用掉,再改评分口径就没有干净的样本外能验了——除非有新数据、另立新测试期,否则不再改。</div>
          <div style={{ marginBottom: 5 }}><b>3. 实盘收益大概率低于回测,别据此加杠杆。</b>回测天然偏乐观,且 2016–2025 是红利风格大年。这是<b>红利/价值策略,风格逆风时会跑输</b>,得扛得住(历史上最高分档也有过约 16% 回撤)。</div>
          <div><b>4. 港股评分仅供参考。</b>回测显示本模型在港股不成立(跑输整篮子),港股别据以重仓。</div>
          <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 11.5 }}>本工具为研究验证与决策辅助,非投资建议;盈亏自负。</div>
        </div>
      </details>

      {/* 查询任意个股 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          className="input" value={query} placeholder="A股6位或港股5位代码,如 601088 / 00700"
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          style={{ flex: 1, minWidth: 0, fontSize: 16 }}
        />
        <button className="btn btn-primary" onClick={search} disabled={detailLoading}
          style={{ flexShrink: 0 }}>{detailLoading ? '查询中…' : '评分'}</button>
      </div>
      {err && <div style={{ fontSize: 13, color: '#ef4444', marginBottom: 10 }}>{err}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '3rem' }}>行情加载中…</div>
      ) : (
        <>
          {/* 90+ 重仓级机会横幅 */}
          {stocks.filter(s => s.score >= 90).length > 0 && (
            <div style={{ margin: '2px 0 10px', padding: '0.7rem 0.9rem', borderRadius: 12, border: '1.5px solid #f59e0b', background: 'rgba(245,158,11,0.12)', fontSize: 13, fontWeight: 700 }}>
              🔥 重仓级机会（≥90分）：{stocks.filter(s => s.score >= 90).map(s => `${s.name} ${s.score}分`).join('、')}
            </div>
          )}

          {/* 击球区行业集中提示：同业≥3只会一起涨跌,别把三次买入机会全给一个行业 */}
          {(() => {
            const cnt = {}
            stocks.filter(s => s.score >= 80 && s.type !== 'etf').forEach(s => { cnt[s.industry] = (cnt[s.industry] || 0) + 1 })
            const hot = Object.entries(cnt).filter(([, v]) => v >= 3)
            return hot.length > 0 && (
              <div style={{ margin: '2px 0 10px', padding: '0.6rem 0.9rem', borderRadius: 12, border: '1px solid #f97316', background: 'rgba(249,115,22,0.08)', fontSize: 12.5 }}>
                ⚠️ 击球区集中于 {hot.map(([k, v]) => `${k}(${v}只)`).join('、')}——同业股价共振,集体亮灯≠该行业买三份,行业总仓位单算
              </div>
            )
          })()}

          {/* 个股卡 */}
          <div style={{ fontWeight: 700, fontSize: 14, margin: '4px 0 8px' }}>
            买点排行 <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--muted)' }}>（自选 + 4只A股红利ETF + 2只港股高息ETF合并成分 · 随指数调仓）</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stocks.map(s => {
              const gc = GRADE_COLORS[s.grade] || 'var(--muted)'
              const hot = s.score >= 90
              return (
                <div key={s.code} onClick={() => openDetail(s.code)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, background: hot ? 'rgba(245,158,11,0.10)' : 'var(--surface)', border: hot ? '1.5px solid #f59e0b' : '1px solid var(--border)', borderRadius: 12, padding: '0.75rem 0.9rem', cursor: 'pointer', boxShadow: hot ? '0 0 12px rgba(245,158,11,0.25)' : 'none' }}>
                  <div style={{ minWidth: 62, textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: gc, lineHeight: 1.1 }}>{s.score}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: gc }}>{s.grade}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      {s.score >= 90 && <span style={{ marginRight: 4 }}>🔥</span>}
                      {s.market === 'hk' && <span style={{ marginRight: 4 }} title="港股">🇭🇰</span>}{s.name}{' '}
                      <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>{s.code}</span>
                      {s.market === 'hk' && <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 6, background: 'rgba(220,38,38,0.13)', color: '#dc2626', fontWeight: 600 }}>港股·税后</span>}
                      {s.type === 'etf' && <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 6, background: 'rgba(139,92,246,0.15)', color: '#8b5cf6', fontWeight: 600 }}>ETF</span>}
                      {s.source === '红利成分' && <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 6, background: 'rgba(14,165,233,0.15)', color: '#0ea5e9', fontWeight: 600 }}>指数</span>}
                      {s.stale && <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 6, background: 'rgba(249,115,22,0.15)', color: '#f97316', fontWeight: 600 }}>旧数据</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      {s.currency || '¥'}{s.price}{s.type === 'etf' ? ' · 总回报口径' : ` · ${s.market === 'hk' ? '税后息' : '息'}${s.divYield}%`} · 预期年化{s.expReturn}%
                      {s.strikePrice ? ` · 击球价${s.currency || '¥'}${s.strikePrice}` : ''}
                    </div>
                  </div>
                  <span style={{ color: 'var(--muted)', fontSize: 18 }}>›</span>
                </div>
              )
            })}
          </div>

          {errors.length > 0 && (
            <div style={{ fontSize: 12, color: '#f97316', marginTop: 10 }}>
              {errors.map(e => <div key={e.code}>⚠️ {e.name}({e.code}) 加载失败</div>)}
            </div>
          )}

          <Disclaimer bond={data?.bondYield} />
        </>
      )}
    </div>
  )
}

// 十年月线走势图：SVG 折线 + 现价点 + 击球价虚线
function Spark({ spark, price, strike }) {
  const cs = (spark?.closes || []).map(Number)
  if (cs.length < 2) return null
  const all = [...cs, price, ...(strike ? [strike] : [])]
  const min = Math.min(...all), max = Math.max(...all), span = max - min || 1
  const W = 320, H = 72
  const x = i => (i / (cs.length - 1)) * W
  const y = v => H - 6 - ((v - min) / span) * (H - 12)
  const pts = cs.map((c, i) => `${x(i).toFixed(1)},${y(c).toFixed(1)}`).join(' ')
  const dates = spark?.dates || []
  return (
    <div style={{ marginBottom: 6 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <polyline points={pts} fill="none" stroke="#0ea5e9" strokeWidth="1.6" />
        {strike && <line x1="0" x2={W} y1={y(strike)} y2={y(strike)} stroke="#16a34a" strokeWidth="1" strokeDasharray="4 3" />}
        <circle cx={W} cy={y(price)} r="3" fill="#ef4444" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)' }}>
        <span>{String(dates[0] || '').slice(0, 7)}</span>
        <span>🔴 现价 ¥{price}{strike ? ` · ┄ 击球价 ¥${strike}` : ''}</span>
        <span>{String(dates[dates.length - 1] || '').slice(0, 7)}</span>
      </div>
    </div>
  )
}

function Disclaimer({ bond }) {
  return (
    <div style={{ marginTop: 16, padding: '0.9rem 1rem', borderRadius: 12, background: 'var(--surface2)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
      <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>📌 四条铁纪律</div>
      1. 只用五年不用的闲钱；2. 击球价买1/3,再跌8%补1/3,留1/3应对黑天鹅；<br />
      3. 单只 ≤30% 仓位；4. 卡说不买就不买——收息投资九成的亏损来自买贵了。
      <div style={{ marginTop: 6 }}>
        参数：十年国债收益率 {bond ?? 1.75}%（每日自动拉取,源故障时回退1.75）。数据来自公开免费行情与财报接口,可能延迟或有误,
        评分为规则计算的研究辅助,<b>不构成投资建议</b>,盈亏自负。
      </div>
    </div>
  )
}
