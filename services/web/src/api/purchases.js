// =====================================================
// api/purchases.js —— 付费工具购买相关接口
// 职责：检查购买状态、提交付款、管理员激活/拒绝
// =====================================================

import client from './client'

// 检查当前用户是否已购买某工具：GET /api/purchases/check/:toolId
// 返回 { activated: true/false }
export const checkPurchase = (toolId) =>
  client.get(`/purchases/check/${toolId}`).then(r => r.data)

// 查询当前用户所有购买记录：GET /api/purchases/my
export const myPurchases = () =>
  client.get('/purchases/my').then(r => r.data)

// 用户点「我已付款」后提交购买记录：POST /api/purchases
// 后端会创建一条 status=pending 的记录，等管理员手动激活
export const submitPurchase = (toolId) =>
  client.post('/purchases', { toolId }).then(r => r.data)

// 管理员查购买列表：GET /api/purchases?status=pending（status 可不传）
export const listPurchases = (status) =>
  client.get('/purchases', { params: status ? { status } : {} }).then(r => r.data)

// 购买统计（给后台概览用）：GET /api/purchases/stats
export const getPurchaseStats = () =>
  client.get('/purchases/stats').then(r => r.data)

// 管理员确认收款，激活购买（用户之后就能下载了）：PUT /api/purchases/:id/activate
export const activatePurchase = (id) =>
  client.put(`/purchases/${id}/activate`, { note: '已确认收款' }).then(r => r.data)

// 管理员拒绝购买：PUT /api/purchases/:id/reject
export const rejectPurchase = (id) =>
  client.put(`/purchases/${id}/reject`, { note: '已拒绝' }).then(r => r.data)

// 用户取消自己的 pending 购买申请：DELETE /api/purchases/mine/:id
export const cancelMyPurchase = (id) =>
  client.delete(`/purchases/mine/${id}`).then(r => r.data)
