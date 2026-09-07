// 私信消息气泡：图片 / 文件 / 音频 三种媒体类型
import React, { useRef, useState } from 'react'
import { fmtSize } from './helpers'

function AudioBubble({ msg, isMine }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [showText, setShowText] = useState(false)

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) { a.pause() } else { a.play() }
  }

  const fmtDur = (s) => {
    if (!s || isNaN(s)) return '0:00'
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  }

  const progress = duration > 0 ? currentTime / duration : 0
  const hasTranscript = !!msg.content

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start', gap: 4 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0.55rem 0.85rem',
        borderRadius: isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        background: isMine ? 'var(--accent)' : 'var(--surface2)',
        color: isMine ? '#fff' : 'var(--text)',
        minWidth: 140, maxWidth: 220, cursor: 'pointer',
      }} onClick={toggle}>
        <audio
          ref={audioRef}
          src={msg.mediaUrl}
          onLoadedMetadata={e => setDuration(e.target.duration)}
          onTimeUpdate={e => setCurrentTime(e.target.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setCurrentTime(0) }}
        />
        <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>
          {playing ? '⏸' : '▶'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            height: 3, borderRadius: 2,
            background: isMine ? 'rgba(255,255,255,0.3)' : 'var(--border)',
            marginBottom: 4,
          }}>
            <div style={{
              height: '100%', borderRadius: 2,
              background: isMine ? 'rgba(255,255,255,0.85)' : 'var(--accent)',
              width: `${progress * 100}%`,
              transition: 'width 0.2s linear',
            }} />
          </div>
          <div style={{ fontSize: 11, opacity: 0.8 }}>
            {fmtDur(playing ? currentTime : duration)}
          </div>
        </div>
        {/* 转文字按钮 */}
        {hasTranscript && (
          <button
            onClick={e => { e.stopPropagation(); setShowText(v => !v) }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, padding: '2px 4px', borderRadius: 4, flexShrink: 0,
              color: isMine ? 'rgba(255,255,255,0.8)' : 'var(--muted)',
              textDecoration: 'underline',
            }}
          >转文字</button>
        )}
      </div>
      {/* 展开的文字内容 */}
      {hasTranscript && showText && (
        <div style={{
          maxWidth: 260, padding: '0.5rem 0.85rem', borderRadius: 10,
          background: isMine ? 'rgba(var(--accent-rgb,99,102,241),0.12)' : 'var(--surface)',
          border: '1px solid var(--border)',
          fontSize: 14, color: 'var(--text)', lineHeight: 1.55, wordBreak: 'break-all',
        }}>
          {msg.content}
        </div>
      )}
    </div>
  )
}

export default function MediaBubble({ msg, isMine }) {
  if (msg.mediaType === 'audio') {
    return <AudioBubble msg={msg} isMine={isMine} />
  }
  if (msg.mediaType === 'image' || msg.mediaType?.startsWith('image/')) {
    return (
      <div style={{ maxWidth: 260 }}>
        {msg.content && (
          <div style={{
            padding: '0.5rem 0.85rem', marginBottom: 4,
            borderRadius: isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
            background: isMine ? 'var(--accent)' : 'var(--surface2)',
            color: isMine ? '#fff' : 'var(--text)', fontSize: 14, wordBreak: 'break-word',
          }}>{msg.content}</div>
        )}
        <img
          src={msg.mediaUrl}
          alt={msg.mediaName || '图片'}
          style={{ maxWidth: 260, maxHeight: 300, borderRadius: 8, cursor: 'pointer', display: 'block' }}
          onClick={() => window.open(msg.mediaUrl, '_blank')}
          onError={e => { e.target.style.display = 'none' }}
        />
      </div>
    )
  }
  if (msg.mediaType === 'file') {
    return (
      <div>
        {msg.content && (
          <div style={{
            padding: '0.5rem 0.85rem', marginBottom: 4,
            borderRadius: isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
            background: isMine ? 'var(--accent)' : 'var(--surface2)',
            color: isMine ? '#fff' : 'var(--text)', fontSize: 14, wordBreak: 'break-word',
          }}>{msg.content}</div>
        )}
        <a
          href={msg.mediaUrl}
          download={msg.mediaName}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.6rem 0.9rem', borderRadius: 8, textDecoration: 'none',
            background: isMine ? 'rgba(255,255,255,0.15)' : 'var(--surface2)',
            color: isMine ? '#fff' : 'var(--text)', border: `1px solid ${isMine ? 'rgba(255,255,255,0.3)' : 'var(--border)'}`,
            maxWidth: 260,
          }}
        >
          <span style={{ fontSize: 20 }}>📄</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {msg.mediaName || '文件'}
            </div>
            {msg.mediaSize && <div style={{ fontSize: 11, opacity: 0.7 }}>{fmtSize(msg.mediaSize)}</div>}
          </div>
        </a>
      </div>
    )
  }
  return null
}
