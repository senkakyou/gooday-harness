// =====================================================
// pages/Home.jsx —— 首页
// 路由：/
// 职责：Hero banner（含开箱抽卡动画）+ 模块导航 + 工具列表（按分类筛选）
//
// 开箱动画状态机：
//   idle → roll → charge → shake → opening → burst → flying → reveal → absorb → idle
//   idle：箱子浮动等待点击
//   roll：箱子从右侧滚到屏幕中心
//   charge：充能蓄力效果（0.42s）
//   shake：箱子抖动（0.5s）
//   opening：箱盖飞起
//   burst：爆炸粒子效果
//   flying：卡牌从爆炸点向上飞出散开
//   reveal：卡牌正面展示
//   absorb：卡牌被吸收收回（动画结束后重置）
// =====================================================

import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { listTools, getTool } from '../api/tools'
import { listFavoriteIds, toggleFavorite } from '../api/favorites'
import { getRuyiContact } from '../api/settings'
import ToolDetailModal from '../components/ToolDetailModal'
import AuthModal from '../components/AuthModal'
import useToastStore from '../store/toastStore'
import useAuthStore from '../store/authStore'
import HeroBox from './home/HeroBox'
import ModuleNav from './home/ModuleNav'
import ToolsSection from './home/ToolsSection'
import {
  STARS, CARD_W, CARD_H,
  BURST_ANGLES, BURST_PARTICLES, BURST_STARS, LIGHT_RAYS,
  pickRarity, sfxClick, sfxCharge, sfxBurst, sfxWhoosh, sfxReveal,
} from './home/gachaAssets'

export default function Home() {
  const toast = useToastStore(s => s.toast)
  const user = useAuthStore(s => s.user)
  const navigate = useNavigate()
  const toolsSectionRef = useRef(null)
  const heroBannerRef = useRef(null)
  const heroBoxRef = useRef(null)
  const moduleNavRef = useRef(null)
  const timersRef = useRef([])  // 开箱动画的所有 setTimeout，卸载/跳过时统一清理

  const [tools, setTools] = useState([])
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState('all')
  const [selectedTool, setSelectedTool] = useState(null)
  const [authModal, setAuthModal] = useState(null)
  const [favIds, setFavIds] = useState(new Set())
  const [ruyiContact, setRuyiContact] = useState(null)  // 已收藏的工具 id 集

  // Box gacha state
  const [boxPhase, setBoxPhase] = useState('idle') // idle|shake|opening|burst|flying|reveal|absorb
  const [flyCards, setFlyCards] = useState([])
  const [cardOrigin, setCardOrigin] = useState({ x: 0, y: 0 })   // 箱子中心（光柱/光线/粒子用）
  const [burst, setBurst] = useState({ cx: 0, cy: 0, rx: 110, ry: 80 }) // 卡片烟花中心与椭圆半径
  const [convTarget, setConvTarget] = useState({ dx: 0, dy: 240 }) // 吸收终点（相对于card base）
  const [cardStep, setCardStep] = useState(0) // 0=隐藏 1=弹射 2=展开飞出 3=吸回列表
  const [gacha, setGacha] = useState(null)
  const [highlightId, setHighlightId] = useState(null) // 开箱中奖工具：滚动定位并高亮选中

  useEffect(() => { listTools().then(setTools).catch(() => {}) }, [])
  useEffect(() => { getRuyiContact().then(setRuyiContact).catch(() => {}) }, [])

  // 开箱中奖后：滚动到对应工具卡片并高亮，几秒后自动取消高亮
  useEffect(() => {
    if (highlightId == null) return
    const scrollTimer = setTimeout(() => {
      document.getElementById(`tool-card-${highlightId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 60)
    const clearTimer = setTimeout(() => setHighlightId(null), 3000)
    return () => { clearTimeout(scrollTimer); clearTimeout(clearTimer) }
  }, [highlightId])

  // 登录后拉取收藏 id 集；登出清空
  useEffect(() => {
    if (!user) { setFavIds(new Set()); return }
    listFavoriteIds().then(ids => setFavIds(new Set(ids))).catch(() => {})
  }, [user])

  // 切换收藏：未登录引导登录，已登录乐观更新 + 失败回滚
  const handleToggleFav = async (tool) => {
    if (!user) { setAuthModal('login'); return }
    const id = tool.id
    const flip = (set) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); return n }
    setFavIds(flip)
    try {
      const r = await toggleFavorite(id)
      setFavIds(prev => { const n = new Set(prev); r.favorited ? n.add(id) : n.delete(id); return n })
    } catch {
      setFavIds(flip)  // 回滚
      toast('操作失败', true)
    }
  }

  // 组件卸载时清掉所有未执行的动画定时器，避免对已卸载组件 setState
  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  const schedule = (fn, ms) => { timersRef.current.push(setTimeout(fn, ms)) }
  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = [] }

  // 跳过开箱动画：清掉所有定时器并立即复位
  const skipGacha = () => {
    clearTimers()
    setBoxPhase('idle'); setCardStep(0); setFlyCards([]); setGacha(null)
  }

  const handleBoxClick = () => {
    if (boxPhase !== 'idle' || tools.length === 0) return
    const cards = [...tools].sort(() => Math.random() - 0.5).slice(0, 5)
    const winner = cards[0]
    const rarity = pickRarity()
    if (heroBannerRef.current && heroBoxRef.current) {
      const br = heroBannerRef.current.getBoundingClientRect()
      const bx = heroBoxRef.current.getBoundingClientRect()
      const origin = { x: bx.left + bx.width/2 - br.left, y: bx.top + bx.height/2 - br.top }
      setCardOrigin(origin)
      // 卡片烟花：以 banner 水平中心爆开，半径按可用空间收敛保证不出框
      const cx = br.width / 2
      const cy = br.height * 0.46
      const margin = 10
      const rx = Math.min(118, cx - CARD_W / 2 - margin)
      const ry = Math.min(92, cy - CARD_H / 2 - margin)
      setBurst({ cx, cy, rx: Math.max(60, rx), ry: Math.max(46, ry) })
      // 吸收终点：从烟花中心垂直下落到工具列表方向
      setConvTarget({ dx: 0, dy: br.height + 50 - cy })
    }
    setFlyCards(cards); setGacha({ rarity, tool: cards[0] }); setCardStep(0)

    sfxClick()
    // 帧0：箱子滚到中心爆炸点（1.1s）
    setBoxPhase('roll'); sfxWhoosh(0)
    // 帧1→2：聚焦盒体 → 能量蓄积（等滚动结束）
    schedule(() => { setBoxPhase('charge'); sfxCharge() }, 1120)
    schedule(() => setBoxPhase('shake'), 1540)
    // 帧3：开盖瞬间（光柱喷发）
    schedule(() => { setBoxPhase('opening'); sfxBurst() }, 1820)
    schedule(() => setBoxPhase('burst'), 2020)
    // 帧4：工具飞出
    schedule(() => {
      setBoxPhase('flying'); setCardStep(1)
      Array.from({ length: 5 }, (_, i) => sfxWhoosh(i * 0.12))
    }, 2200)
    schedule(() => setCardStep(2), 2360)
    // 帧5：工具汇聚（揭晓）
    schedule(() => { setBoxPhase('reveal'); sfxReveal(rarity.stars) }, 2960)
    // 帧6：最终落位——跳到中奖工具并高亮选中（先重置筛选确保它在列表里）
    schedule(() => {
      setBoxPhase('absorb')
      setCardStep(3)
      setActiveCat('all')
      setSearch('')
      setHighlightId(winner.id)
    }, 4320)
    // 重置
    schedule(() => {
      setBoxPhase('idle'); setCardStep(0); setFlyCards([]); setGacha(null)
    }, 5120)
  }

  const categories = ['all', ...Array.from(new Set(tools.map(t => t.category)))]
  const filtered = tools.filter(t =>
    (activeCat === 'all' || t.category === activeCat) &&
    (t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.description.toLowerCase().includes(search.toLowerCase()))
  )
  const hotTools = [...tools].sort((a, b) => b.viewCount - a.viewCount).slice(0, 6)

  const handleOpenTool = async (slug) => {
    try {
      const t = await getTool(slug)
      setSelectedTool(t)
      setTools(prev => prev.map(x => x.slug === slug ? { ...x, viewCount: t.viewCount } : x))
    } catch (e) { toast(e.message, true) }
  }

  return (
    <>
      {/* ===== Hero Banner Card ===== */}
      <div className="hero-outer">
        <div
          ref={heroBannerRef}
          className="hero-banner"
          style={{ borderRadius: 18, padding: '1.5rem 1.25rem', border: '1px solid rgba(124,108,255,0.2)' }}
        >
          {STARS.map((s, i) => (
            <div key={i} className="hero-star" style={{ left: s.x, top: s.y, '--d': s.d, '--delay': s.delay }} />
          ))}

          {/* 跳过开箱动画 */}
          {boxPhase !== 'idle' && (
            <button
              onClick={skipGacha}
              style={{
                position: 'absolute', top: 8, right: 10, zIndex: 60,
                padding: '4px 12px', borderRadius: 999, cursor: 'pointer',
                fontSize: 11, color: 'rgba(255,255,255,0.8)',
                background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.25)',
                backdropFilter: 'blur(4px)',
              }}
            >跳过 ⏭</button>
          )}

          {/* 阶段1：能量蓄积——外围粒子吸入箱心（箱子已滚到中心） */}
          {boxPhase === 'charge' && BURST_PARTICLES.map((p, i) => (
            <div key={`g${i}`} style={{
              position: 'absolute',
              left: burst.cx, top: burst.cy,
              width: p.size, height: p.size, borderRadius: '50%',
              background: p.color,
              boxShadow: `0 0 ${p.size * 3}px ${p.color}`,
              '--px': `${p.px}px`, '--py': `${p.py}px`,
              animation: 'particleGatherIn 0.45s ease-in forwards',
              animationDelay: `${i * 0.012}s`,
              pointerEvents: 'none', zIndex: 8,
            }}/>
          ))}

          {/* 阶段2：彩色烟花粒子（从中心爆开） */}
          {['burst','flying','reveal'].includes(boxPhase) && BURST_PARTICLES.map((p, i) => (
            <div key={i} style={{
              position: 'absolute',
              left: burst.cx, top: burst.cy,
              width: p.size, height: p.size, borderRadius: '50%',
              background: p.color,
              boxShadow: `0 0 ${p.size * 3}px ${p.color}`,
              '--px': `${p.px}px`, '--py': `${p.py}px`,
              animation: 'particleBurst 0.85s ease-out forwards',
              animationDelay: `${i * 0.025}s`,
              pointerEvents: 'none', zIndex: 8,
            }}/>
          ))}

          {/* 阶段2：箱体开盖瞬间的星光 ✦（箱子已在中心） */}
          {boxPhase === 'opening' && BURST_STARS.map((s, i) => (
            <div key={i} style={{
              position: 'absolute',
              left: burst.cx + s.ox,
              top: burst.cy + s.oy,
              fontSize: s.size,
              color: '#eafdff',
              animation: `starFlash 0.55s ease-out forwards`,
              animationDelay: `${s.delay}s`,
              pointerEvents: 'none', zIndex: 11,
              textShadow: '0 0 8px #9bf0ff, 0 0 20px #c084fc, 0 0 32px #ff9be0',
              lineHeight: 1,
            }}>✦</div>
          ))}

          {/* 阶段2：放射光线（从中心爆开） */}
          {['burst','flying'].includes(boxPhase) && (
            <svg style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              pointerEvents: 'none', zIndex: 10, overflow: 'visible',
            }}>
              {LIGHT_RAYS.map((ray, i) => {
                const θ = ray.angle * Math.PI / 180
                const cx = burst.cx, cy = burst.cy
                return (
                  <line key={i}
                    x1={cx} y1={cy}
                    x2={cx + Math.cos(θ) * ray.length}
                    y2={cy + Math.sin(θ) * ray.length}
                    stroke={ray.color}
                    strokeWidth={ray.width}
                    strokeLinecap="round"
                    style={{
                      filter: `drop-shadow(0 0 4px ${ray.color}) drop-shadow(0 0 9px ${ray.color})`,
                      animation: 'lightRayFade 0.52s ease-out forwards',
                      animationDelay: `${i * 0.022}s`,
                    }}
                  />
                )
              })}
            </svg>
          )}

          {/* 阶段3：中心向上强光柱 + 横向闪光盘 */}
          {['burst','flying'].includes(boxPhase) && (
            <>
              {/* 横向闪光盘 */}
              <div style={{
                position: 'absolute',
                left: burst.cx, top: burst.cy,
                width: 104, height: 34, marginLeft: -52, marginTop: -17,
                borderRadius: '50%',
                background: 'radial-gradient(ellipse at center, rgba(235,250,255,0.95) 0%, rgba(160,225,255,0.6) 32%, rgba(255,155,224,0.28) 60%, transparent 78%)',
                filter: 'blur(2px)',
                animation: 'mouthFlash 0.6s ease-out forwards',
                pointerEvents: 'none', zIndex: 9,
              }}/>
              {/* 宽柔光锥（带品红外缘） */}
              <div style={{
                position: 'absolute',
                left: burst.cx, top: burst.cy - 168,
                width: 80, height: 172, marginLeft: -40,
                transformOrigin: 'bottom center',
                clipPath: 'polygon(38% 100%, 62% 100%, 100% 0, 0% 0)',
                background: 'linear-gradient(to top, rgba(170,235,255,0.50) 0%, rgba(190,150,255,0.30) 42%, rgba(255,155,224,0.12) 78%, transparent 100%)',
                filter: 'blur(7px)',
                animation: 'lightColumn 1.0s ease-out forwards',
                pointerEvents: 'none', zIndex: 9,
              }}/>
              {/* 亮核光柱（青白） */}
              <div style={{
                position: 'absolute',
                left: burst.cx, top: burst.cy - 166,
                width: 16, height: 168, marginLeft: -8,
                transformOrigin: 'bottom center',
                clipPath: 'polygon(30% 100%, 70% 100%, 90% 0, 10% 0)',
                background: 'linear-gradient(to top, rgba(255,255,255,0.98) 0%, rgba(190,245,255,0.88) 32%, rgba(170,200,255,0.42) 72%, transparent 100%)',
                filter: 'blur(1.4px) drop-shadow(0 0 9px rgba(160,235,255,0.9))',
                animation: 'lightColumn 1.0s ease-out forwards, columnShimmer 0.3s ease-in-out infinite',
                pointerEvents: 'none', zIndex: 10,
              }}/>
            </>
          )}

          {/* 阶段3：工具卡从中心烟花式散开（左右对称，不出框） */}
          {flyCards.map((card, i) => {
            const a = ((BURST_ANGLES[i] ?? -90)) * Math.PI / 180
            const dx = Math.cos(a) * burst.rx
            const dy = Math.sin(a) * burst.ry
            const isWinner = i === 0 && boxPhase === 'reveal'
            // 按字符宽度估算（CJK 算2宽，ASCII 算1），字号随卡片尺寸自适应
            const cw = Array.from(card.name).reduce((a, c) => a + (/[一-鿿　-鿿]/.test(c) ? 2 : 1), 0)
            const nameFontSize = cw <= 5 ? 8 : cw <= 9 ? 7 : cw <= 14 ? 6 : 5
            const cardTransform =
              cardStep === 0 ? 'translate(0px,0px) scale(0.12)' :
              cardStep === 1 ? `translate(${dx*0.16}px,${dy*0.16}px) scale(0.5)` :
              cardStep === 2 ? `translate(${dx}px,${dy}px) scale(1)` :
              /* step3 吸回 */ `translate(${convTarget.dx}px,${convTarget.dy}px) scale(0.05)`
            const cardTransition =
              cardStep <= 1
                ? `transform 0.16s ease-out ${i*0.04}s, opacity 0.18s ease ${i*0.04}s, border-color 0.4s, box-shadow 0.4s`
              : cardStep === 2
                ? `transform 0.78s cubic-bezier(0.16,1.05,0.32,1) ${i*0.05}s, opacity 0.2s, border-color 0.4s, box-shadow 0.4s`
                : `transform 0.55s cubic-bezier(0.5,0,0.8,1) ${i*0.04}s, opacity 0.40s ease-in ${i*0.04}s`
            const cardOpacity = cardStep === 0 ? 0 : cardStep === 3 ? 0 : 1
            return (
              <div key={card.id} style={{
                position: 'absolute',
                left: burst.cx - CARD_W / 2, top: burst.cy - CARD_H / 2,
                width: CARD_W, height: CARD_H, boxSizing: 'border-box',
                background: 'linear-gradient(160deg,rgba(28,14,52,0.98) 0%,rgba(18,8,36,0.98) 100%)',
                border: `1.5px solid ${isWinner ? gacha?.rarity.color : 'rgba(148,108,255,0.55)'}`,
                borderRadius: 11,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 2, padding: '4px 3px', overflow: 'hidden',
                transform: cardTransform,
                transition: cardTransition,
                opacity: cardOpacity,
                zIndex: isWinner ? 22 : 14,
                pointerEvents: 'none',
                boxShadow: isWinner
                  ? `0 0 22px ${gacha?.rarity.color}70, 0 6px 20px rgba(0,0,0,0.5)`
                  : '0 0 10px rgba(120,80,220,0.25), 0 6px 18px rgba(0,0,0,0.45)',
              }}>
                <span style={{ fontSize: 19, lineHeight: 1, flexShrink: 0 }}>{card.iconEmoji}</span>
                <span style={{
                  fontSize: nameFontSize, color: 'rgba(220,200,255,0.78)',
                  textAlign: 'center', lineHeight: 1.2, padding: '0 1px',
                  width: '100%',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden', wordBreak: 'break-word',
                  fontWeight: 500,
                }}>{card.name}</span>
              </div>
            )
          })}

          {/* Gacha result overlay */}
          {boxPhase === 'reveal' && gacha && (
            <div style={{
              position: 'absolute',
              left: '50%', top: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgba(10,6,26,0.97)',
              border: '1px solid rgba(148,108,255,0.40)',
              borderRadius: 16, padding: '12px 20px',
              textAlign: 'center', zIndex: 50,
              boxShadow: '0 0 40px rgba(124,108,255,0.30)',
              animation: 'fadeInScale 0.35s ease',
              pointerEvents: 'none', whiteSpace: 'nowrap',
            }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>🎉 恭喜发现</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{gacha.tool?.name}</div>
            </div>
          )}

          <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {/* Left text */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 10px', borderRadius: 999, marginBottom: 10,
                border: '1px solid rgba(124,108,255,0.5)',
                background: 'rgba(124,108,255,0.12)',
                fontSize: 11, color: 'rgba(180,170,255,0.95)', fontFamily: 'var(--mono)',
              }}>✨ Gooday 神秘工具库</div>

              <h1 style={{
                fontSize: 'clamp(22px,5.8vw,32px)', fontWeight: 800,
                lineHeight: 1.15, marginBottom: 6,
                background: 'linear-gradient(140deg,#ffffff 0%,#c4b8ff 45%,#80d4ff 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>发现 · 学习 · 创造</h1>

              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 10 }}>
                工具一览 · 学习课程 · 兴趣社区
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: 14 }}>
                <button
                  className="btn btn-primary"
                  style={{ borderRadius: 999, padding: '8px 18px', fontSize: 13, fontFamily: 'var(--sans)', fontWeight: 600 }}
                  onClick={() => toolsSectionRef.current?.scrollIntoView({ behavior: 'smooth' })}
                >🚀 开始探索</button>
                <button
                  style={{
                    borderRadius: 999, padding: '8px 18px', fontSize: 13,
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)',
                    color: 'rgba(255,255,255,0.85)', cursor: 'pointer',
                    fontFamily: 'var(--sans)', fontWeight: 600,
                  }}
                  onClick={() => moduleNavRef.current?.scrollIntoView({ behavior: 'smooth' })}
                >了解更多</button>
              </div>
            </div>
            {/* Right: interactive AI box */}
            <HeroBox phase={boxPhase} onClick={handleBoxClick} boxRef={heroBoxRef} rollOffset={{ dx: burst.cx - cardOrigin.x, dy: burst.cy - cardOrigin.y }} />
          </div>
        </div>
      </div>

      {/* ===== 联系如意入口（DirectChat 开启时显示）===== */}
      {ruyiContact?.directChat && (
        <div style={{ maxWidth: 860, margin: '0.75rem auto 0', padding: '0 0.875rem' }}>
          <div
            onClick={() => {
              if (!user) { setAuthModal('login'); return }
              navigate(`/messages?with=${ruyiContact.ruyiUserId}`)
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 14,
              background: 'linear-gradient(135deg, rgba(124,108,255,0.12) 0%, rgba(124,108,255,0.05) 100%)',
              border: '1px solid rgba(124,108,255,0.25)',
              borderRadius: 12, padding: '14px 18px', cursor: 'pointer',
              transition: 'border-color 0.2s, background 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(124,108,255,0.55)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(124,108,255,0.25)'}
          >
            {ruyiContact.ruyiAvatar
              ? <img src={ruyiContact.ruyiAvatar} alt="如意"
                  style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} />
              : <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg,#7c6cff,#a78bfa)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18 }}>💬</div>
            }
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>联系如意</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                AI 前台，告诉我你的需求，我来帮你整理和跟进
              </div>
            </div>
            <span style={{ color: 'var(--accent)', fontSize: 20, flexShrink: 0 }}>›</span>
          </div>
        </div>
      )}

      {/* ===== Main Content ===== */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 0.875rem' }}>
        <div ref={moduleNavRef}>
          <ModuleNav navigate={navigate} />
        </div>
        <ToolsSection
          search={search} setSearch={setSearch}
          activeCat={activeCat} setActiveCat={setActiveCat}
          hotTools={hotTools} categories={categories} filtered={filtered}
          toolsSectionRef={toolsSectionRef} onOpenTool={handleOpenTool}
          favIds={favIds} onToggleFavorite={handleToggleFav}
          highlightId={highlightId}
        />
      </div>

      {selectedTool && (
        <ToolDetailModal
          tool={selectedTool}
          onClose={() => setSelectedTool(null)}
          onLoginRequest={() => setAuthModal('login')}
          favorited={favIds.has(selectedTool.id)}
          onToggleFavorite={handleToggleFav}
        />
      )}
      {authModal && (
        <AuthModal initialMode={authModal} onClose={() => setAuthModal(null)} />
      )}
    </>
  )
}
