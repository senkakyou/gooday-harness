// =====================================================
// api/projects.js —— 项目档案接口
// 职责：管理员查项目、创建、更新、工单转项目；决策日志
// =====================================================

import client from './client'

// 项目列表：GET /api/projects?status=&page=&pageSize=
export const listProjects = (params = {}) =>
  client.get('/projects', { params }).then(r => r.data)

// 项目详情（含决策日志）：GET /api/projects/:id
export const getProject = (id) =>
  client.get(`/projects/${id}`).then(r => r.data)

// 创建项目：POST /api/projects
export const createProject = (data) =>
  client.post('/projects', data).then(r => r.data)

// 工单转项目：POST /api/projects/from-ticket/:ticketId
export const projectFromTicket = (ticketId) =>
  client.post(`/projects/from-ticket/${ticketId}`).then(r => r.data)

// 更新项目：PUT /api/projects/:id
export const updateProject = (id, data) =>
  client.put(`/projects/${id}`, data).then(r => r.data)

// 删除项目：DELETE /api/projects/:id
export const deleteProject = (id) =>
  client.delete(`/projects/${id}`).then(r => r.data)

// 项目统计：GET /api/projects/stats
export const getProjectStats = () =>
  client.get('/projects/stats').then(r => r.data)

// 决策日志列表：GET /api/decisions?projectId=&ticketId=
export const listDecisions = (params = {}) =>
  client.get('/decisions', { params }).then(r => r.data)

// 创建决策：POST /api/decisions
export const createDecision = (data) =>
  client.post('/decisions', data).then(r => r.data)

// 更新决策结果：PUT /api/decisions/:id/outcome
export const updateDecisionOutcome = (id, outcome) =>
  client.put(`/decisions/${id}/outcome`, outcome).then(r => r.data)

// 删除决策：DELETE /api/decisions/:id
export const deleteDecision = (id) =>
  client.delete(`/decisions/${id}`).then(r => r.data)

// ---- 子任务 ----
// 列表：GET /api/projects/:id/tasks
export const listTasks = (projectId) =>
  client.get(`/projects/${projectId}/tasks`).then(r => r.data)

// 创建：POST /api/projects/:id/tasks
export const createTask = (projectId, data) =>
  client.post(`/projects/${projectId}/tasks`, data).then(r => r.data)

// 更新：PUT /api/projects/:id/tasks/:taskId
export const updateTask = (projectId, taskId, data) =>
  client.put(`/projects/${projectId}/tasks/${taskId}`, data).then(r => r.data)

// 删除：DELETE /api/projects/:id/tasks/:taskId
export const deleteTask = (projectId, taskId) =>
  client.delete(`/projects/${projectId}/tasks/${taskId}`).then(r => r.data)
