// =====================================================
// pages/admin/Upload.jsx —— 文件上传页
// 职责：支持拖拽或点击选择文件上传到服务器 /uploads/ 目录
//       显示实时上传进度条，上传完显示文件名（用于填写工具下载文件名）
// 路由：/admin/upload
// =====================================================

import React, { useRef, useState } from 'react'
import { uploadFile } from '../../api/admin'
import useToastStore from '../../store/toastStore'

export default function Upload() {
  const toast = useToastStore(s => s.toast)
  const inputRef = useRef(null)      // 引用隐藏的 file input 元素，用于触发点击
  const [progress, setProgress] = useState(null)  // 上传进度 0-100，null 表示没在上传
  const [result, setResult] = useState('')         // 上传结果文字

  // 处理文件（点击选择或拖拽放入都走这里）
  const handleFile = async (file) => {
    if (!file) return
    setResult('')
    setProgress(0)
    try {
      // 第二个参数是目标目录（这里不指定，落 uploads 根），第三个是进度回调
      const data = await uploadFile(file, null, p => setProgress(p))
      // 显示的是相对 uploads 的完整路径——工具的下载文件名字段要填的就是它。
      // （原先取的是 data.filename，后端返回的字段是 fileName，一直显示 undefined）
      setResult(`✅ 上传成功：${data.path}`)
      toast('上传成功')
    } catch (e) {
      setResult(`❌ ${e.message}`)
      toast(e.message, true)
    } finally {
      setProgress(null)  // 上传完（成功或失败）都隐藏进度条
    }
  }

  return (
    <>
      <h2 style={{ fontFamily: 'var(--mono)', fontSize: '0.9rem', marginBottom: '1.25rem', paddingBottom: '0.6rem', borderBottom: '1px solid var(--border)' }}>文件上传</h2>

      {/* 拖拽区域 */}
      <div
        style={{ background: 'var(--surface2)', border: '2px dashed var(--border)', borderRadius: 6, padding: '2.5rem', textAlign: 'center', cursor: 'pointer' }}
        onClick={() => inputRef.current?.click()}  // 点击区域触发 file input
        onDragOver={e => e.preventDefault()}        // 必须阻止默认行为，否则 onDrop 不生效
        onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}  // 拖拽放入
      >
        <div style={{ fontSize: '2.5rem', marginBottom: '0.875rem' }}>📁</div>
        <p style={{ color: 'var(--muted)', marginBottom: '1.25rem', fontSize: 13 }}>
          支持 .py .html .zip，最大100MB<br />
          点击选择或拖拽文件到此处
        </p>
        <button className="btn btn-primary" onClick={e => { e.stopPropagation(); inputRef.current?.click() }}>选择文件</button>
        {/* 真正的 file input 隐藏，由上面的 div/button 触发 */}
        <input ref={inputRef} type="file" style={{ display: 'none' }} accept=".py,.html,.zip" onChange={e => handleFile(e.target.files[0])} />
      </div>

      {/* 进度条（只在上传中显示） */}
      {progress !== null && (
        <div style={{ marginTop: '0.875rem' }}>
          <div style={{ background: 'var(--surface2)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
            {/* 进度条宽度由 progress 百分比驱动，transition 让变化平滑 */}
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', transition: 'width .2s' }} />
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{progress}%</div>
        </div>
      )}

      {/* 上传结果（成功或失败的文字提示） */}
      {result && (
        <div style={{ marginTop: '0.875rem', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--accent2)' }}>{result}</div>
      )}
    </>
  )
}
