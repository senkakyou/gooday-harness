// =====================================================
// api/tickets.js —— 工单相关接口
// 职责：管理员查工单、创建、更新状态/报价、删除；日报数据
// =====================================================

import client from './client'

// 工单列表：GET /api/tickets?status=&priority=&source=&page=&pageSize=
export const listTickets = (params = {}) =>
  client.get('/tickets', { params }).then(r => r.data)

// 工单详情：GET /api/tickets/:id
export const getTicket = (id) =>
  client.get(`/tickets/${id}`).then(r => r.data)

// 创建工单：POST /api/tickets
export const createTicket = (data) =>
  client.post('/tickets', data).then(r => r.data)

// 更新工单：PUT /api/tickets/:id
export const updateTicket = (id, data) =>
  client.put(`/tickets/${id}`, data).then(r => r.data)

// 删除工单：DELETE /api/tickets/:id
export const deleteTicket = (id) =>
  client.delete(`/tickets/${id}`).then(r => r.data)

// 工单统计：GET /api/tickets/stats
export const getTicketStats = () =>
  client.get('/tickets/stats').then(r => r.data)

// 日报数据（灵犀用）：GET /api/tickets/daily-report
export const getTicketDailyReport = () =>
  client.get('/tickets/daily-report').then(r => r.data)
