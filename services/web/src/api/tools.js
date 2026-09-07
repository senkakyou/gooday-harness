// =====================================================
// api/tools.js —— 工具相关接口
// 职责：获取工具列表、工具详情、分类、触发文件下载
// =====================================================

import client from './client'

// 获取工具列表：GET /api/tools?category=xxx（category 可不传，返回全部）
export const listTools = (category) =>
  client.get('/tools', { params: category ? { category } : {} }).then(r => r.data)

// 获取单个工具详情：GET /api/tools/:slug（同时会让后端 viewCount +1）
export const getTool = (slug) =>
  client.get(`/tools/${slug}`).then(r => r.data)

// 获取所有分类：GET /api/categories
export const getCategories = () =>
  client.get('/categories').then(r => r.data)

// 触发文件下载
// 原理：下载接口需要身份验证，但浏览器的 <a href> 下载不会带 Authorization 头
// 解决方案：先把 token 写入 cookie（后端也支持从 cookie 读 token），
// 然后动态创建一个隐藏的 <a> 标签点击它，触发浏览器下载，下载完再删掉这个 <a>
export const downloadTool = (slug) => {
  const token = localStorage.getItem('token')
  if (token) document.cookie = `token=${token};path=/;SameSite=Lax`  // 有 token 才写 cookie（免登录工具不设）
  const a = document.createElement('a')
  a.href = `/api/tools/${slug}/download`
  a.download = ''  // 告诉浏览器这是下载而不是跳转
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
