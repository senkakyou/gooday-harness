// =====================================================
// pages/games/GamesHome.jsx —— 游戏中心首页
// 路由：/games
// 职责：展示游戏入口（五子棋、象棋）和当前用户的战绩档案
// =====================================================

import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../../store/authStore'
import { getGameProfile } from '../../api/games'

const GAMES = [
  {
    id: 'gomoku',
    name: '五子棋',
    icon: '⚫⚪',
    desc: '经典五子棋，先连五子者胜，支持联机对战和人机对战',
    color: '#c8941a',
    path: '/games/gomoku',
    ready: true,
  },
  {
    id: 'chess',
    name: '中国象棋',
    icon: '♞',
    desc: '经典中国象棋，支持联机对战和人机对战（三档难度），车马炮全规则实现',
    color: '#c8941a',
    path: '/games/chess',
    ready: true,
  },
]

const LEVEL_NAMES = ['', '列兵', '下士', '中士', '上士', '少尉', '中尉', '上尉', '少校', '中校', '上校']

export default function GamesHome() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    if (user) {
      getGameProfile().then(setProfile).catch(() => {})
    }
  }, [user])

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '0.25rem' }}>游戏中心</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>联机对战，与会员对弈，或挑战不同难度的机器人</p>
      </div>

      {/* 玩家等级卡片 */}
      {user && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '1.25rem 1.5rem',
          marginBottom: '2rem',
          display: 'flex',
          alignItems: 'center',
          gap: '2rem',
        }}>
          <div style={{ fontSize: 36 }}>🎖</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 4 }}>
              {user.username} 的游戏档案
            </div>
            {profile ? (
              (() => {
                const lv = profile.level ?? 1
                const wins = profile.winCount ?? 0
                const losses = profile.lossCount ?? 0
                const progress = wins % 3
                const toNext = 3 - progress
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                    <div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent)' }}>
                        Lv.{lv}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {LEVEL_NAMES[lv] || `等级 ${lv}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '1.5rem', fontSize: 13 }}>
                      <div>
                        <span style={{ color: 'var(--green)', fontWeight: 700 }}>{wins}</span>
                        <span style={{ color: 'var(--muted)' }}> 胜</span>
                      </div>
                      <div>
                        <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{losses}</span>
                        <span style={{ color: 'var(--muted)' }}> 负</span>
                      </div>
                    </div>
                    <div style={{ flex: 1, maxWidth: 200 }}>
                      <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          background: 'var(--accent)',
                          width: `${progress / 3 * 100}%`,
                          borderRadius: 3,
                          transition: 'width 0.5s',
                        }} />
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                        距下一级 {toNext} 胜
                      </div>
                    </div>
                  </div>
                )
              })()
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>暂无对战记录，开始第一局吧</div>
            )}
          </div>
        </div>
      )}

      {/* 游戏列表 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
        {GAMES.map(g => (
          <div key={g.id} style={{
            background: 'var(--surface)',
            border: `1px solid ${g.ready ? 'var(--border)' : 'var(--border)'}`,
            borderRadius: 12,
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            opacity: g.ready ? 1 : 0.5,
            transition: 'border-color 0.15s, transform 0.15s',
            cursor: g.ready ? 'default' : 'not-allowed',
          }}
          onMouseEnter={e => { if (g.ready) e.currentTarget.style.borderColor = 'var(--accent)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{
                width: 52, height: 52,
                background: `${g.color}22`,
                border: `1px solid ${g.color}44`,
                borderRadius: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 24,
              }}>{g.icon}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>{g.name}</div>
                {!g.ready && (
                  <span style={{
                    fontSize: 10, background: 'var(--surface2)', color: 'var(--muted)',
                    padding: '1px 6px', borderRadius: 4, fontFamily: 'var(--mono)',
                  }}>即将上线</span>
                )}
              </div>
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>{g.desc}</p>

            {g.ready && (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => navigate(`${g.path}?mode=pvp`)}
                  title={!user ? '联机对战需要登录' : ''}
                >
                  联机对战
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => navigate(`${g.path}?mode=pve`)}
                >
                  人机对战
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
