// =====================================================
// api/messages.js —— 私信（一对一聊天）相关接口
// 职责：查询会话列表、拉取历史消息、发送消息、上传图片/文件
// =====================================================

import client from './client'

// 获取所有会话列表（包括最后一条消息和未读数）：GET /api/messages/conversations
export const getConversations = () =>
  client.get('/messages/conversations').then(r => r.data)

// 拉取与某用户的历史消息（分页）：GET /api/messages/:userId?page=N
// 后端每页返回 20 条，按时间升序排列
export const getMessages = (userId, page = 1) =>
  client.get(`/messages/${userId}`, { params: { page } }).then(r => r.data)

// 发送私信：POST /api/messages/:userId
// payload 可含 { content, mediaUrl, mediaType, fileName, fileSize }
export const sendMessage = (userId, payload) =>
  client.post(`/messages/${userId}`, payload).then(r => r.data)

// 获取全部未读私信数（Navbar 红点用）：GET /api/messages/unread-count
// 返回 { count: N }
export const getUnreadCount = () =>
  client.get('/messages/unread-count').then(r => r.data)

// 删除单条消息：DELETE /api/messages/:messageId
export const deleteMessage = (messageId) =>
  client.delete(`/messages/${messageId}`)

// 隐藏会话（消息保留，仅从列表移除）：DELETE /api/messages/conversations/:userId
export const hideConversation = (userId) =>
  client.delete(`/messages/conversations/${userId}`)

// 清空与某用户的全部聊天记录：DELETE /api/messages/conversations/:userId/messages
export const clearConversationMessages = (userId) =>
  client.delete(`/messages/conversations/${userId}/messages`)

// 上传私信中的图片或文件：POST /api/messages/upload（multipart/form-data）
// onProgress(0-100)：上传进度回调，用于显示进度条
export const uploadChatMedia = (file, onProgress) => {
  const fd = new FormData()
  fd.append('file', file)
  return client.post('/messages/upload', fd, {
    onUploadProgress: e => onProgress?.(Math.round(e.loaded * 100 / e.total)),
  }).then(r => r.data)
}
