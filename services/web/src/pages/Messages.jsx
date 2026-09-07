// =====================================================
// pages/Messages.jsx —— 私信中心页
// 路由：/messages（?with=userId 可直接打开指定会话）
// 职责：左侧展示会话列表/好友列表，右侧展示单个会话聊天界面
// 实时消息通过 SignalR /hubs/chat 推送，支持文字、图片、文件
// =====================================================

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as signalR from '@microsoft/signalr'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import useAuthStore from '../store/authStore'
import useToastStore from '../store/toastStore'
import { confirmDialog } from '../store/confirmStore'
import { getConversations, getMessages, sendMessage, uploadChatMedia, deleteMessage, hideConversation, clearConversationMessages } from '../api/messages'
import { searchUsers } from '../api/auth'
import {
  getFriends, getFriendRequests, sendFriendRequest,
  acceptFriendRequest, declineFriendRequest, removeFriend, getFriendStatus,
  setFriendRemark
} from '../api/friends'
import Avatar from './messages/Avatar'
import MediaBubble from './messages/MediaBubble'
import { fmtTime, fmtSize } from './messages/helpers'

export default function Messages() {
  const { user } = useAuthStore()
  const toast = useToastStore(s => s.toast)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const initWith = searchParams.get('with')

  const [tab, setTab] = useState('convs') // 'convs' | 'friends'
  const [convs, setConvs] = useState([])
  const [friends, setFriends] = useState([])
  const [friendRequests, setFriendRequests] = useState([])
  const [activeUserId, setActiveUserId] = useState(initWith ? parseInt(initWith) : null)
  const [activeUsername, setActiveUsername] = useState('')
  const [activeAvatar, setActiveAvatar] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [pendingMedia, setPendingMedia] = useState(null) // { url, type, name, size }
  const [voiceMode, setVoiceMode] = useState(false)   // 语音输入模式
  const [recording, setRecording] = useState(false)   // 正在录音
  const [recSeconds, setRecSeconds] = useState(0)      // 已录制秒数
  const [recCancelling, setRecCancelling] = useState(false) // 上滑取消状态
  const [msgPage, setMsgPage] = useState(1)        // 已加载到第几页历史
  const [hasMoreMsgs, setHasMoreMsgs] = useState(false) // 是否还有更早的消息
  const [loadingMore, setLoadingMore] = useState(false) // 正在加载更早消息
  const [ctxMenu, setCtxMenu] = useState(null) // { msg, x, y }
  const [swipedConvId, setSwipedConvId] = useState(null) // 当前滑开的会话 userId
  const swipeStartX = useRef(null)
  // 好友列表交互状态
  const [friendMenuId, setFriendMenuId] = useState(null)   // 三点菜单打开的好友 userId
  const [friendDetail, setFriendDetail] = useState(null)   // { id, username, avatarUrl, remark, friendSince }
  const [remarkInput, setRemarkInput] = useState('')        // 备注编辑中的值
  const [remarkSaving, setRemarkSaving] = useState(false)
  const friendMenuRef = useRef(null)
  const connRef = useRef(null)
  const bottomRef = useRef(null)
  const listRef = useRef(null)         // 消息滚动容器，用于检测上滑到顶 + 维持滚动位置
  const prependHeightRef = useRef(null) // 加载更早消息前的 scrollHeight，用于维持视口位置
  const fileRef = useRef(null)
  const ctxMenuRef = useRef(null)
  const longPressTimer = useRef(null)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const recTimerRef = useRef(null)
  const recCancelledRef = useRef(false)
  const recognitionRef = useRef(null)
  const voiceTranscriptRef = useRef('')
  const recBtnRef = useRef(null)
  const myId = user?.userId
  const MSG_PAGE_SIZE = 50              // 与后端分页大小一致
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640)
  const [viewportH, setViewportH] = useState(() => window.innerHeight)
  useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth < 640)
      setViewportH(window.innerHeight)
      // iOS Safari 键盘弹出/收回会改变视口高度，触发触摸热区错位
      // 用 window.scrollBy(0,0) 强制 Safari 刷新 hit-test
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.scrollBy(0, 0)
        })
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!user) { navigate('/', { replace: true }); return }
    loadConvs()
    loadFriends()
    startSignalR()
    return () => connRef.current?.stop()
  }, [])

  useEffect(() => {
    if (initWith) setActiveUserId(parseInt(initWith))
  }, [initWith])

  useEffect(() => {
    if (activeUserId) loadMessages(activeUserId)
  }, [activeUserId])

  useEffect(() => {
    // 加载更早消息（prepend）后维持视口位置，否则滚到底部
    // 双层 requestAnimationFrame：iOS Safari 在首帧设 scrollTop 后不更新触摸热区，
    // 需等第二帧（浏览器 paint 完成后）再设值，才能让输入框正常响应点击。
    if (prependHeightRef.current != null) {
      const el = listRef.current
      if (el) el.scrollTop = el.scrollHeight - prependHeightRef.current
      prependHeightRef.current = null
    } else {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
          // 强制 iOS Safari 刷新触摸热区（scrollTop 后不会自动更新 hit-test）
          window.scrollBy(0, 0)
        })
      })
    }
  }, [messages])

  const loadConvs = async () => {
    try { setConvs(await getConversations()) } catch {}
  }

  const loadFriends = async () => {
    try {
      const [fl, rl] = await Promise.all([getFriends(), getFriendRequests()])
      setFriends(fl)
      setFriendRequests(rl)
    } catch {}
  }

  const loadMessages = async (uid) => {
    setLoading(true)
    try {
      const data = await getMessages(uid, 1)
      setMessages(data)
      setMsgPage(1)
      setHasMoreMsgs(data.length >= MSG_PAGE_SIZE)
      setConvs(prev => prev.map(c => c.userId === uid ? { ...c, unread: 0 } : c))
    } catch (e) {
      if (e.response?.status === 403) {
        toast('此账号为私有账号，无法访问', true)
        setActiveUserId(null)
        setActiveUsername('')
        setConvs(prev => prev.filter(c => c.userId !== uid))
      }
    }
    finally { setLoading(false) }
  }

  // 上滑到顶时加载更早的一页消息，prepend 到列表头部并维持滚动位置
  const loadMoreMessages = async () => {
    if (loadingMore || !hasMoreMsgs || !activeUserId) return
    setLoadingMore(true)
    const nextPage = msgPage + 1
    try {
      const older = await getMessages(activeUserId, nextPage)
      if (!older.length) { setHasMoreMsgs(false); return }
      prependHeightRef.current = listRef.current?.scrollHeight ?? 0
      setMessages(prev => {
        const seen = new Set(prev.map(m => m.id))
        const merged = older.filter(m => !seen.has(m.id))
        return [...merged, ...prev]
      })
      setMsgPage(nextPage)
      setHasMoreMsgs(older.length >= MSG_PAGE_SIZE)
    } catch {}
    finally { setLoadingMore(false) }
  }

  const handleListScroll = (e) => {
    if (e.currentTarget.scrollTop < 40) loadMoreMessages()
  }

  const startSignalR = () => {
    const token = localStorage.getItem('token')
    const conn = new signalR.HubConnectionBuilder()
      .withUrl('/hubs/chat', token ? { accessTokenFactory: () => token } : {})
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build()

    conn.on('PrivateMessage', (msg) => {
      const otherId = msg.senderId === myId ? msg.receiverId : msg.senderId
      setActiveUserId(cur => {
        if (cur === otherId || cur === msg.senderId) {
          setMessages(prev => {
            if (prev.find(m => m.id === msg.id)) return prev
            return [...prev, msg]
          })
        }
        return cur
      })
      setConvs(prev => {
        const exists = prev.find(c => c.userId === otherId)
        const lastMsg = msg.content || (msg.mediaType === 'image' ? '[图片]' : msg.mediaType === 'audio' ? '[语音]' : msg.mediaType === 'file' ? `[文件] ${msg.mediaName}` : '')
        if (exists) {
          return prev.map(c => c.userId === otherId
            ? { ...c, lastMessage: lastMsg, lastAt: msg.createdAt,
                unread: msg.senderId !== myId ? c.unread + 1 : c.unread }
            : c
          ).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt))
        }
        return [{
          userId: otherId,
          username: msg.senderId === myId ? msg.receiverUsername : msg.senderUsername,
          avatarUrl: msg.senderId === myId ? null : msg.senderAvatar,
          lastMessage: lastMsg, lastAt: msg.createdAt,
          unread: msg.senderId !== myId ? 1 : 0,
        }, ...prev]
      })
    })

    conn.on('FriendRequest', ({ fromId, fromUsername }) => {
      setFriendRequests(prev => {
        if (prev.find(r => r.requesterId === fromId)) return prev
        return [...prev, { requesterId: fromId, username: fromUsername, createdAt: new Date().toISOString() }]
      })
    })

    conn.on('FriendAccepted', ({ byId, byUsername }) => {
      setFriends(prev => {
        if (prev.find(f => f.id === byId)) return prev
        return [...prev, { id: byId, username: byUsername, avatarUrl: null }]
      })
    })

    conn.start().catch(() => {})
    connRef.current = conn
  }

  const openConv = (conv) => {
    setActiveUserId(conv.userId)
    setActiveUsername(conv.username)
    setActiveAvatar(conv.avatarUrl)
    setSearchParams({})
    setPendingMedia(null)
  }

  const handleSearch = async (q) => {
    setSearchQ(q)
    if (!q.trim()) { setSearchResults([]); return }
    setSearching(true)
    try { setSearchResults(await searchUsers(q)) }
    catch {}
    finally { setSearching(false) }
  }

  const startChat = (u) => {
    setSearchQ('')
    setSearchResults([])
    setActiveUserId(u.id)
    setActiveUsername(u.username)
    setActiveAvatar(u.avatarUrl)
    setSearchParams({})
    setPendingMedia(null)
    setConvs(prev => {
      if (prev.find(c => c.userId === u.id)) return prev
      return [{ userId: u.id, username: u.username, avatarUrl: u.avatarUrl, lastMessage: '', lastAt: new Date().toISOString(), unread: 0 }, ...prev]
    })
  }

  const handleAddFriend = async (u) => {
    try {
      await sendFriendRequest(u.id)
      toast(`已向 ${u.username} 发送好友申请`)
    } catch (e) {
      toast(e.response?.data?.message || '操作失败', true)
    }
    setSearchQ('')
    setSearchResults([])
  }

  const handleAccept = async (userId) => {
    try {
      await acceptFriendRequest(userId)
      await loadFriends()
    } catch (e) {
      toast(e.response?.data?.message || '操作失败', true)
    }
  }

  const handleDecline = async (userId) => {
    try {
      await declineFriendRequest(userId)
      setFriendRequests(prev => prev.filter(r => r.requesterId !== userId))
    } catch {}
  }

  const handleRemoveFriend = async (userId) => {
    setFriendMenuId(null)
    if (!await confirmDialog('确定删除该好友？', { danger: true, confirmText: '删除' })) return
    try {
      await removeFriend(userId)
      setFriends(prev => prev.filter(f => f.id !== userId))
      if (friendDetail?.id === userId) setFriendDetail(null)
    } catch {}
  }

  // 打开好友详情
  const openFriendDetail = (f) => {
    setFriendMenuId(null)
    setFriendDetail(f)
    setRemarkInput(f.remark || '')
  }

  // 保存备注并返回
  const handleSaveRemark = async () => {
    if (!friendDetail) return
    setRemarkSaving(true)
    try {
      await setFriendRemark(friendDetail.id, remarkInput)
      setFriends(prev => prev.map(f => f.id === friendDetail.id ? { ...f, remark: remarkInput.trim() || null } : f))
      setFriendDetail(null)
    } catch {
      toast('保存失败', true)
    } finally {
      setRemarkSaving(false)
    }
  }

  // 三点菜单点击外关闭
  useEffect(() => {
    if (!friendMenuId) return
    const close = (e) => {
      if (friendMenuRef.current && !friendMenuRef.current.contains(e.target)) setFriendMenuId(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [friendMenuId])

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''

    if (file.size > 20 * 1024 * 1024) {
      toast('文件不能超过 20MB', true)
      return
    }

    setUploading(true)
    setUploadProgress(0)
    try {
      const data = await uploadChatMedia(file, p => setUploadProgress(p))
      setPendingMedia(data)
    } catch (err) {
      toast(err.response?.data?.message || '上传失败', true)
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  // ——— 语音录制 ———
  const startRecording = async () => {
    if (recording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4']
        .find(t => { try { return MediaRecorder.isTypeSupported(t) } catch { return false } }) || ''
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {})
      chunksRef.current = []
      recCancelledRef.current = false
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        if (recCancelledRef.current || chunksRef.current.length === 0) return
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
        await uploadAndSendAudio(blob, mr.mimeType)
      }
      mr.start()
      mediaRecorderRef.current = mr
      setRecording(true)
      setRecCancelling(false)
      setRecSeconds(0)
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000)
      // 同步启动语音识别（Chrome/Edge 支持，Safari 降级为空）
      voiceTranscriptRef.current = ''
      try {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition
        if (SR) {
          const rec = new SR()
          rec.lang = 'zh-CN'
          rec.continuous = true
          rec.interimResults = true
          rec.onresult = (e) => {
            let txt = ''
            for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript
            voiceTranscriptRef.current = txt
          }
          rec.onerror = () => {}
          rec.start()
          recognitionRef.current = rec
        }
      } catch {}
    } catch {
      toast('无法访问麦克风，请检查浏览器权限', true)
    }
  }

  const stopRecording = (cancel = false) => {
    if (!mediaRecorderRef.current) return
    recCancelledRef.current = cancel
    clearInterval(recTimerRef.current)
    setRecording(false)
    setRecCancelling(false)
    setRecSeconds(0)
    try { mediaRecorderRef.current.stop() } catch {}
    mediaRecorderRef.current = null
    try { recognitionRef.current?.stop() } catch {}
    recognitionRef.current = null
  }

  const uploadAndSendAudio = async (blob, mimeType) => {
    const ext = mimeType?.includes('ogg') ? '.ogg' : mimeType?.includes('mp4') ? '.m4a' : '.webm'
    const file = new File([blob], `voice${ext}`, { type: blob.type || 'audio/webm' })
    const transcript = voiceTranscriptRef.current?.trim() || null
    try {
      const data = await uploadChatMedia(file, () => {})
      await sendMessage(activeUserId, {
        content: transcript,   // 语音识别文字，供「转文字」展示；无识别时为 null
        mediaUrl: data.url,
        mediaType: 'audio',
        mediaName: data.name,
        mediaSize: data.size,
      })
    } catch {
      toast('语音发送失败', true)
    }
  }

  const handleSend = async () => {
    const content = input.trim()
    if (!content && !pendingMedia) return
    if (!activeUserId) return

    const payload = {
      content: content || null,
      mediaUrl: pendingMedia?.url || null,
      mediaType: pendingMedia?.type || null,
      mediaName: pendingMedia?.name || null,
      mediaSize: pendingMedia?.size || null,
    }

    setInput('')
    setPendingMedia(null)
    try {
      await sendMessage(activeUserId, payload)
    } catch (e) {
      setInput(content)
      if (e.response?.status === 403) toast(e.response?.data?.message || '无权限向此用户发送消息', true)
    }
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // 长按（移动端）或右键（PC）弹出消息操作菜单
  const openCtxMenu = (e, msg) => {
    e.preventDefault()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const menuW = 120
    const menuH = msg.content ? 88 : 44
    let x = e.clientX ?? (e.touches?.[0]?.clientX ?? vw / 2)
    let y = e.clientY ?? (e.touches?.[0]?.clientY ?? vh / 2)
    if (x + menuW > vw - 8) x = vw - menuW - 8
    if (y + menuH > vh - 8) y = y - menuH - 8
    setCtxMenu({ msg, x: Math.max(8, x), y: Math.max(8, y) })
  }

  const handleBubbleDown = (e, msg) => {
    if (e.pointerType === 'mouse') return
    longPressTimer.current = setTimeout(() => openCtxMenu(e, msg), 500)
  }
  const cancelLongPress = () => clearTimeout(longPressTimer.current)

  const handleCtxCopy = (text) => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCtxMenu(null)
  }

  const handleCtxDelete = async (msgId) => {
    setCtxMenu(null)
    try {
      await deleteMessage(msgId)
      setMessages(prev => prev.filter(m => m.id !== msgId))
    } catch {
      toast('删除失败', true)
    }
  }

  // 会话条左滑手势
  const handleConvTouchStart = (e, userId) => {
    if (swipedConvId && swipedConvId !== userId) setSwipedConvId(null)
    swipeStartX.current = e.touches[0].clientX
  }
  const handleConvTouchEnd = (e, userId) => {
    if (swipeStartX.current == null) return
    const dx = e.changedTouches[0].clientX - swipeStartX.current
    swipeStartX.current = null
    if (dx < -50) {
      setSwipedConvId(userId)
    } else if (dx > 20) {
      setSwipedConvId(null)
    }
  }

  // 删除会话（隐藏，消息保留）
  const handleDeleteConv = async (userId) => {
    setSwipedConvId(null)
    try {
      await hideConversation(userId)
      setConvs(prev => prev.filter(c => c.userId !== userId))
      if (activeUserId === userId) closeChat()
    } catch {
      toast('操作失败', true)
    }
  }

  // 清空聊天内容（删除所有消息，会话保留在列表）
  const handleClearConv = async (userId) => {
    if (!await confirmDialog('确定清空与该用户的全部聊天记录？', { danger: true, confirmText: '清空' })) return
    setSwipedConvId(null)
    try {
      await clearConversationMessages(userId)
      setConvs(prev => prev.map(c => c.userId === userId ? { ...c, lastMessage: '', unread: 0 } : c))
      if (activeUserId === userId) setMessages([])
    } catch {
      toast('操作失败', true)
    }
  }

  // 点击菜单外关闭
  useEffect(() => {
    if (!ctxMenu) return
    const close = (e) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target)) setCtxMenu(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [ctxMenu])

  useEffect(() => {
    if (activeUserId) {
      const c = convs.find(c => c.userId === activeUserId)
      if (c) { setActiveUsername(c.username); setActiveAvatar(c.avatarUrl) }
      const f = friends.find(f => f.id === activeUserId)
      if (f && !c) { setActiveUsername(f.username); setActiveAvatar(f.avatarUrl) }
    }
  }, [activeUserId, convs, friends])

  if (!user) return null

  const totalUnread = convs.reduce((s, c) => s + c.unread, 0)
  const pendingReqCount = friendRequests.length
  const showList = !isMobile || !activeUserId
  const closeChat = () => { setActiveUserId(null); setMessages([]) }

  return (
    <div style={isMobile ? {
      display: 'flex',
      position: 'fixed',
      top: 0,
      bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))',
      left: 0,
      right: 0,
      overflow: 'hidden',
    } : {
      display: 'flex',
      height: 'calc(100vh - 56px)',
      overflow: 'hidden',
    }}>
      {/* 左侧/列表面板 */}
      {showList && <div style={{
        width: isMobile ? '100%' : 280, flexShrink: 0,
        borderRight: isMobile ? 'none' : '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', background: 'var(--surface)',
      }}>
        {/* Tab 切换 */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {[
            { key: 'convs', label: '会话', badge: totalUnread },
            { key: 'friends', label: '好友', badge: pendingReqCount },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              flex: 1, padding: '0.7rem', border: 'none', background: 'none',
              cursor: 'pointer', fontSize: 13, fontWeight: tab === t.key ? 700 : 400,
              color: tab === t.key ? 'var(--accent)' : 'var(--muted)',
              borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              position: 'relative',
            }}>
              {t.label}
              {t.badge > 0 && (
                <span style={{
                  marginLeft: 4, background: '#e55', color: '#fff',
                  borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 5px',
                }}>{t.badge > 99 ? '99+' : t.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* 搜索栏（两个 tab 都有） */}
        <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', position: 'relative' }}>
          <input
            className="input"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 16 }}
            placeholder="搜索用户…"
            value={searchQ}
            onChange={e => handleSearch(e.target.value)}
          />
          {searchResults.length > 0 && (
            <div style={{
              position: 'absolute', zIndex: 10, background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 8, width: 248,
              top: '100%', left: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}>
              {searchResults.map(u => (
                <div key={u.id} style={{ padding: '0.6rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Avatar url={u.avatarUrl} name={u.username} size={28} />
                  <span style={{ fontSize: 13, flex: 1 }}>{u.username}</span>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => startChat(u)}>发消息</button>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: 'var(--accent)' }} onClick={() => handleAddFriend(u)}>+加好友</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 会话列表 */}
        {tab === 'convs' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {convs.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '2rem 1rem' }}>
                还没有会话<br />搜索用户开始聊天
              </div>
            )}
            {convs.map(c => {
              const swiped = swipedConvId === c.userId
              return (
                <div key={c.userId}
                  style={{ position: 'relative', overflow: 'hidden' }}
                  onTouchStart={e => handleConvTouchStart(e, c.userId)}
                  onTouchEnd={e => handleConvTouchEnd(e, c.userId)}
                >
                  {/* 右侧操作按钮（滑出后可见） */}
                  <div style={{
                    position: 'absolute', right: 0, top: 0, bottom: 0,
                    display: 'flex', alignItems: 'stretch',
                    transform: swiped ? 'translateX(0)' : 'translateX(100%)',
                    transition: 'transform 0.22s ease',
                    zIndex: 2,
                  }}>
                    <button
                      onClick={() => handleClearConv(c.userId)}
                      style={{
                        width: 64, border: 'none', cursor: 'pointer',
                        background: '#ff9500', color: '#fff',
                        fontSize: 13, fontWeight: 600,
                      }}
                    >清空</button>
                    <button
                      onClick={() => handleDeleteConv(c.userId)}
                      style={{
                        width: 64, border: 'none', cursor: 'pointer',
                        background: '#e55', color: '#fff',
                        fontSize: 13, fontWeight: 600,
                      }}
                    >删除</button>
                  </div>

                  {/* 会话内容（左滑时整体向左移） */}
                  <div
                    onClick={() => { if (swiped) { setSwipedConvId(null); return } openConv(c) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '0.75rem 1rem', cursor: 'pointer',
                      background: activeUserId === c.userId ? 'var(--surface2)' : '',
                      borderLeft: activeUserId === c.userId ? '2px solid var(--accent)' : '2px solid transparent',
                      transform: swiped ? 'translateX(-128px)' : 'translateX(0)',
                      transition: 'transform 0.22s ease',
                      position: 'relative', zIndex: 1,
                    }}
                    onMouseEnter={e => { if (activeUserId !== c.userId) e.currentTarget.style.background = 'var(--surface2)' }}
                    onMouseLeave={e => { if (activeUserId !== c.userId) e.currentTarget.style.background = '' }}
                  >
                    <Avatar url={c.avatarUrl} name={c.username} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{c.username}</span>
                        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{fmtTime(c.lastAt)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                          {c.lastMessage || '开始对话'}
                        </span>
                        {c.unread > 0 && (
                          <span style={{
                            background: '#e55', color: '#fff', borderRadius: 10,
                            fontSize: 10, fontWeight: 700, padding: '1px 6px', flexShrink: 0,
                          }}>{c.unread > 99 ? '99+' : c.unread}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* 好友列表 */}
        {tab === 'friends' && (
          <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>

            {/* ── 好友详情视图（覆盖列表） ── */}
            {friendDetail && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 10,
                background: 'var(--surface)', display: 'flex', flexDirection: 'column',
              }}>
                {/* 顶部导航 */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '0.7rem 1rem', borderBottom: '1px solid var(--border)',
                }}>
                  <button
                    onClick={() => setFriendDetail(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}
                  >
                    <span style={{ color: 'var(--muted)', fontSize: 26, lineHeight: 1, padding: '0 2px' }}>‹</span>
                    <span style={{ fontSize: 14, color: 'var(--muted)' }}>返回</span>
                  </button>
                  <span style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 15, marginRight: 48 }}>好友详情</span>
                </div>

                {/* 内容区 */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {/* 头像 + 名字 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <Avatar url={friendDetail.avatarUrl} name={friendDetail.username} size={56} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 17 }}>
                        {friendDetail.remark || friendDetail.username}
                      </div>
                      {friendDetail.remark && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>@{friendDetail.username}</div>
                      )}
                    </div>
                  </div>

                  {/* 好友时间 */}
                  {friendDetail.friendSince && (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      成为好友时间：{new Date(friendDetail.friendSince).toLocaleDateString('zh-CN')}
                    </div>
                  )}

                  {/* 备注 */}
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, fontWeight: 600 }}>备注名</div>
                    <input
                      className="input"
                      style={{ width: '100%', boxSizing: 'border-box', fontSize: 16 }}
                      placeholder="给好友设置备注（仅自己可见）"
                      value={remarkInput}
                      onChange={e => setRemarkInput(e.target.value)}
                      maxLength={20}
                    />
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, textAlign: 'right' }}>
                      {remarkInput.length}/20
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button
                      className="btn btn-primary"
                      style={{ flex: 1 }}
                      onClick={handleSaveRemark}
                      disabled={remarkSaving}
                    >
                      {remarkSaving ? '保存中…' : '确认'}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ flex: 1 }}
                      onClick={() => setFriendDetail(null)}
                    >
                      返回
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── 正常列表视图 ── */}
            {/* 好友申请 */}
            {friendRequests.length > 0 && (
              <div>
                <div style={{ padding: '0.5rem 1rem', fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                  好友申请 ({friendRequests.length})
                </div>
                {friendRequests.map(r => (
                  <div key={r.requesterId} style={{ padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '0.6rem', borderBottom: '1px solid var(--border)' }}>
                    <Avatar url={r.avatarUrl} name={r.username} size={30} />
                    <span style={{ fontSize: 13, flex: 1 }}>{r.username}</span>
                    <button className="btn btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => handleAccept(r.requesterId)}>接受</button>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => handleDecline(r.requesterId)}>拒绝</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ padding: '0.5rem 1rem', fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
              我的好友 ({friends.length})
            </div>
            {friends.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '1rem' }}>
                还没有好友，搜索用户添加吧
              </div>
            )}
            {friends.map(f => (
              <div key={f.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.65rem 1rem', position: 'relative',
                  background: activeUserId === f.id ? 'var(--surface2)' : '',
                  borderLeft: activeUserId === f.id ? '2px solid var(--accent)' : '2px solid transparent',
                }}
                onMouseEnter={e => { if (activeUserId !== f.id) e.currentTarget.style.background = 'var(--surface2)' }}
                onMouseLeave={e => { if (activeUserId !== f.id) e.currentTarget.style.background = '' }}
              >
                {/* 点击头像/名字区域进入聊天 */}
                <div onClick={() => startChat(f)} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0, cursor: 'pointer' }}>
                  <Avatar url={f.avatarUrl} name={f.username} size={36} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.remark
                        ? <>{f.username}<span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11, marginLeft: 4 }}>({f.remark})</span></>
                        : f.username
                      }
                    </div>
                  </div>
                </div>

                {/* 操作按钮区 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                  {/* 发消息 → 主色调 */}
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ fontSize: 12, padding: '3px 10px' }}
                    onClick={() => startChat(f)}
                  >发消息</button>

                  {/* 三点菜单 */}
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={() => setFriendMenuId(prev => prev === f.id ? null : f.id)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: '3px 6px', borderRadius: 6, fontSize: 18,
                        color: 'var(--muted)', lineHeight: 1,
                        display: 'flex', alignItems: 'center',
                      }}
                    >···</button>

                    {/* 浮层菜单 */}
                    {friendMenuId === f.id && (
                      <div ref={friendMenuRef} style={{
                        position: 'absolute', right: 0, top: '100%', zIndex: 100,
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 10, minWidth: 100,
                        boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
                        overflow: 'hidden',
                      }}>
                        <button
                          onClick={() => openFriendDetail(f)}
                          style={{
                            display: 'block', width: '100%', padding: '10px 16px',
                            background: 'none', border: 'none', cursor: 'pointer',
                            textAlign: 'left', fontSize: 13, color: 'var(--text)',
                            borderBottom: '1px solid var(--border)',
                          }}
                        >详细</button>
                        <button
                          onClick={() => handleRemoveFriend(f.id)}
                          style={{
                            display: 'block', width: '100%', padding: '10px 16px',
                            background: 'none', border: 'none', cursor: 'pointer',
                            textAlign: 'left', fontSize: 13, color: '#e55',
                          }}
                        >删除好友</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>}

      {/* 右侧：对话区 */}
      {activeUserId && (!isMobile || !!activeUserId) ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 顶部 */}
          <div style={{
            padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            background: 'var(--surface)',
          }}>
            {isMobile ? (
              <button onClick={closeChat}
                style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flex: 1, padding: 0, minWidth: 0 }}>
                <span style={{ color: 'var(--muted)', fontSize: 26, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>‹</span>
                <Avatar url={activeAvatar} name={activeUsername} size={32} />
                <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{activeUsername}</span>
              </button>
            ) : (
              <>
                <Avatar url={activeAvatar} name={activeUsername} size={32} />
                <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{activeUsername}</span>
              </>
            )}
          </div>

          {/* 消息列表 */}
          <div ref={listRef} onScroll={handleListScroll} className="msg-list" style={{ flex: 1, minHeight: 0, overflowY: 'scroll', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', transform: 'translate3d(0,0,0)', willChange: 'scroll-position', touchAction: 'pan-y' }}>
            {loadingMore && <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, padding: '0.25rem' }}>加载更早消息…</div>}
            {!loadingMore && !hasMoreMsgs && messages.length >= MSG_PAGE_SIZE && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 11, padding: '0.25rem' }}>没有更早的消息了</div>
            )}
            {loading && <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>加载中…</div>}
            {!loading && messages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, marginTop: '3rem' }}>
                还没有消息，发送第一条吧
              </div>
            )}
            {messages.map((m, i) => {
              const isMine = m.senderId === myId
              return (
                <div key={m.id ?? i} style={{ display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start' }}>
                  {!isMine && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: 4 }}>
                      <Avatar url={m.senderAvatar} name={m.senderUsername} size={22} />
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{m.senderUsername}</span>
                    </div>
                  )}
                  {m.mediaUrl ? (
                    <div
                      onPointerDown={e => handleBubbleDown(e, m)}
                      onPointerUp={cancelLongPress}
                      onPointerMove={cancelLongPress}
                      onContextMenu={e => openCtxMenu(e, m)}
                      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
                    >
                      <MediaBubble msg={m} isMine={isMine} />
                    </div>
                  ) : (
                    <div
                      onPointerDown={e => handleBubbleDown(e, m)}
                      onPointerUp={cancelLongPress}
                      onPointerMove={cancelLongPress}
                      onContextMenu={e => openCtxMenu(e, m)}
                      style={{
                        maxWidth: isMobile ? '85%' : '65%',
                        padding: '0.5rem 0.85rem',
                        borderRadius: isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                        background: isMine ? 'var(--accent)' : 'var(--surface2)',
                        color: isMine ? '#fff' : 'var(--text)',
                        fontSize: 14, wordBreak: 'break-word', lineHeight: 1.5,
                        userSelect: 'none', WebkitUserSelect: 'none',
                        cursor: 'default',
                      }}
                    >
                      <div className={`msg-md${isMine ? ' msg-md-mine' : ''}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                  <span style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                    {fmtTime(m.createdAt)}
                    {isMine && (
                      m.isRead
                        ? <span style={{ marginLeft: 4, color: 'var(--accent)' }}>已读{m.readAt ? ` ${fmtTime(m.readAt)}` : ''}</span>
                        : <span style={{ marginLeft: 4 }}>已送达</span>
                    )}
                  </span>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {/* 输入区：transform+zIndex 确保在 iOS Safari 上有独立合成层，触摸热区准确 */}
          <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, zIndex: 2, transform: 'translateZ(0)' }}>
            {/* 待发送媒体预览 */}
            {pendingMedia && (
              <div style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                {pendingMedia.type === 'image' ? (
                  <img src={pendingMedia.url} alt="" style={{ height: 48, width: 48, objectFit: 'cover', borderRadius: 4 }} />
                ) : (
                  <span style={{ fontSize: 24 }}>📄</span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingMedia.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtSize(pendingMedia.size)}</div>
                </div>
                <button className="btn btn-ghost btn-sm" style={{ color: '#e55' }} onClick={() => setPendingMedia(null)}>✕</button>
              </div>
            )}

            {/* 文本输入 + 发送（或语音模式） */}
            {voiceMode ? (
              <div style={{ padding: '0.75rem 1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  ref={recBtnRef}
                  onPointerDown={startRecording}
                  onPointerUp={() => stopRecording(false)}
                  onPointerLeave={() => { if (recording) { setRecCancelling(true); stopRecording(true) } }}
                  onPointerCancel={() => stopRecording(true)}
                  style={{
                    flex: 1, height: 48, borderRadius: 24,
                    border: `2px solid ${recCancelling ? '#e55' : recording ? 'var(--accent)' : 'var(--border)'}`,
                    background: recCancelling ? 'rgba(230,80,80,0.12)' : recording ? 'var(--accent)' : 'var(--surface2)',
                    color: recCancelling ? '#e55' : recording ? '#fff' : 'var(--text)',
                    fontSize: 15, fontWeight: 600, cursor: 'pointer',
                    userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
                    transition: 'background 0.15s, border-color 0.15s, color 0.15s',
                  }}
                >
                  {recCancelling ? '松开取消' : recording ? `● ${recSeconds}s  松开发送` : '按住说话'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 20, padding: '2px 6px', flexShrink: 0 }}
                  title="切换到文字输入"
                  onClick={() => setVoiceMode(false)}
                >⌨️</button>
              </div>
            ) : (
              <div style={{ padding: '0.75rem 1rem', display: 'flex', gap: '0.5rem' }}>
                <textarea
                  className="input"
                  style={{ flex: 1, resize: 'none', fontSize: 16, padding: '0.5rem 0.75rem', minHeight: 38, maxHeight: 100 }}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  maxLength={1000}
                  rows={1}
                />
                <button
                  className="btn btn-primary"
                  style={{ alignSelf: 'center' }}
                  onClick={handleSend}
                  disabled={!input.trim() && !pendingMedia}
                >发送</button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 20, padding: '2px 6px', alignSelf: 'center' }}
                  title="发送图片/文件（≤20MB）"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? `${uploadProgress}%` : '📎'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 20, padding: '2px 6px', alignSelf: 'center' }}
                  title="发送语音消息"
                  onClick={() => setVoiceMode(true)}
                >🎤</button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,application/pdf,application/zip,application/x-rar-compressed,.doc,.docx,.xls,.xlsx,.txt"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        !isMobile && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '0.75rem', color: 'var(--muted)' }}>
            <div style={{ fontSize: 40 }}>💬</div>
            <div style={{ fontSize: 14 }}>选择会话或在好友列表中点击发消息</div>
          </div>
        )
      )}

      {/* 消息长按/右键菜单 */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          style={{
            position: 'fixed',
            left: ctxMenu.x,
            top: ctxMenu.y,
            zIndex: 2000,
            background: 'rgba(30,30,40,0.97)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            overflow: 'hidden',
            minWidth: 120,
          }}
        >
          {ctxMenu.msg.content && (
            <button
              onClick={() => handleCtxCopy(ctxMenu.msg.content)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '12px 16px',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text)', fontSize: 14,
                borderBottom: '1px solid rgba(255,255,255,0.07)',
              }}
            >
              <span style={{ fontSize: 16 }}>📋</span> 复制
            </button>
          )}
          <button
            onClick={() => handleCtxDelete(ctxMenu.msg.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              width: '100%', padding: '12px 16px',
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#ff5555', fontSize: 14,
            }}
          >
            <span style={{ fontSize: 16 }}>🗑</span> 删除
          </button>
        </div>
      )}
    </div>
  )
}
