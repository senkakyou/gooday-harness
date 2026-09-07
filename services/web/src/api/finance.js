// =====================================================
// api/finance.js —— 财务记录相关接口
// =====================================================

import client from './client'

// 财务记录列表：GET /api/finance?type=&paymentStatus=&period=&page=&pageSize=
export const listFinance = (params = {}) =>
  client.get('/finance', { params }).then(r => r.data)

// 创建记录：POST /api/finance
export const createFinance = (data) =>
  client.post('/finance', data).then(r => r.data)

// 更新记录：PUT /api/finance/:id
export const updateFinance = (id, data) =>
  client.put(`/finance/${id}`, data).then(r => r.data)

// 删除记录：DELETE /api/finance/:id
export const deleteFinance = (id) =>
  client.delete(`/finance/${id}`).then(r => r.data)

// 年度总览：GET /api/finance/overview?year=
export const getFinanceOverview = (year) =>
  client.get('/finance/overview', { params: year ? { year } : {} }).then(r => r.data)

// 月报（灵犀用）：GET /api/finance/monthly-report?period=
export const getMonthlyReport = (period) =>
  client.get('/finance/monthly-report', { params: period ? { period } : {} }).then(r => r.data)
