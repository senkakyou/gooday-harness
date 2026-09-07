// =====================================================
// components/ChatBox.jsx —— 全站公开留言板（悬浮聊天窗口）
// 职责：可拖拽的悬浮按钮 + 弹出式聊天窗口，通过 SignalR 实时收发公开消息
//
// 关键设计：
//   - 按钮位置持久化到 localStorage（刷新后恢复位置）
//   - 拖拽和点击用 moved 标志区分（移动超过 3px 视为拖拽，不触发展开）
//   - 聊天窗口在按钮上方或下方弹出（根据按钮离屏幕顶部距离动态判断）
// =====================================================

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import * as signalR from '@microsoft/signalr'
import useAuthStore from '../store/authStore'
import { getRuyiContact } from '../api/settings'

// 格式化消息时间为 HH:MM
function fmtTime(dt) {
  const d = new Date(dt)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// 悬浮按钮和聊天窗口的尺寸常量
const BTN_W = 112
const BTN_H = 34
const WIN_W = 320
const WIN_H = 440
const MARGIN = 16  // 距屏幕边缘的最小间距

// 从 localStorage 读取上次保存的按钮位置
function loadPos() {
  try {
    const s = localStorage.getItem('chatbox-pos')
    if (s) return JSON.parse(s)
  } catch {}
  return null
}

// 把数值限制在 [min, max] 范围内（防止按钮拖出屏幕外）
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

// 移动端（≤640px）底部有固定 Tab 栏（约 62px 高），按钮不能落进去和它打架
function bottomReserve() {
  return window.innerWidth <= 640 ? 70 : MARGIN
}

// 把按钮位置约束在安全区内：四周留 MARGIN，底部额外避开 Tab 栏
function clampPos(p) {
  return {
    x: clamp(p.x, MARGIN, window.innerWidth - BTN_W - MARGIN),
    y: clamp(p.y, MARGIN, window.innerHeight - BTN_H - bottomReserve()),
  }
}

export default function ChatBox() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const user = useAuthStore(s => s.user)
  const [enabled, setEnabled] = useState(true)
  const [open, setOpen] = useState(false)          // 聊天窗口是否展开
  const [messages, setMessages] = useState([])      // 消息列表
  const [input, setInput] = useState('')             // 输入框内容
  const [connected, setConnected] = useState(false) // SignalR 连接状态
  const [unread, setUnread] = useState(0)            // 窗口关闭时收到的未读数（红点）

  // 按钮位置状态：{ x, y } 表示按钮左上角坐标
  // 初始化时优先恢复上次位置，否则放右下角
  const [pos, setPos] = useState(() => {
    const saved = loadPos()
    // 恢复的旧位置也要重新约束——历史上可能存了落在 Tab 栏里的坐标
    return clampPos(saved || {
      x: window.innerWidth - BTN_W - MARGIN,
      y: window.innerHeight - BTN_H - bottomReserve(),
    })
  })

  useEffect(() => {
    getRuyiContact().then(d => setEnabled(d.chatBoxEnabled !== false)).catch(() => {})
  }, [])

  const connRef = useRef(null)   // SignalR 连接实例
  const bottomRef = useRef(null) // 消息列表底部锚点，用于自动滚动
  const openRef = useRef(open)   // 用 ref 保存 open 状态，避免 SignalR 回调里的闭包陈旧问题
  openRef.current = open

  // 拖拽状态用 ref 而不是 state（避免频繁重渲染，也避免事件回调中的闭包陈旧）
  const dragging = useRef(false)
  const dragStart = useRef({ px: 0, py: 0, bx: 0, by: 0 })  // 拖拽起点（指针坐标 + 按钮坐标）
  const moved = useRef(false)    // 是否发生了有效移动（超过 3px），用于区分点击和拖拽
  const posRef = useRef(pos)
  posRef.current = pos

  // 初始化 SignalR 连接，订阅历史消息和新消息推送
  useEffect(() => {
    const token = localStorage.getItem('token')
    const builder = new signalR.HubConnectionBuilder()
      .withUrl('/hubs/chat', token ? { accessTokenFactory: () => token } : {})
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build()

    // 连接成功后后端推送历史消息（最近 N 条）
    builder.on('History', (history) => {
      setMessages(history.map(m => ({ ...m })))
    })
    // 实时接收新消息；窗口关闭时累计未读数
    builder.on('ReceiveMessage', (msg) => {
      setMessages(prev => [...prev, msg])
      if (!openRef.current) setUnread(n => n + 1)
    })
    builder.onclose(() => setConnected(false))
    builder.onreconnected(() => setConnected(true))
    builder.start().then(() => setConnected(true)).catch(() => setConnected(false))
    connRef.current = builder
    return () => { builder.stop() }
  }, [])

  // 展开聊天窗口时：清零未读数，延迟滚动到底部
  useEffect(() => {
    if (open) {
      setUnread(0)
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }, [open])

  // 收到新消息时如果窗口已展开，自动滚到底部
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 按钮位置变化时持久化到 localStorage
  useEffect(() => {
    localStorage.setItem('chatbox-pos', JSON.stringify(pos))
  }, [pos])

  // 全局 pointermove：拖拽时计算新位置，限制在屏幕边界内
  const onPointerMove = useCallback((e) => {
    if (!dragging.current) return
    const dx = e.clientX - dragStart.current.px
    const dy = e.clientY - dragStart.current.py
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true  // 超过 3px 才算有效拖拽

    setPos(clampPos({ x: dragStart.current.bx + dx, y: dragStart.current.by + dy }))
  }, [])

  // 全局 pointerup：结束拖拽
  const onPointerUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    document.releasePointerCapture?.()
  }, [])

  // 注册/注销全局指针事件（用 useCallback 依赖稳定，避免重复注册）
  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [onPointerMove, onPointerUp])

  // 按钮按下：记录拖拽起点
  const onBtnPointerDown = (e) => {
    e.preventDefault()
    dragging.current = true
    moved.current = false
    dragStart.current = {
      px: e.clientX,
      py: e.clientY,
      bx: posRef.current.x,
      by: posRef.current.y,
    }
  }

  // 按钮点击：只有没有拖拽（moved=false）时才展开/收起聊天窗口
  const onBtnClick = () => {
    if (moved.current) return
    setOpen(v => !v)
  }

  // 发送消息（调用 SignalR Hub 的 SendMessage 方法）
  const handleSend = async () => {
    if (!input.trim() || !connRef.current || !connected) return
    try {
      await connRef.current.invoke('SendMessage', input.trim())
      setInput('')
    } catch {}
  }

  // Enter 键发送（Shift+Enter 换行）
  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // 判断聊天窗口弹到按钮上方还是下方（按钮在屏幕下半部分时向上弹）
  const showAbove = pos.y > WIN_H + MARGIN
  const winLeft = clamp(pos.x + BTN_W / 2 - WIN_W / 2, MARGIN, window.innerWidth - WIN_W - MARGIN)

  if (!enabled || pathname === '/messages') return null

  return (
    <>
      {/* 聊天窗口 — 独立定位，不跟随按钮层级 */}
      {open && (
        <div style={{
          position: 'fixed',
          left: winLeft,
          top: showAbove
            ? pos.y - WIN_H - 10
            : pos.y + BTN_H + 10,
          width: WIN_W,
          height: WIN_H,
          zIndex: 1001,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}>
          {/* 标题栏 */}
          <div style={{
            padding: '0.75rem 1rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: 'var(--surface2)',
            userSelect: 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>在线聊天</span>
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: connected ? '#0c6' : '#888',
                display: 'inline-block',
              }} />
            </div>
            <button className="modal-x" onClick={() => setOpen(false)}>×</button>
          </div>

          {/* 消息列表 */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, marginTop: '2rem' }}>暂无消息，发个招呼吧</div>
            )}
            {messages.map((m, i) => {
              const isMine = user && m.userId === user.userId
              return (
                <div key={m.id ?? i} style={{ display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start' }}>
                  {!isMine && (
                    <span
                      style={{ fontSize: 11, color: 'var(--accent)', marginBottom: 2, cursor: 'pointer' }}
                      onClick={() => navigate(`/messages?with=${m.userId}`)}
                      title="发私信"
                    >{m.username}</span>
                  )}
                  <div style={{
                    maxWidth: '80%',
                    padding: '0.4rem 0.75rem',
                    borderRadius: isMine ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                    background: isMine ? 'var(--accent)' : 'var(--surface2)',
                    color: isMine ? '#fff' : 'var(--text)',
                    fontSize: 13,
                    wordBreak: 'break-word',
                  }}>
                    {m.content}
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{fmtTime(m.createdAt)}</span>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {/* 输入框 */}
          <div style={{ borderTop: '1px solid var(--border)', padding: '0.6rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            {user ? (
              <>
                <input
                  className="input"
                  style={{ flex: 1, fontSize: 16, padding: '0.4rem 0.6rem' }}
                  placeholder="输入消息…"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  maxLength={500}
                  disabled={!connected}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSend}
                  disabled={!input.trim() || !connected}
                >发送</button>
              </>
            ) : (
              <div style={{ width: '100%', textAlign: 'center', fontSize: 12, color: 'var(--muted)', padding: '0.3rem 0' }}>
                请<a href="/login" style={{ color: 'var(--accent)', margin: '0 0.25rem' }}>登录</a>后发言
              </div>
            )}
          </div>
        </div>
      )}

      {/* 可拖拽悬浮按钮 */}
      <div
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          zIndex: 1000,
          cursor: dragging.current ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
        onPointerDown={onBtnPointerDown}
        onClick={onBtnClick}
      >
        <div
          style={{
            height: BTN_H,
            padding: '0 14px',
            borderRadius: BTN_H / 2,
            background: 'rgba(124,108,255,0.18)',
            border: '1px solid rgba(124,108,255,0.5)',
            backdropFilter: 'blur(10px)',
            cursor: 'inherit',
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 13, color: 'var(--text)', fontWeight: 600,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            position: 'relative',
          }}
        >
          <span>留言</span>
          {unread > 0 && (
            <span style={{
              position: 'absolute', top: -6, right: -6,
              background: '#e55', color: '#fff',
              borderRadius: '50%', width: 18, height: 18,
              fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </div>
      </div>
    </>
  )
}
