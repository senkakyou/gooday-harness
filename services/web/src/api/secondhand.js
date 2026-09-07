// =====================================================
// api/secondhand.js —— 二手交易相关接口
// 职责：闲置物品列表查询、详情、发布、编辑、删除、标记已售、图片上传
// =====================================================

import client from './client'

// 获取闲置物品列表：GET /api/secondhand（params 可含 category、keyword 等）
export const listItems = (params) => client.get('/secondhand', { params })

// 获取单个物品详情：GET /api/secondhand/:id
export const getItem = (id) => client.get(`/secondhand/${id}`)

// 发布新闲置物品：POST /api/secondhand
export const createItem = (data) => client.post('/secondhand', data)

// 更新物品信息：PUT /api/secondhand/:id（只有发布者本人可修改）
export const updateItem = (id, data) => client.put(`/secondhand/${id}`, data)

// 删除物品：DELETE /api/secondhand/:id
export const deleteItem = (id) => client.delete(`/secondhand/${id}`)

// 标记物品已售出（自动下架）：POST /api/secondhand/:id/sold
export const markSold = (id) => client.post(`/secondhand/${id}/sold`)

// 上传物品图片：POST /api/secondhand/upload（multipart/form-data）
// onProgress(0-100)：上传进度回调
export const uploadImage = (file, onProgress) => {
  const form = new FormData()
  form.append('file', file)
  return client.post('/secondhand/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: e => onProgress?.(Math.round(e.loaded * 100 / e.total)),
  })
}

// ---- 收藏（仅存本地浏览器，无需后端）----
const FAV_KEY = 'sh_favorites'
export const getFavorites = () => {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]') } catch { return [] }
}
export const isFavorite = (id) => getFavorites().includes(id)
export const toggleFavorite = (id) => {
  const f = getFavorites()
  const i = f.indexOf(id)
  if (i >= 0) f.splice(i, 1); else f.push(id)
  localStorage.setItem(FAV_KEY, JSON.stringify(f))
  return f.includes(id)
}
