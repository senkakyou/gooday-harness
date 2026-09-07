// =====================================================
// api/auth.js —— 用户认证与账号相关接口
// 职责：登录、注册、修改密码、个人资料读写、头像上传、搜索用户
// =====================================================

import client from './client'
import useAuthStore from '../store/authStore'

// 登录：POST /api/auth/login，支持用户名或邮箱
// 返回 { token, username, role, userId, avatarUrl }
export const login = (usernameOrEmail, password) =>
  client.post('/auth/login', { usernameOrEmail, password }).then(r => r.data)

// 注册新用户：POST /api/auth/register
// email/phone/address 可选，password 最短6位
export const register = (username, email, password, phone, address) =>
  client.post('/auth/register', { username, email, password, phone, address }).then(r => r.data)

// 修改密码：POST /api/auth/change-password（需要登录）
// 后端会让旧 token 失效并返回新 token，这里透明地更新本地 token，避免当前会话被登出
export const changePassword = (oldPassword, newPassword) =>
  client.post('/auth/change-password', { oldPassword, newPassword }).then(r => {
    if (r.data?.token) {
      const { setAuth, user } = useAuthStore.getState()
      setAuth(r.data.token, user)
    }
    return r.data
  })

// 获取当前用户的完整个人资料：GET /api/auth/profile
export const getProfile = () =>
  client.get('/auth/profile').then(r => r.data)

// 更新个人资料（邮箱、电话、地址）：PUT /api/auth/profile
export const updateProfile = (data) =>
  client.put('/auth/profile', data).then(r => r.data)

// 上传头像：POST /api/auth/avatar（multipart/form-data）
// 返回 { avatarUrl }，调用方再把新 URL 同步到 authStore
export const uploadAvatar = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return client.post('/auth/avatar', fd, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }).then(r => r.data)
}

// 按关键词搜索用户（用于发起好友申请）：GET /api/auth/users/search?q=xxx
export const searchUsers = (q) =>
  client.get('/auth/users/search', { params: { q } }).then(r => r.data)
