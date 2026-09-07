// =====================================================
// api/clients.js —— 客户档案相关接口
// 职责：客户档案 CRUD、upsert、AI 画像、统计
// =====================================================

import client from './client'

// 客户列表：GET /api/clients?status=&q=&page=&pageSize=
export const listClients = (params = {}) =>
  client.get('/clients', { params }).then(r => r.data)

// 客户详情（含工单历史）：GET /api/clients/:id
export const getClient = (id) =>
  client.get(`/clients/${id}`).then(r => r.data)

// 创建客户：POST /api/clients
export const createClient = (data) =>
  client.post('/clients', data).then(r => r.data)

// 更新客户：PUT /api/clients/:id
export const updateClient = (id, data) =>
  client.put(`/clients/${id}`, data).then(r => r.data)

// 删除客户：DELETE /api/clients/:id
export const deleteClient = (id) =>
  client.delete(`/clients/${id}`).then(r => r.data)

// 客户概览统计：GET /api/clients/stats
export const getClientStats = () =>
  client.get('/clients/stats').then(r => r.data)
