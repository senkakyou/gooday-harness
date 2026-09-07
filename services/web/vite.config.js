// =====================================================
// vite.config.js —— 前端构建工具配置（Vite）
// 职责：
//   1. dev 模式：启动开发服务器（port 5173），把 /api 等路径代理到后端
//   2. build 模式：把 React 项目打包输出到后端的 wwwroot 目录，
//      由 ASP.NET Core 作为静态文件直接托管，无需单独部署前端服务
// =====================================================

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',  // 允许局域网访问（不只监听 localhost）
    port: 5173,
    // ---- 开发时反向代理配置 ----
    // 目的：前端运行在 5173，后端运行在 5000，浏览器同源策略会拦截跨域请求。
    // 代理把匹配的路径透明转发到后端，前端代码里写 /api/... 即可，无需写完整地址。
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/uploads': {           // 工具 HTML 文件、收款码图片等静态资源
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/avatars': {           // 用户头像图片
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/chat-media': {        // 私信中的图片/文件
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/hubs': {              // SignalR WebSocket 端点
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true,             // 必须开启 ws:true，否则 WebSocket 握手会失败
      },
    },
  },
  build: {
    outDir: '../api/src/wwwroot',  // 打包产物直接输出到 api 的静态目录
    // 迁入 harness 时从 ../src/GoodayTools/wwwroot 改来——
    // 路径写死在这里是刻意的：产物必须落到 api 成员内，别处都发不出去
    emptyOutDir: false,  // false：保留 wwwroot 里的其他文件（如 uploads/），只覆盖 Vite 产物
  },
})
