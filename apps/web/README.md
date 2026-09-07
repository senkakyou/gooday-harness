# apps/web · 前端

React + Vite。

## 跑

```bash
cd apps/web && npm install && npm run build
```

## 边界

- 模块导航只加首页的 `navItems`，**不加全局 Navbar**。
- 输入框字号 **≥16px**，否则 iOS Safari 会自动放大整页（G10）。
- 全屏浮层 z-index **≥1000**，否则被 BottomTabBar(200) 盖住（G11）。
- 装饰性绝对定位层必须 `pointerEvents:'none'`，否则吃掉底下所有点击。

## 判据

1. `npm run build` **零报错**，且 Playwright 打开改动页面 **零 JS 报错**。
2. 移动端（<640px）新增页面必须实测：**列表和详情不同屏**，
   返回按钮箭头+标题整体可点（单独小箭头点不中）。
3. 每次前端改动的提交信息必须写明**用什么验的**——
   "构建通过"不算，要有页面实际渲染的证据。
