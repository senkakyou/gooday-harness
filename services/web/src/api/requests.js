// =====================================================
// api/requests.js —— 定制需求相关接口
// 职责：用户提交需求；管理员查列表、改状态、删除
// =====================================================

import client from './client'

// 提交定制需求（公开接口，不需要登录）：POST /api/requests
export const submitRequest = (data) =>
  client.post('/requests', data).then(r => r.data)

// 上传需求附件（公开，可选）：POST /api/requests/upload
export const uploadRequestFile = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return client.post('/requests/upload', fd).then(r => r.data)
}

// 管理员查需求列表：GET /api/requests?status=pending（status 可不传返回全部）
export const listRequests = (status) =>
  client.get('/requests', { params: status ? { status } : {} }).then(r => r.data)

// 需求统计数据（给后台概览用）：GET /api/requests/stats
export const getRequestStats = () =>
  client.get('/requests/stats').then(r => r.data)

// 管理员更新需求状态和备注：PUT /api/requests/:id
export const updateRequest = (id, data) =>
  client.put(`/requests/${id}`, data).then(r => r.data)

// 管理员删除需求：DELETE /api/requests/:id
export const deleteRequest = (id) =>
  client.delete(`/requests/${id}`).then(r => r.data)

// 用户查自己的需求列表：GET /api/requests/mine
export const myRequests = () =>
  client.get('/requests/mine').then(r => r.data)

// 用户编辑自己的 pending 需求：PUT /api/requests/mine/:id
export const updateMyRequest = (id, data) =>
  client.put(`/requests/mine/${id}`, data).then(r => r.data)

// 用户删除自己的 pending 需求：DELETE /api/requests/mine/:id
export const deleteMyRequest = (id) =>
  client.delete(`/requests/mine/${id}`).then(r => r.data)
