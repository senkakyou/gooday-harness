// =====================================================
// components/forum/MediaEditor.jsx —— 论坛富文本编辑器组件
// 职责：提供 Markdown 文本输入 + 图片/视频上传功能
//       上传成功后自动将 [img:url] 标签插入光标位置
// =====================================================

import React, { useRef, useState } from 'react'
import { uploadMedia } from '../../api/forum'

const MAX_FILES = 10

// 带媒体上传的 Textarea 编辑器，支持一次选择最多 10 个图片/视频
export default function MediaEditor({ value, onChange, placeholder, rows = 5, toast }) {
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, pct: 0 })

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return
    e.target.value = ''

    if (files.length > MAX_FILES) {
      toast?.(`最多一次选择 ${MAX_FILES} 个文件`, true)
      return
    }

    setUploading(true)
    setProgress({ current: 0, total: files.length, pct: 0 })

    let appended = ''
    for (let i = 0; i < files.length; i++) {
      try {
        setProgress({ current: i + 1, total: files.length, pct: 0 })
        const r = await uploadMedia(files[i], p => setProgress(prev => ({ ...prev, pct: p })))
        const tag = r.data.type === 'image'
          ? `[img:${r.data.url}]`
          : `[video:${r.data.url}]`
        appended += tag + '\n'
      } catch (err) {
        toast?.(`第 ${i + 1} 个文件上传失败: ${err.message || '未知错误'}`, true)
      }
    }

    if (appended) {
      onChange(value + (value && !value.endsWith('\n') ? '\n' : '') + appended)
      toast?.(`${files.length > 1 ? `${files.length} 个文件` : '文件'}上传成功`)
    }

    setUploading(false)
    setProgress({ current: 0, total: 0, pct: 0 })
  }

  const uploadLabel = uploading
    ? `上传中 ${progress.current}/${progress.total} (${progress.pct}%)`
    : `📎 图片/视频（最多${MAX_FILES}个）`

  return (
    <div>
      <textarea
        className="input"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.4rem' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          style={{ fontSize: 12 }}
        >
          {uploadLabel}
        </button>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          图片≤30MB · 视频≤300MB · 支持 jpg/png/gif/webp/mp4/webm · 一次最多{MAX_FILES}个
        </span>
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  )
}
