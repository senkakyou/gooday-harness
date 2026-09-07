// =====================================================
// store/authStore.js —— 全局登录状态存储（Zustand）
// 职责：持久化 token 和用户信息，供所有组件读取登录状态
//
// 设计要点：
//   - 页面刷新后 Zustand 内存重置，因此 token/user 同时存 localStorage
//   - 读取时优先从 localStorage 还原，保证刷新后仍处于登录态
// =====================================================

import { create } from 'zustand'

// 模块加载时从 localStorage 读取上次登录的用户信息
const stored = localStorage.getItem('user')

// 把 token 写入 cookie，供服务端对页面导航类请求鉴权（如 /qianky 私有页、文件下载）
// 浏览器直接打开页面时只会带 cookie，无法带 Authorization 头，故 token 需同步进 cookie
const setTokenCookie = (token) =>
  { document.cookie = `token=${token};path=/;SameSite=Lax;max-age=604800` }  // 7天，与 JWT 有效期一致
const clearTokenCookie = () =>
  { document.cookie = 'token=;path=/;max-age=0' }

// 刷新后若 localStorage 仍有 token，补写 cookie（保证服务端鉴权在刷新后仍可用）
const initToken = localStorage.getItem('token')
if (initToken) setTokenCookie(initToken)

const useAuthStore = create((set) => ({
  // ---- 状态 ----
  token: initToken || null,                             // JWT token，null 表示未登录
  user: stored ? JSON.parse(stored) : null,             // { username, role, userId, avatarUrl }

  // ---- 操作方法 ----

  // 登录成功后调用：同时写入内存状态、localStorage 和 cookie
  setAuth: (token, user) => {
    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(user))
    setTokenCookie(token)
    set({ token, user })
  },

  // 局部更新用户信息（如上传头像后只改 avatarUrl，不需要重新登录）
  updateUser: (patch) => {
    set(state => {
      const user = { ...state.user, ...patch }  // 合并新字段，旧字段保留
      localStorage.setItem('user', JSON.stringify(user))
      return { user }
    })
  },

  // 退出登录：清除内存状态、localStorage 和 cookie
  logout: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    clearTokenCookie()
    set({ token: null, user: null })
  },
}))

export default useAuthStore
