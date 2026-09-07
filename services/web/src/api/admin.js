// =====================================================
// api/admin.js —— 后台管理专用接口
// 职责：统计数据、工具增删改、用户管理、文件上传
// 所有接口后端都要求 admin 角色（token 会自动带上）
// =====================================================

import client from './client'

// 后台统计数据（用户数、工具数、下载量等）：GET /api/admin/stats
export const getStats = () =>
  client.get('/admin/stats').then(r => r.data)

// 实时系统状态（CPU/内存/在线）：GET /api/admin/system
export const getSystem = () =>
  client.get('/admin/system').then(r => r.data)

// 工具列表（管理员版，返回全部字段包括未发布的）：GET /api/admin/tools
export const listAdminTools = () =>
  client.get('/admin/tools').then(r => r.data)

// 新增工具：POST /api/admin/tools
export const createTool = (data) =>
  client.post('/admin/tools', data).then(r => r.data)

// 修改工具：PUT /api/admin/tools/:id
export const updateTool = (id, data) =>
  client.put(`/admin/tools/${id}`, data).then(r => r.data)

// 删除工具：DELETE /api/admin/tools/:id
export const deleteTool = (id) =>
  client.delete(`/admin/tools/${id}`).then(r => r.data)

// 用户列表：GET /api/admin/users
export const listUsers = () =>
  client.get('/admin/users').then(r => r.data)

// 启用/禁用用户（一个接口切换，后端自己判断当前状态取反）：PUT /api/admin/users/:id/toggle
export const toggleUser = (id) =>
  client.put(`/admin/users/${id}/toggle`).then(r => r.data)

// 文件上传：POST /api/admin/upload（multipart/form-data 格式）
// onProgress 是回调函数，上传过程中实时更新进度（0-100）
export const uploadFile = (file, onProgress) => {
  const fd = new FormData()   // FormData 是浏览器原生对象，专门用于文件上传
  fd.append('file', file)
  return client.post('/admin/upload', fd, {
    // e.loaded 是已上传字节数，e.total 是总字节数，算出百分比
    onUploadProgress: e => onProgress && onProgress(Math.round((e.loaded * 100) / e.total)),
  }).then(r => r.data)
}

// 文件管理：GET /api/admin/files —— 返回 { files: [...], dirs: [...] }
export const listFiles = () => client.get('/admin/files').then(r => r.data)

// 删除文件：DELETE /api/admin/files/{path}
export const deleteFile = (path) => client.delete(`/admin/files/${path}`).then(r => r.data)

// 重命名文件：POST /api/admin/files/rename（自动同步所有引用）
export const renameFile = (path, newName) =>
  client.post('/admin/files/rename', { path, newName }).then(r => r.data)

// 移动文件：POST /api/admin/files/move（targetDir 为目标目录相对路径，'' 表示根目录）
export const moveFile = (path, targetDir) =>
  client.post('/admin/files/move', { path, targetDir }).then(r => r.data)

// 新建文件夹：POST /api/admin/files/folder（path 为新文件夹相对路径）
export const createFolder = (path) =>
  client.post('/admin/files/folder', { path }).then(r => r.data)

// 批量删除：POST /api/admin/files/batch-delete —— 一次请求删多个，返回 { deleted, skipped[] }
export const batchDeleteFiles = (paths) =>
  client.post('/admin/files/batch-delete', { paths }).then(r => r.data)

// 删除文件夹：DELETE /api/admin/files/folder/{path} —— 内含使用中文件则整体拒删
export const deleteFolder = (path) =>
  client.delete(`/admin/files/folder/${path}`).then(r => r.data)

// 一键清理空闲：POST /api/admin/files/clean-orphans?dryRun= —— dryRun 预览将删清单，false 执行
export const cleanOrphans = (dryRun) =>
  client.post(`/admin/files/clean-orphans?dryRun=${dryRun}`).then(r => r.data)

// 访问记录列表：GET /api/admin/access-logs
export const getAccessLogs = (params) =>
  client.get('/admin/access-logs', { params }).then(r => r.data)

// 访问记录统计：GET /api/admin/access-logs/stats
export const getAccessLogStats = () =>
  client.get('/admin/access-logs/stats').then(r => r.data)

// 清理 N 天前旧记录：DELETE /api/admin/access-logs/cleanup?days=30
export const cleanupAccessLogs = (days = 30) =>
  client.delete('/admin/access-logs/cleanup', { params: { days } }).then(r => r.data)

// 一键清空所有记录：DELETE /api/admin/access-logs/all
export const clearAllAccessLogs = () =>
  client.delete('/admin/access-logs/all').then(r => r.data)
