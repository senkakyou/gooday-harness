// =====================================================
// pages/home/ToolsSection.jsx —— 首页搜索 + 今日热门 + 分类筛选 + 工具列表
// 从 Home.jsx 抽离的展示组件，数据/回调由父组件传入
// =====================================================

import React from 'react'
import ToolCard from '../../components/ToolCard'
import { CAT_ICONS, RANK_COLORS } from './gachaAssets'

export default function ToolsSection({
  search, setSearch, activeCat, setActiveCat,
  hotTools, categories, filtered, toolsSectionRef, onOpenTool,
  favIds, onToggleFavorite, highlightId,
}) {
  return (
    <>
      {/* Search */}
      <div style={{ position: 'relative', margin: '0.875rem 0 0.75rem' }}>
        <span style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', fontSize:16, color:'var(--muted)', pointerEvents:'none' }}>🔍</span>
        <input
          type="text"
          placeholder="搜索 工具、脚本、教程..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width:'100%', boxSizing:'border-box',
            background:'var(--surface)', border:'1px solid var(--border)',
            color:'var(--text)', padding:'11px 95px 11px 44px',
            borderRadius:12, fontFamily:'var(--sans)', fontSize: 16, outline:'none',
          }}
          onFocus={e => e.target.style.borderColor='var(--accent)'}
          onBlur={e => e.target.style.borderColor='var(--border)'}
        />
        <span style={{
          position:'absolute', right:10, top:'50%', transform:'translateY(-50%)',
          fontSize:11, color:'var(--muted)', fontFamily:'var(--mono)',
          background:'var(--surface2)', padding:'3px 8px', borderRadius:6,
          border:'1px solid var(--border)', pointerEvents:'none',
        }}>⌘ Search</span>
      </div>

      {/* Hot Tools */}
      {!search && activeCat === 'all' && hotTools.length > 0 && (
        <div style={{ marginBottom:'1.25rem' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.75rem' }}>
            <span style={{ fontSize:14, fontWeight:700 }}>🔥 今日热门</span>
            <button
              onClick={() => toolsSectionRef.current?.scrollIntoView({ behavior:'smooth' })}
              style={{ background:'none', border:'none', color:'var(--muted)', fontSize:12, cursor:'pointer', fontFamily:'var(--mono)' }}
            >查看全部 ›</button>
          </div>
          <div style={{ display:'flex', gap:'0.6rem', overflow:'auto', scrollbarWidth:'none', paddingBottom:6 }}>
            {hotTools.map((t, i) => (
              <div
                key={t.id}
                onClick={() => onOpenTool(t.slug)}
                style={{
                  flexShrink:0, width:130,
                  background:'var(--surface)', border:'1px solid var(--border)',
                  borderRadius:14, padding:'0.75rem 0.7rem',
                  cursor:'pointer', position:'relative', transition:'border-color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor='var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor='var(--border)'}
              >
                <div style={{
                  position:'absolute', top:8, left:8,
                  width:20, height:20, borderRadius:'50%',
                  background: RANK_COLORS[i] || '#6b7280',
                  color:'#fff', fontSize:10, fontWeight:700, fontFamily:'var(--mono)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}>{i + 1}</div>
                <div style={{ fontSize:32, textAlign:'center', margin:'4px 0 7px' }}>{t.iconEmoji}</div>
                <div style={{
                  fontWeight:700, fontSize:12, lineHeight:1.3, marginBottom:4,
                  display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden',
                }}>{t.name}</div>
                <div style={{ fontSize:10, color:'var(--muted)', marginBottom:5 }}>{t.category}</div>
                <div style={{ fontSize:11, color:'var(--muted)' }}>🔥 {t.viewCount}</div>
              </div>
            ))}
          </div>
          <div style={{ display:'flex', gap:4, justifyContent:'center', marginTop:8 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ width:i===0?16:5, height:5, borderRadius:3, background:i===0?'var(--accent)':'var(--border)' }}/>
            ))}
          </div>
        </div>
      )}

      {/* Category Tabs */}
      <div ref={toolsSectionRef} id="tools-section" style={{ marginBottom:'0.85rem' }}>
        <div style={{ display:'flex', borderBottom:'1px solid var(--border)' }}>
          <div style={{ display:'flex', flex:1, overflowX:'auto', scrollbarWidth:'none' }}>
            {categories.map(c => (
              <button
                key={c}
                onClick={() => setActiveCat(c)}
                style={{
                  flexShrink:0,
                  padding:'8px 12px',
                  background:'none', border:'none',
                  borderBottom:`2px solid ${activeCat===c?'var(--accent)':'transparent'}`,
                  color: activeCat===c ? 'var(--accent)' : 'var(--muted)',
                  fontSize:13, fontWeight:activeCat===c?600:400,
                  cursor:'pointer', whiteSpace:'nowrap',
                  fontFamily:'var(--sans)', marginBottom:-1, transition:'color 0.15s',
                }}
              >
                {c === 'all' ? '全部工具' : `${CAT_ICONS[c]||'•'} ${c}`}
              </button>
            ))}
          </div>
          <button style={{
            flexShrink:0, padding:'8px 10px',
            background:'none', border:'none', borderBottom:'2px solid transparent',
            color:'var(--muted)', fontSize:12, cursor:'pointer',
            fontFamily:'var(--mono)', marginBottom:-1,
          }}>≡ 筛选</button>
        </div>
      </div>

      {/* Tool List */}
      {filtered.length === 0 ? (
        <div className="empty">没有找到匹配的工具</div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8, paddingBottom:'5rem' }}>
          {filtered.map(t => (
            <ToolCard
              key={t.id}
              tool={t}
              onClick={() => onOpenTool(t.slug)}
              favorited={favIds?.has(t.id)}
              onToggleFavorite={onToggleFavorite}
              highlighted={highlightId === t.id}
            />
          ))}
        </div>
      )}
    </>
  )
}
