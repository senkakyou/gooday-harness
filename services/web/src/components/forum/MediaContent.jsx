// =====================================================
// components/forum/MediaContent.jsx —— 论坛内容渲染组件
// 职责：将帖子/回复内容渲染为 Markdown（含 GFM 语法），
//       并解析 [img:url] / [video:url] 自定义标签为内嵌媒体
// =====================================================

import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const MEDIA_TAG_RE = /\[(img|video):([^\]]+)\]/g

function isMarkdown(content) {
  return /^#{1,6} /m.test(content)
}

function hasMediaTags(content) {
  MEDIA_TAG_RE.lastIndex = 0
  const result = MEDIA_TAG_RE.test(content)
  MEDIA_TAG_RE.lastIndex = 0
  return result
}

function renderMediaParts(content) {
  const parts = []
  let last = 0
  let m
  MEDIA_TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(content)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: content.slice(last, m.index) })
    parts.push({ type: m[1], url: m[2].trim() })
    last = m.index + m[0].length
  }
  if (last < content.length) parts.push({ type: 'text', value: content.slice(last) })
  return parts
}

const TAG_RE = /\[(img|video):([^\]]+)\]/g

const mdComponents = {
  h1: ({ children }) => <h1 style={{ fontSize: '1.3em', fontWeight: 700, margin: '1.2em 0 0.5em', borderBottom: '2px solid var(--accent)', paddingBottom: '0.25em' }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ fontSize: '1.1em', fontWeight: 700, margin: '1.1em 0 0.4em', color: 'var(--accent)' }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ fontSize: '1em', fontWeight: 700, margin: '0.9em 0 0.35em' }}>{children}</h3>,
  h4: ({ children }) => <h4 style={{ fontSize: '0.95em', fontWeight: 600, margin: '0.8em 0 0.3em' }}>{children}</h4>,
  p: ({ children }) => <p style={{ margin: '0.5em 0', lineHeight: 1.8 }}>{children}</p>,
  strong: ({ children }) => <strong style={{ fontWeight: 700, color: 'var(--fg)' }}>{children}</strong>,
  em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
  ul: ({ children }) => <ul style={{ paddingLeft: '1.5em', margin: '0.4em 0', listStyleType: 'disc' }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ paddingLeft: '1.5em', margin: '0.4em 0' }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '0.25em 0', lineHeight: 1.7 }}>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote style={{ borderLeft: '4px solid var(--accent)', margin: '0.75em 0', padding: '0.4em 1em', background: 'var(--surface2)', borderRadius: '0 4px 4px 0', color: 'var(--fg2)' }}>
      {children}
    </blockquote>
  ),
  code: ({ inline, children }) => inline
    ? <code style={{ background: 'var(--surface2)', padding: '0.1em 0.35em', borderRadius: 3, fontFamily: 'monospace', fontSize: '0.88em', color: '#e06c75' }}>{children}</code>
    : <code>{children}</code>,
  pre: ({ children }) => (
    <pre style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.9em 1em', overflowX: 'auto', margin: '0.75em 0', fontFamily: '"Courier New", Courier, monospace', fontSize: '0.85em', lineHeight: 1.6, whiteSpace: 'pre', wordBreak: 'break-all' }}>
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '0.75em 0' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9em' }}>{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead style={{ background: 'var(--surface2)' }}>{children}</thead>,
  th: ({ children }) => <th style={{ border: '1px solid var(--border)', padding: '0.45em 0.75em', fontWeight: 700, textAlign: 'left' }}>{children}</th>,
  td: ({ children }) => <td style={{ border: '1px solid var(--border)', padding: '0.4em 0.75em' }}>{children}</td>,
  tr: ({ children }) => <tr>{children}</tr>,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '1.25em 0' }} />,
  img: ({ src, alt }) => (
    <div style={{ margin: '0.75em 0' }}>
      <img src={src} alt={alt || '图片'} style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 6, display: 'block', cursor: 'pointer' }}
        onClick={() => window.open(src, '_blank')} onError={e => { e.target.style.display = 'none' }} />
    </div>
  ),
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{children}</a>,
}

export default function MediaContent({ content, style }) {
  if (!content) return null

  // Markdown 模式也要支持媒体标签：原来这里直接 return，[img:]/[video:] 被静默丢掉，
  // 于是"带小标题的长文 + 配图/视频"这种帖子永远显示不出媒体（2026-08-14 发技术长文时发现）。
  // 做法：[img:x] 直接转成 Markdown 图片语法交给上面的 img 组件；
  //      [video:x] 没有 Markdown 语法，按它切段，段与段之间插 <video>。
  if (isMarkdown(content)) {
    const withImg = content.replace(/\[img:([^\]]+)\]/g, (_, u) => `\n\n![](${u.trim()})\n\n`)
    const chunks = withImg.split(/\[video:([^\]]+)\]/g)
    return (
      <div style={{ ...style, lineHeight: 1.75 }}>
        {chunks.map((chunk, i) => (
          i % 2 === 1
            ? <div key={i} style={{ margin: '0.75em 0' }}>
                <video src={chunk.trim()} controls playsInline preload="metadata"
                  style={{ maxWidth: '100%', maxHeight: 420, borderRadius: 6, display: 'block', background: '#000' }} />
              </div>
            : (chunk.trim()
                ? <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={mdComponents}>{chunk}</ReactMarkdown>
                : null)
        ))}
      </div>
    )
  }

  if (hasMediaTags(content)) {
    const parts = []
    let last = 0
    let m
    TAG_RE.lastIndex = 0
    while ((m = TAG_RE.exec(content)) !== null) {
      if (m.index > last) parts.push({ type: 'text', value: content.slice(last, m.index) })
      parts.push({ type: m[1], url: m[2].trim() })
      last = m.index + m[0].length
    }
    if (last < content.length) parts.push({ type: 'text', value: content.slice(last) })

    return (
      <div style={style}>
        {parts.map((p, i) => {
          if (p.type === 'text') return <span key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{p.value}</span>
          if (p.type === 'img') return (
            <div key={i} style={{ margin: '0.5rem 0' }}>
              <img src={p.url} alt="图片" style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 6, cursor: 'pointer', display: 'block' }}
                onClick={() => window.open(p.url, '_blank')} onError={e => { e.target.style.display = 'none' }} />
            </div>
          )
          if (p.type === 'video') return (
            <div key={i} style={{ margin: '0.5rem 0' }}>
              <video src={p.url} controls style={{ maxWidth: '100%', maxHeight: 400, borderRadius: 6, display: 'block', background: '#000' }} />
            </div>
          )
          return null
        })}
      </div>
    )
  }

  return (
    <div style={style}>
      <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</span>
    </div>
  )
}
