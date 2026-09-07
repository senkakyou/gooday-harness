// =====================================================
// pages/IframeTool.jsx —— 工具在线运行页
// 职责：根据 URL 里的 slug 加载工具信息，用 iframe 嵌入工具的 onlineUrl
// 路由：/tool/:slug（:slug 是占位符，实际值从 useParams() 取）
// =====================================================

import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getTool } from '../api/tools'

export default function IframeTool() {
  // useParams：从当前 URL 里提取路由参数
  // 比如 URL 是 /tool/pdf-merge，则 slug = "pdf-merge"
  const { slug } = useParams()
  const navigate = useNavigate()
  const [tool, setTool] = useState(null)

  useEffect(() => {
    // 根据 slug 请求工具详情（同时会让后端的 viewCount +1）
    // 如果工具不存在（404），跳回首页
    getTool(slug).then(setTool).catch(() => navigate('/'))
  }, [slug])  // slug 变化时重新请求（如果用户直接改 URL）

  // 数据还没加载完时不渲染任何内容
  if (!tool) return null

  return (
    <div>
      {/* 顶部工具栏：显示工具名，提供返回首页按钮 */}
      <div style={{
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '0.75rem 1.5rem', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)' }}>
          {tool.iconEmoji} {tool.name}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
          ← 返回主页
        </button>
      </div>

      {/* iframe：嵌入工具的实际页面 */}
      {/* height 用 calc 减去 Navbar(56px) + 工具栏(约41px) = 97px */}
      {/* allow="clipboard-write" 允许工具使用剪贴板（如"一键复制"功能） */}
      <iframe
        src={tool.onlineUrl}
        style={{ width: '100%', height: 'calc(100vh - 97px)', border: 'none' }}
        allow="clipboard-write"
      />
    </div>
  )
}
