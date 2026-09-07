// =====================================================
// api/forum.js —— 社区论坛相关接口
// 职责：分类、帖子列表、帖子详情、发帖、回复、编辑、删除、点赞、媒体上传
// =====================================================

import client from './client'

// 获取所有论坛分类：GET /api/forum/categories
export const getCategories = () => client.get('/forum/categories')

// 获取某分类下的帖子列表（分页）：GET /api/forum/categories/:slug/threads?page=N
export const getThreads = (slug, page = 1) => client.get(`/forum/categories/${slug}/threads`, { params: { page } })

// 获取帖子详情（含回复列表，分页）：GET /api/forum/threads/:id?page=N
export const getThread = (id, page = 1) => client.get(`/forum/threads/${id}`, { params: { page } })

// 发布新帖子：POST /api/forum/threads
// data: { title, content, categoryId }
export const createThread = (data) => client.post('/forum/threads', data)

// 回复帖子：POST /api/forum/threads/:threadId/posts
export const reply = (threadId, content) => client.post(`/forum/threads/${threadId}/posts`, { content })

// 编辑帖子/回复内容：PUT /api/forum/posts/:postId（只有作者本人可改）
export const editPost = (postId, content) => client.put(`/forum/posts/${postId}`, { content })

// 删除回复：DELETE /api/forum/posts/:postId
export const deletePost = (postId) => client.delete(`/forum/posts/${postId}`)

// 删除整个帖子（含所有回复）：DELETE /api/forum/threads/:threadId
export const deleteThread = (threadId) => client.delete(`/forum/threads/${threadId}`)

// 点赞 / 取消点赞（切换）：POST /api/forum/posts/:postId/like
export const toggleLike = (postId) => client.post(`/forum/posts/${postId}/like`)

// ---- 管理员专用接口 ----

// 置顶 / 取消置顶帖子（切换）：PUT /api/forum/threads/:threadId/pin
export const togglePin = (threadId) => client.put(`/forum/threads/${threadId}/pin`)

// 锁定 / 解锁帖子（锁定后无法回复）：PUT /api/forum/threads/:threadId/lock
export const toggleLock = (threadId) => client.put(`/forum/threads/${threadId}/lock`)

// 管理员获取所有分类（含隐藏分类）：GET /api/forum/admin/categories
export const adminGetCategories = () => client.get('/forum/admin/categories')

// 管理员创建论坛分类：POST /api/forum/admin/categories
export const adminCreateCategory = (data) => client.post('/forum/admin/categories', data)

// 管理员更新分类信息：PUT /api/forum/admin/categories/:id
export const adminUpdateCategory = (id, data) => client.put(`/forum/admin/categories/${id}`, data)

// 管理员删除分类：DELETE /api/forum/admin/categories/:id
export const adminDeleteCategory = (id) => client.delete(`/forum/admin/categories/${id}`)

// 管理员分页查询帖子：GET /api/forum/admin/threads?categoryId=N&page=N
export const adminGetThreads = (categoryId, page) => client.get('/forum/admin/threads', { params: { categoryId, page } })

// 上传论坛媒体（图片等）：POST /api/forum/upload（multipart/form-data）
// onProgress(0-100)：上传进度回调，用于编辑器进度提示
export const uploadMedia = (file, onProgress) => {
  const form = new FormData()
  form.append('file', file)
  return client.post('/forum/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: e => onProgress?.(Math.round(e.loaded * 100 / e.total)),
  })
}
