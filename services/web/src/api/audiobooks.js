// =====================================================
// api/audiobooks.js —— 听书接口
// 公开浏览 + 登录用户续播/书架 + admin 管理（书/章节/上传）
// =====================================================

import client from './client'

// ---- 公开 ----
export const listBooks      = (params) => client.get('/audiobooks', { params }).then(r => r.data)
export const getBook        = (id)     => client.get(`/audiobooks/${id}`).then(r => r.data)
export const playBook       = (id)     => client.post(`/audiobooks/${id}/play`).then(r => r.data)

// ---- 登录用户：续播进度 / 书架 ----
export const saveProgress   = (data)   => client.post('/audiobooks/progress', data).then(r => r.data)
export const getBookProgress= (id)     => client.get(`/audiobooks/${id}/progress`).then(r => r.data)
export const getShelf       = ()       => client.get('/audiobooks/shelf').then(r => r.data)

// ---- admin 管理 ----
export const createBook     = (data)   => client.post('/audiobooks', data).then(r => r.data)
export const updateBook     = (id, d)  => client.put(`/audiobooks/${id}`, d).then(r => r.data)
export const deleteBook     = (id)     => client.delete(`/audiobooks/${id}`).then(r => r.data)
export const addChapter     = (id, d)  => client.post(`/audiobooks/${id}/chapters`, d).then(r => r.data)
export const updateChapter  = (cid, d) => client.put(`/audiobooks/chapters/${cid}`, d).then(r => r.data)
export const deleteChapter  = (cid)    => client.delete(`/audiobooks/chapters/${cid}`).then(r => r.data)
export const uploadMedia    = (formData) =>
  client.post('/audiobooks/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)

// ---- 文字版(EPUB) 阅读进度 ----
export const saveReadProgress = (data) => client.post('/audiobooks/read-progress', data).then(r => r.data)
export const getReadProgress  = (id)   => client.get(`/audiobooks/${id}/read-progress`).then(r => r.data)
export const getReadShelf     = ()     => client.get('/audiobooks/read-shelf').then(r => r.data)
