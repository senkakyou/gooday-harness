// =====================================================
// api/settings.js —— 系统配置接口（小额自动放行等）
// =====================================================

import client from './client'

// 读全部配置（含 AutoApprove 默认值）：GET /api/admin/settings
export const getSettings = () =>
  client.get('/admin/settings').then(r => r.data)

// 设置单个键：PUT /api/admin/settings/:key  body { value }
export const updateSetting = (key, value) =>
  client.put(`/admin/settings/${key}`, { value }).then(r => r.data)

// 公开查询：如意直接会话状态 + 留言板开关 + 用户 ID（无需登录）
export const getRuyiContact = () =>
  client.get('/settings/ruyi-contact').then(r => r.data)

// 管理员：清空全部公开留言
export const clearChat = () =>
  client.delete('/admin/chat').then(r => r.data)

// 公开查询：各首页模块显示开关（站长控制，默认全开）
export const getModules = () =>
  client.get('/settings/modules').then(r => r.data)
