// =====================================================
// api/tickets.js —— 订单接口（对客称「订单」，后端路由仍是 /tickets）
//
// 【改状态只有 transition 一个入口】。updateTicket 只改内容，
// 传 status 给它是无效的——后端已经把这两件事拆开了。
// =====================================================

import client from './client'

// ---- 公开：需求表单提交（不需要登录，未注册访客唯一入口）----
// 【没有 budget 字段】：如意与前台全程不谈钱，金额由大海与客户确认后填。
export const submitIntake = (data) =>
  client.post('/tickets/intake', data).then(r => r.data)

export const uploadIntakeFile = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return client.post('/tickets/intake/upload', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}

// ---- 后台 ----
export const listTickets = (params = {}) =>
  client.get('/tickets', { params }).then(r => r.data)

export const getTicket = (id) =>
  client.get(`/tickets/${id}`).then(r => r.data)

// 订单工作记录时间线：GET /api/tickets/:id/log
export const getTicketLog = (id) =>
  client.get(`/tickets/${id}/log`).then(r => r.data)

export const createTicket = (data) =>
  client.post('/tickets', data).then(r => r.data)

// 只改内容（标题/需求/客户/金额/备注），【改不了状态】
export const updateTicket = (id, data) =>
  client.put(`/tickets/${id}`, data).then(r => r.data)

// 改状态的唯一入口：POST /api/tickets/:id/transition
//   event: start | release | close | rework | block | unblock | cancel
//   reason: 进 BLOCKED 时必填
export const transitionTicket = (id, event, reason) =>
  client.post(`/tickets/${id}/transition`, { event, reason }).then(r => r.data)

export const deleteTicket = (id) =>
  client.delete(`/tickets/${id}`).then(r => r.data)

export const getTicketStats = () =>
  client.get('/tickets/stats').then(r => r.data)

export const getTicketDailyReport = () =>
  client.get('/tickets/daily-report').then(r => r.data)
