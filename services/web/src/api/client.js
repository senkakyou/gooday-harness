// =====================================================
// api/client.js —— Axios 基础实例（所有 HTTP 请求的底层）
// 职责：
//   1. 设置统一的请求根路径 /api
//   2. 每次请求自动带上 token（这样不用每个接口单独写）
//   3. 统一处理后端返回的错误信息格式
// =====================================================

import axios from 'axios'

// 创建一个 axios 实例，baseURL 设为 /api
// 开发时 Vite 代理会把 /api 转发到 http://localhost:5000/api
// 生产时直接命中同域的后端
const client = axios.create({ baseURL: '/api' })

// ---- 请求拦截器：发出请求前自动加 token ----
// 每次请求前检查 localStorage 有没有 token，有就加到 Authorization 头
// 这样后端就能知道是谁在操作
client.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

// ---- 响应拦截器：统一提取错误信息 ----
// 请求成功时原样返回
// 请求失败时，从后端返回的 JSON 里提取 message 字段作为错误信息
// 这样调用方 catch(e) 拿到的 e.message 始终是可读的中文提示
client.interceptors.response.use(
  res => res,
  err => {
    const msg =
      err.response?.data?.message ||  // 后端返回的 { message: "xxx" }
      err.response?.data?.error ||    // 或者 { error: "xxx" }
      err.message ||                  // 或者网络层错误（如断网）
      '请求失败'
    return Promise.reject(new Error(msg))
  }
)

export default client
