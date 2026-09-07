// =====================================================
// api/notifications.js —— 站内通知（系统 → 用户）
// =====================================================
import client from './client'

export const listNotifications = (page = 1) =>
  client.get('/notifications', { params: { page } }).then(r => r.data)

export const notifUnreadCount = () =>
  client.get('/notifications/unread-count').then(r => r.data)

export const readNotification = (id) => client.post(`/notifications/${id}/read`)
export const readAllNotifications = () => client.post('/notifications/read-all')
export const deleteNotification = (id) => client.delete(`/notifications/${id}`)

// 管理端：发系统公告
export const broadcastNotification = (data) => client.post('/admin/notifications/broadcast', data)
