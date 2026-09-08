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

// 文件上传：POST /api/admin/upload?dir=tools/照片管家Pro（multipart/form-data 格式）
// dir 省略则落在 uploads 根目录（老行为）。返回 { fileName, path, url, size }，
// 【要存进工具字段的是 path】——文件在子目录里时只存 fileName 就找不到了。
// onProgress 是回调函数，上传过程中实时更新进度（0-100）
export const uploadFile = (file, dir, onProgress) => {
  const fd = new FormData()   // FormData 是浏览器原生对象，专门用于文件上传
  fd.append('file', file)
  return client.post('/admin/upload', fd, {
    params: dir ? { dir } : {},
    // e.loaded 是已上传字节数，e.total 是总字节数，算出百分比
    onUploadProgress: e => onProgress && onProgress(Math.round((e.loaded * 100) / e.total)),
  }).then(r => r.data)
}

// 视频讲解上传：POST /api/admin/tools/video-upload?dir=...
// 单独一个端点是因为体积上限是 500M（普通上传 100M），nginx 侧也只对这个路径放宽
export const uploadToolVideo = (file, dir, onProgress) => {
  const fd = new FormData()
  fd.append('file', file)
  return client.post('/admin/tools/video-upload', fd, {
    params: dir ? { dir } : {},
    timeout: 0,   // 500MB 慢速上行可能要很久，别让默认超时把上到一半的传输掐了
    onUploadProgress: e => onProgress && onProgress(Math.round((e.loaded * 100) / e.total)),
  }).then(r => r.data)
}

// 归置干跑：GET /api/admin/tools/organize/plan —— 只算方案，不动任何文件
export const organizePlan = (prefix = 'tools') =>
  client.get('/admin/tools/organize/plan', { params: { prefix } }).then(r => r.data)

// 归置执行：POST /api/admin/tools/organize/apply —— 照单执行 { moves, folders }
export const organizeApply = (payload) =>
  client.post('/admin/tools/organize/apply', payload, { timeout: 0 }).then(r => r.data)

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
