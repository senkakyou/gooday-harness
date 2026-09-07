// =====================================================
// pages/FavoritesPage.jsx —— 我的收藏
// 路由：/favorites
// 职责：展示当前用户收藏的工具，支持打开详情、取消收藏（账号级，需登录）
// =====================================================
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listFavorites, toggleFavorite } from '../api/favorites'
import { getTool } from '../api/tools'
import ToolCard from '../components/ToolCard'
import ToolDetailModal from '../components/ToolDetailModal'
import AuthModal from '../components/AuthModal'
import useAuthStore from '../store/authStore'
import useToastStore from '../store/toastStore'

export default function FavoritesPage() {
  const user = useAuthStore(s => s.user)
  const navigate = useNavigate()
  const toast = useToastStore(s => s.toast)

  const [tools, setTools] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedTool, setSelectedTool] = useState(null)
  const [authModal, setAuthModal] = useState(null)

  useEffect(() => {
    if (!user) { setLoading(false); return }
    listFavorites().then(setTools).catch(() => {}).finally(() => setLoading(false))
  }, [user])

  const handleOpen = async (slug) => {
    try {
      const t = await getTool(slug)
      setSelectedTool(t)
    } catch (e) { toast(e.message, true) }
  }

  // 取消收藏：从列表移除（若详情弹窗正展示该工具则一并关闭）
  const handleUnfav = async (tool) => {
    try {
      const r = await toggleFavorite(tool.id)
      if (!r.favorited) {
        setTools(prev => prev.filter(t => t.id !== tool.id))
        setSelectedTool(cur => (cur && cur.id === tool.id ? null : cur))
        toast('已取消收藏')
      }
    } catch { toast('操作失败', true) }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '1.5rem 0.875rem 5rem' }}>
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>⭐ 我的收藏</h1>
        <p style={{ margin: '0.35rem 0 0', color: 'var(--muted)', fontSize: 13 }}>收藏的工具会同步到你的账号</p>
      </div>

      {!user ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '3rem 1rem' }}>
          <div style={{ fontSize: 40, marginBottom: '0.75rem' }}>⭐</div>
          <div style={{ fontSize: 14, marginBottom: '1rem' }}>登录后即可收藏工具，并在各设备同步</div>
          <button className="btn btn-primary" onClick={() => setAuthModal('login')}>登录 / 注册</button>
        </div>
      ) : loading ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '3rem' }}>加载中…</div>
      ) : tools.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '3rem 1rem' }}>
          <div style={{ fontSize: 40, marginBottom: '0.75rem' }}>📭</div>
          <div style={{ fontSize: 14, marginBottom: '1rem' }}>还没有收藏任何工具</div>
          <button className="btn btn-primary" onClick={() => navigate('/')}>去逛逛工具库</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tools.map(t => (
            <ToolCard
              key={t.id}
              tool={t}
              onClick={() => handleOpen(t.slug)}
              favorited={true}
              onToggleFavorite={handleUnfav}
            />
          ))}
        </div>
      )}

      {selectedTool && (
        <ToolDetailModal
          tool={selectedTool}
          onClose={() => setSelectedTool(null)}
          onLoginRequest={() => setAuthModal('login')}
          favorited={tools.some(t => t.id === selectedTool.id)}
          onToggleFavorite={handleUnfav}
        />
      )}
      {authModal && <AuthModal initialMode={authModal} onClose={() => setAuthModal(null)} />}
    </div>
  )
}
