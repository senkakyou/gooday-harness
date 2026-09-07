// =====================================================
// components/ToolDetailModal.jsx —— 工具详情弹窗
// 职责：展示工具完整信息，处理在线运行和下载逻辑（含付费流程）
//
// 付费工具的下载流程：
//   idle（默认）→ 打开弹窗时检查购买状态
//   show         → 未购买，显示收款码和"我已付款"按钮
//   pending      → 已提交付款记录，等待管理员激活
//   purchased    → 已激活，可直接下载
// =====================================================

import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { checkPurchase, myPurchases, submitPurchase } from '../api/purchases'
import { downloadTool } from '../api/tools'
import useAuthStore from '../store/authStore'
import useToastStore from '../store/toastStore'
import MediaContent from './forum/MediaContent'

export default function ToolDetailModal({ tool, onClose, onLoginRequest, favorited = false, onToggleFavorite }) {
  const navigate = useNavigate()
  const { token, user } = useAuthStore()
  const toast = useToastStore(s => s.toast)
  const payRef = useRef(null)  // 付款区域，用于未付款时自动滚动定位

  // 付费状态机：'idle' | 'show' | 'pending' | 'purchased'
  const [payState, setPayState] = useState('idle')
  const [payLoading, setPayLoading] = useState(false)

  // 弹窗打开时，如果是付费工具且已登录，查询当前购买状态
  useEffect(() => {
    if (!tool.isPaid || !tool.hasDownload) return  // 免费工具直接跳过
    if (!token) return                              // 未登录也跳过（下载时再引导登录）

    checkPurchase(tool.id).then(d => {
      if (d.activated) {
        setPayState('purchased')  // 已激活，直接可下载
      } else {
        // 再查一下有没有待审核的记录（防止重复提交）
        myPurchases().then(list => {
          const hasPending = list?.some(p => p.toolId === tool.id && p.status === 'pending')
          setPayState(hasPending ? 'pending' : 'show')  // 有待审核 → pending，没有 → 显示付款二维码
        }).catch(() => setPayState('show'))
      }
    }).catch(() => {})
  }, [tool, token])

  // 处理下载按钮点击
  const handleDownload = () => {
    // 需要登录（或付费）的工具，未登录时引导登录
    if ((tool.requireLogin || tool.isPaid) && !token) {
      onClose(); onLoginRequest(); return
    }
    if (tool.isPaid && payState !== 'purchased') {
      toast('请先付款后再下载', true)
      payRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      return
    }
    downloadTool(tool.slug)  // 触发浏览器文件下载
    toast('开始下载')
  }

  // 处理"我已付款"按钮点击：提交购买记录到后端，等管理员审核
  const handlePaid = async () => {
    if (!token) { onClose(); onLoginRequest(); return }
    setPayLoading(true)
    try {
      await submitPurchase(tool.id)
      setPayState('pending')  // 切换到"等待确认"状态
      toast('已提交，等待确认')
    } catch (e) {
      toast(e.message, true)
    } finally {
      setPayLoading(false)
    }
  }

  return (
    // 点击遮罩关闭弹窗
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <button className="modal-close" onClick={onClose}>×</button>

        {/* 工具基本信息 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '2.5rem' }}>{tool.iconEmoji}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 500 }}>{tool.name}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent2)' }}>{tool.category}</div>
          </div>
          {/* 收藏 */}
          <button
            onClick={() => onToggleFavorite?.(tool)}
            title={favorited ? '取消收藏' : '收藏'}
            style={{
              flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
              padding: 4, lineHeight: 1, color: favorited ? '#f5b301' : 'var(--muted)',
            }}
          >
            <svg width="26" height="26" viewBox="0 0 22 22"
              fill={favorited ? 'currentColor' : 'none'}
              stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 2l2.5 5.3 5.8.8-4.2 4.1 1 5.8L11 15.3l-5.1 2.7 1-5.8L2.7 8.1l5.8-.8z"/>
            </svg>
          </button>
        </div>

        <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>{tool.description}</p>

        {/* 浏览量和下载量统计 */}
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.875rem', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
          <span>👁 {tool.viewCount}</span>
          <span>⬇ {tool.downloadCount}</span>
        </div>


        {/* 操作按钮区 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: '1.25rem' }}>
          {/* 在线运行：跳转到 /tool/:slug 页面（全屏 iframe） */}
          {tool.isOnline && (
            <button
              className="btn btn-primary"
              style={{ background: 'var(--accent2)', color: '#000' }}
              onClick={() => { onClose(); navigate(`/tool/${tool.slug}`) }}
            >
              ▶ 在线运行
            </button>
          )}
          {/* 下载按钮（付费工具未购买时点击会提示先付款） */}
          {tool.hasDownload && (
            <button className="btn btn-primary" onClick={handleDownload}>
              ⬇ 下载
            </button>
          )}
        </div>

        {/* 付费流程区域（只对付费工具显示） */}
        {tool.isPaid && tool.hasDownload && (
          <div ref={payRef}>
            {/* 状态：show —— 显示收款码，等用户付款 */}
            {payState === 'show' && (
              <div style={{ marginTop: '1rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>该工具需要付费下载</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent2)' }}>¥{tool.price}</div>
                  </div>
                  <div style={{ fontSize: '2rem' }}>💰</div>
                </div>
                <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: '0.75rem' }}>扫码付款后点「我已付款」</div>
                  {/* 收款二维码图片，需要管理员上传到 /uploads/wechat-pay-qr.png */}
                  <div style={{ background: '#fff', padding: 12, borderRadius: 8, display: 'inline-block' }}>
                    <img src="/uploads/wechat-pay-qr.png" alt="收款码" style={{ width: 180, height: 180, display: 'block' }} />
                  </div>
                  {/* 备注用户名，便于管理员核对到账与账号 */}
                  <div style={{ marginTop: '0.75rem', fontSize: 12, color: 'var(--warn)', fontWeight: 600 }}>
                    转账时请备注用户名：{user?.username || '（你的用户名）'}
                  </div>
                  <div style={{ marginTop: 2, fontSize: 11, color: 'var(--muted)' }}>
                    不备注可能无法核对到账，导致延迟开通
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: '0.5rem' }}
                  onClick={handlePaid}
                  disabled={payLoading}
                >
                  {payLoading ? '提交中...' : '✅ 我已付款，提交确认'}
                </button>
                <div style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: 11, color: 'var(--muted)' }}>
                  付款后人工审核，通常1小时内确认
                </div>
              </div>
            )}

            {/* 状态：purchased —— 已购买，提示可下载 */}
            {payState === 'purchased' && (
              <div style={{ marginTop: '1rem', padding: 12, background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 6, fontSize: 13, color: 'var(--green)', textAlign: 'center' }}>
                ✅ 已购买，可直接下载
              </div>
            )}

            {/* 状态：pending —— 付款已提交，等管理员激活 */}
            {payState === 'pending' && (
              <div style={{ marginTop: '1rem', padding: 12, background: 'rgba(255,165,0,.1)', border: '1px solid rgba(255,165,0,.3)', borderRadius: 6, fontSize: 13, color: 'var(--warn)', textAlign: 'center' }}>
                ⏳ 付款待确认中，请耐心等待
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
