// =====================================================
// pages/home/HeroBox.jsx —— 首页 Hero 区的"AI 箱子"（开箱抽卡动画主体）
// 纯展示组件，由 phase 驱动各阶段渲染；从 Home.jsx 抽离
// =====================================================

import React from 'react'
import { BOX_PARTICLES } from './gachaAssets'

export default function HeroBox({ phase, onClick, boxRef, rollOffset }) {
  const bodyHidden  = ['burst', 'flying', 'reveal', 'absorb'].includes(phase)
  const lidHidden   = ['burst', 'flying', 'reveal', 'absorb'].includes(phase)
  const lidFlying   = phase === 'opening'
  const shaking     = phase === 'shake'
  const charging    = phase === 'charge'
  const glowBright  = phase === 'charge' || phase === 'shake' || phase === 'opening'
  const rolled      = phase !== 'idle'  // 非 idle 时箱子停在中心爆炸点

  return (
    <div className="hero-box-wrap" style={{ position: 'relative', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', alignSelf: 'flex-end', paddingBottom: 4, marginRight: '0.875rem' }}>
      {/* 滚动层：把箱子从右侧滚到 banner 中心爆炸点 */}
      <div style={{
        position: 'relative',
        '--dx': `${rollOffset?.dx || 0}px`, '--dy': `${rollOffset?.dy || 0}px`,
        transform: rolled ? `translate(${rollOffset?.dx || 0}px, ${rollOffset?.dy || 0}px)` : 'none',
        animation: phase === 'roll' ? 'boxRoll 1.1s cubic-bezier(0.34,0.05,0.28,1) forwards' : 'none',
        zIndex: rolled ? 12 : 1,
        willChange: 'transform',
      }}>
      <div
        ref={boxRef}
        onClick={onClick}
        style={{
          position: 'relative',
          width: 'clamp(100px,26vw,138px)', height: 'clamp(100px,26vw,138px)',
          cursor: phase === 'idle' ? 'pointer' : 'default',
          animation: phase === 'idle'   ? 'cubeFloat 4s ease-in-out infinite' :
                     phase === 'charge' ? 'chargeShiver 0.42s ease-out forwards' :
                     phase === 'shake'  ? 'boxShake 0.50s ease-in-out' : 'none',
          opacity:   bodyHidden ? 0 : 1,
          transform: phase === 'opening' ? 'perspective(420px) scale(1.08)' :
                     phase === 'burst'   ? 'perspective(420px) scale(0.08) rotate(28deg)' : undefined,
          transition: phase === 'burst'   ? 'opacity 0.14s, transform 0.14s ease-in' :
                      phase === 'opening' ? 'transform 0.12s ease-out' :
                      bodyHidden          ? 'opacity 0.2s' : 'none',
          willChange: 'transform',
        }}
      >
        {/* idle：闭合箱顶溢出的微光丝 */}
        {phase === 'idle' && (
          <div style={{
            position: 'absolute', left: '50%', bottom: '50%',
            width: 9, height: 50, marginLeft: -4.5,
            transformOrigin: 'bottom center',
            clipPath: 'polygon(28% 100%, 72% 100%, 88% 0, 12% 0)',
            background: 'linear-gradient(to top, rgba(196,160,255,0.55) 0%, rgba(150,120,255,0.18) 55%, transparent 100%)',
            filter: 'blur(3px)',
            animation: 'idleWisp 3.4s ease-in-out infinite',
            pointerEvents: 'none', zIndex: 3,
          }}/>
        )}
        {/* 背景光晕（宝箱旋转发光效果） */}
        {!bodyHidden && (
          <div style={{
            position: 'absolute',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: glowBright ? '320%' : '240%',
            height: glowBright ? '320%' : '240%',
            borderRadius: '50%',
            background: glowBright
              ? 'radial-gradient(circle, rgba(200,225,255,0.55) 0%, rgba(170,110,255,0.42) 26%, rgba(110,60,220,0.20) 56%, transparent 76%)'
              : 'radial-gradient(circle, rgba(150,140,255,0.34) 0%, rgba(120,80,235,0.18) 44%, transparent 72%)',
            filter: glowBright ? 'blur(22px)' : 'blur(12px)',
            transition: 'width 0.2s ease-out, height 0.2s ease-out, background 0.25s, filter 0.25s',
            animation: glowBright ? 'none' : 'boxAura 4s ease-in-out infinite',
            pointerEvents: 'none',
            zIndex: 0,
          }}/>
        )}

        {/* 四周漂浮粒子（8颗，分布四侧） */}
        {BOX_PARTICLES.map((p, i) => (
          <div key={i} style={{
            position: 'absolute',
            top: p.top, left: p.left,
            width: p.size, height: p.size,
            borderRadius: '50%',
            background: p.color,
            boxShadow: `0 0 ${p.size * 2.5}px ${p.color}`,
            animation: `particleOrbit ${p.dur} ease-in-out infinite`,
            animationDelay: p.delay,
            '--dx': p.dx, '--dy': p.dy,
            pointerEvents: 'none', zIndex: 2,
          }}/>
        ))}

        {/* 底部发光圆环（真圆环，脉冲呼吸） */}
        <div style={{
          position: 'absolute',
          bottom: -10, left: '50%', transform: 'translateX(-50%)',
          width: '88%', height: 11, borderRadius: '50%',
          border: `1.5px solid rgba(168,76,255,${shaking ? 1 : 0.78})`,
          background: 'radial-gradient(ellipse at center, rgba(130,50,200,0.18) 0%, transparent 72%)',
          boxShadow: shaking
            ? '0 0 22px rgba(188,92,255,0.95), 0 0 44px rgba(140,58,220,0.65)'
            : undefined,
          animation: shaking ? 'none' : 'ringPulse 2.4s ease-in-out infinite',
          transition: 'box-shadow 0.2s, border-color 0.2s',
        }}/>

        {/* ── 箱盖（独立元素，opening阶段飞离） ── */}
        <svg
          width="100%" height="100%" viewBox="0 0 110 110" fill="none"
          style={{
            position: 'absolute', inset: 0, zIndex: 4,
            transition: 'transform 0.24s ease-in, opacity 0.16s',
            transform: lidFlying ? 'translateY(-36px) rotate(-13deg) scale(1.1)' : 'none',
            opacity: lidHidden ? 0 : 1,
            pointerEvents: 'none',
          }}
        >
          <defs>
            <linearGradient id="lidt" x1="12" y1="10" x2="98" y2="54" gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="#b69cf5" stopOpacity="0.40"/>
              <stop offset="50%"  stopColor="#9070ec" stopOpacity="0.40"/>
              <stop offset="100%" stopColor="#6442d2" stopOpacity="0.50"/>
            </linearGradient>
            <filter id="lide" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="2.2" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="lidf" x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="1.5"/>
            </filter>
          </defs>
          {/* 磨砂层 */}
          <polygon points="55,10 98,32 55,54 12,32" fill="url(#lidt)" filter="url(#lidf)"/>
          {/* 清晰面 */}
          <polygon points="55,10 98,32 55,54 12,32" fill="url(#lidt)"/>
          {/* 双层高光反射 */}
          <polygon points="55,10 74,20 62,32 43,22" fill="rgba(220,205,255,0.16)"/>
          <polygon points="55,10 66,16 58,24 47,18" fill="rgba(220,205,255,0.10)"/>
          {/* 霓虹棱边 */}
          <polyline points="55,10 98,32 55,54 12,32 55,10"
            stroke="rgba(206,176,255,0.95)" strokeWidth="1.5" filter="url(#lide)"/>
          <circle cx="55" cy="10" r="2.5" fill="rgba(224,200,255,0.95)" filter="url(#lide)"/>
          <circle cx="98" cy="32" r="1.8" fill="rgba(210,178,255,0.90)"/>
          <circle cx="12" cy="32" r="1.8" fill="rgba(210,178,255,0.90)"/>
        </svg>

        {/* ── 箱体（无顶面，始终由箱盖覆盖） ── */}
        <svg width="100%" height="100%" viewBox="0 0 110 110" fill="none" style={{ position: 'relative', zIndex: 1 }}>
          <defs>
            <linearGradient id="hbgl" x1="12" y1="54" x2="12" y2="96" gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="#6b3fd6" stopOpacity="0.66"/>
              <stop offset="100%" stopColor="#2e1488" stopOpacity="0.80"/>
            </linearGradient>
            <linearGradient id="hbgr" x1="98" y1="54" x2="98" y2="96" gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="#8a4ff0" stopOpacity="0.64"/>
              <stop offset="100%" stopColor="#3d1aa8" stopOpacity="0.80"/>
            </linearGradient>
            <radialGradient id="hbcore" cx="50%" cy="42%" r="55%">
              <stop offset="0%"   stopColor="#d6ecff" stopOpacity="0.62"/>
              <stop offset="45%"  stopColor="#9b7bff" stopOpacity="0.28"/>
              <stop offset="100%" stopColor="#7c4fe0" stopOpacity="0"/>
            </radialGradient>
            <filter id="hbge" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="2.2" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="hbgf" x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="1.5"/>
            </filter>
          </defs>
          {/* 磨砂玻璃底层 */}
          <polygon points="98,32 55,54 55,96 98,74" fill="url(#hbgr)" filter="url(#hbgf)"/>
          <polygon points="12,32 55,54 55,96 12,74" fill="url(#hbgl)" filter="url(#hbgf)"/>
          {/* 玻璃面 */}
          <polygon points="98,32 55,54 55,96 98,74" fill="url(#hbgr)"/>
          <polygon points="12,32 55,54 55,96 12,74" fill="url(#hbgl)"/>
          {/* 内部发光核心 */}
          <ellipse cx="55" cy="70" rx="20" ry="24" fill="url(#hbcore)"/>
          {/* 霓虹棱边（箱体部分） */}
          <line x1="12" y1="32" x2="55" y2="54" stroke="rgba(200,168,255,0.95)" strokeWidth="1.5" filter="url(#hbge)"/>
          <line x1="98" y1="32" x2="55" y2="54" stroke="rgba(200,168,255,0.95)" strokeWidth="1.5" filter="url(#hbge)"/>
          <line x1="55" y1="54" x2="55" y2="96" stroke="rgba(195,158,255,0.88)" strokeWidth="1.2"/>
          <line x1="12" y1="32" x2="12" y2="74" stroke="rgba(155,105,255,0.58)" strokeWidth="0.9"/>
          <line x1="98" y1="32" x2="98" y2="74" stroke="rgba(155,105,255,0.58)" strokeWidth="0.9"/>
          <line x1="12" y1="74" x2="55" y2="96" stroke="rgba(155,105,255,0.58)" strokeWidth="0.9"/>
          <line x1="98" y1="74" x2="55" y2="96" stroke="rgba(155,105,255,0.58)" strokeWidth="0.9"/>
          {/* 内部科技线路 */}
          <line x1="33" y1="60" x2="77" y2="60" stroke="rgba(185,140,255,0.18)" strokeWidth="0.5" strokeDasharray="3,4"/>
          <line x1="55" y1="54" x2="55" y2="86" stroke="rgba(185,140,255,0.15)" strokeWidth="0.5" strokeDasharray="3,4"/>
          {/* 底点 */}
          <circle cx="55" cy="54" r="1.5" fill="rgba(192,150,255,0.72)"/>
          <circle cx="12" cy="74" r="1.3" fill="rgba(172,128,255,0.62)"/>
          <circle cx="98" cy="74" r="1.3" fill="rgba(172,128,255,0.62)"/>
          <circle cx="55" cy="96" r="1.6" fill="rgba(192,150,255,0.78)"/>
        </svg>
      </div>
      </div>
    </div>
  )
}
