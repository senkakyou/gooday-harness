// =====================================================
// components/ToolCard.jsx —— 工具卡片
// 职责：在工具列表中展示单个工具的图标、名称、分类、描述、操作标签和统计数据
// 点击卡片触发父组件传入的 onClick 回调（通常是打开工具详情弹窗）
// =====================================================

import React from 'react'

// 各分类对应的标签配色（背景色、文字色、边框色）
const CAT_COLORS = {
  '工具': { bg:'rgba(124,108,255,0.12)', color:'var(--accent)',  border:'rgba(124,108,255,0.3)' },
  '脚本':   { bg:'rgba(0,212,170,0.1)',    color:'var(--accent2)', border:'rgba(0,212,170,0.3)'   },
  '教程':   { bg:'rgba(255,165,2,0.1)',    color:'var(--warn)',    border:'rgba(255,165,2,0.3)'   },
  '系统':   { bg:'rgba(100,200,255,0.1)',  color:'#64c8ff',        border:'rgba(100,200,255,0.3)' },
  '教育':   { bg:'rgba(0,212,170,0.1)',    color:'var(--accent2)', border:'rgba(0,212,170,0.3)'   },
  '效率':   { bg:'rgba(124,108,255,0.12)', color:'var(--accent)',  border:'rgba(124,108,255,0.3)' },
  '开发':   { bg:'rgba(255,165,2,0.1)',    color:'var(--warn)',    border:'rgba(255,165,2,0.3)'   },
  '设计':   { bg:'rgba(244,114,182,0.1)', color:'#f472b6',        border:'rgba(244,114,182,0.3)' },
  '娱乐':   { bg:'rgba(168,85,247,0.1)',  color:'#a855f7',        border:'rgba(168,85,247,0.3)'  },
  '游戏':   { bg:'rgba(255,71,87,0.1)',   color:'var(--danger)',  border:'rgba(255,71,87,0.3)'   },
}

// 秒 → 8:32。视频时长没填（0）时不显示，标签就只写"讲解"
const fmtDur = (s) => {
  const n = parseInt(s, 10) || 0
  if (n <= 0) return ''
  return ` ${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
}

export default function ToolCard({ tool, onClick, favorited = false, onToggleFavorite, highlighted = false }) {
  const cat = CAT_COLORS[tool.category] || CAT_COLORS['工具']

  const handleStar = (e) => {
    e.stopPropagation()   // 不触发卡片点击（打开详情）
    onToggleFavorite?.(tool)
  }

  return (
    <div
      id={`tool-card-${tool.id}`}
      onClick={onClick}
      className={highlighted ? 'tool-card-highlight' : ''}
      style={{
        display:'flex', alignItems:'flex-start', gap:'0.75rem',
        padding:'0.875rem 0.875rem 0.875rem 0.875rem',
        background:'var(--surface)', borderRadius:14,
        border:'1px solid var(--border)', cursor:'pointer',
        transition:'border-color 0.15s',
      }}
      onMouseEnter={e => { if (!highlighted) e.currentTarget.style.borderColor='var(--accent)' }}
      onMouseLeave={e => { if (!highlighted) e.currentTarget.style.borderColor='var(--border)' }}
    >
      {/* Icon */}
      <div style={{
        width:54, height:54, flexShrink:0,
        background:'var(--surface2)', border:'1px solid var(--border)',
        borderRadius:14, display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:'1.55rem', fontFamily:'var(--mono)',
      }}>
        {tool.iconEmoji}
      </div>

      {/* Info */}
      <div style={{ flex:1, minWidth:0 }}>
        {/* Title + badge */}
        <div style={{ display:'flex', alignItems:'center', gap:'0.35rem', marginBottom:3, flexWrap:'wrap' }}>
          <span style={{ fontWeight:700, fontSize:14 }}>{tool.name}</span>
          <span style={{
            fontSize:10, padding:'2px 7px', borderRadius:999,
            background:cat.bg, color:cat.color, border:`1px solid ${cat.border}`,
            fontFamily:'var(--mono)', flexShrink:0,
          }}>{tool.category}</span>
          {/* 交付物：让人一眼看出这是自己的、别人看不见的那件 */}
          {tool.isMine && tool.visibility === 'private' && (
            <span style={{
              fontSize:10, padding:'2px 7px', borderRadius:999, flexShrink:0,
              background:'rgba(148,163,184,0.14)', color:'#94a3b8',
              border:'1px solid rgba(148,163,184,0.35)', fontFamily:'var(--mono)',
            }}>🔒 仅自己可见</span>
          )}
          {tool.isMine && tool.visibility === 'public' && (
            <span style={{
              fontSize:10, padding:'2px 7px', borderRadius:999, flexShrink:0,
              background:'rgba(16,185,129,0.10)', color:'var(--green)',
              border:'1px solid rgba(16,185,129,0.3)', fontFamily:'var(--mono)',
            }}>🌐 我的·已公开</span>
          )}
        </div>
        {/* Description */}
        <div style={{
          color:'var(--muted)', fontSize:12, lineHeight:1.5,
          display:'-webkit-box', WebkitLineClamp:2,
          WebkitBoxOrient:'vertical', overflow:'hidden',
          marginBottom:8,
        }}>{tool.description}</div>
        {/* Buttons + stats (same row) */}
        {/* 三个标签（在线使用 / 视频讲解 / 下载）＋右侧统计。
            【必须 wrap】：原来是 nowrap，两个标签时刚好占满，加上讲解这第三个
            在 375px 宽的手机上会把统计数字挤出卡片。宁可换行也不能溢出。 */}
        <div style={{ display:'flex', alignItems:'center', gap:'0.35rem', flexWrap:'wrap', rowGap:6 }}>
          {tool.isOnline && (
            <span style={{
              fontSize:11, padding:'3px 10px', borderRadius:999, flexShrink:0,
              background:'rgba(16,185,129,0.1)', color:'var(--green)',
              border:'1px solid rgba(16,185,129,0.3)', fontFamily:'var(--mono)',
            }}>在线使用</span>
          )}
          {tool.hasVideo && (
            <span style={{
              fontSize:11, padding:'3px 10px', borderRadius:999, flexShrink:0,
              background:'rgba(244,114,182,0.1)', color:'#f472b6',
              border:'1px solid rgba(244,114,182,0.3)', fontFamily:'var(--mono)',
            }}>🎬 讲解{fmtDur(tool.videoDuration)}</span>
          )}
          {tool.hasDownload && (
            <span style={{
              fontSize:11, padding:'3px 10px', borderRadius:999, flexShrink:0,
              background:'rgba(124,108,255,0.1)', color:'var(--accent)',
              border:'1px solid rgba(124,108,255,0.3)', fontFamily:'var(--mono)',
            }}>{tool.isPaid ? `¥${tool.price}` : '⬇ 下载'}</span>
          )}
          <div style={{ marginLeft:'auto', display:'flex', gap:8, fontSize:10, color:'var(--muted)', fontFamily:'var(--mono)', flexShrink:0 }}>
            <span>👁 {tool.viewCount}</span>
            <span>⬇ {tool.downloadCount}</span>
          </div>
        </div>
      </div>

      {/* 收藏星标（点击切换，不触发卡片打开） */}
      <button
        onClick={handleStar}
        title={favorited ? '取消收藏' : '收藏'}
        aria-label={favorited ? '取消收藏' : '收藏'}
        style={{
          flexShrink:0, background:'none', border:'none', cursor:'pointer',
          padding:'2px 2px 0', lineHeight:1, color: favorited ? '#f5b301' : 'var(--muted)',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 22 22"
          fill={favorited ? 'currentColor' : 'none'}
          stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 2l2.5 5.3 5.8.8-4.2 4.1 1 5.8L11 15.3l-5.1 2.7 1-5.8L2.7 8.1l5.8-.8z"/>
        </svg>
      </button>
    </div>
  )
}
