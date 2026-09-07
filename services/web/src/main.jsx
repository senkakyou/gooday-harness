// =====================================================
// main.jsx —— React 应用的总入口
// 职责：把整个 App 挂载到 index.html 里的 <div id="root">
// =====================================================

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'  // 提供前端路由能力（浏览器地址栏变化时切换页面，不刷新整页）
import App from './App'
import './index.css'  // 全局样式

// createRoot：React 18 的新写法，替代旧的 ReactDOM.render
// BrowserRouter 必须包在最外层，让 App 里的 <Routes>/<Link> 能感知当前 URL
ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)
