# web —— 前端（React + Vite）

Gooday 的整个前台界面：论坛、听书、工具、投资、课程、二手、后台管理。

## 它怎么"部署"

**它不是一个跑着的进程，是构建期成员。** `npm run build` 把产物打进
`services/api/src/wwwroot/`，由 API 容器作为静态文件发出去，nginx 的
`location /` 转到 API。所以 `deploy/` 下是 `build.sh`，不是 `unit.service`
也不在 docker-compose 里。

```
services/web/src/  ──npm run build──▶  services/api/src/wwwroot/{index.html,assets/}
                                              │
                              docker compose build api（产物进镜像）
                                              │
                                    nginx location / → :8081
```

**产物提交进仓库、源码却不在** —— 这是迁移期真实存在过的状态（2026-09-07 发现）：
线上能发、但克隆一份下来重建不出前端。G04（部署可重建）要防的就是它。
现在源码在这里了，两者都在仓库，产物由 `build.sh` 从源码重新生成。

## 判据

必须可证伪，且能机械判定：

1. **`npm ci && npm run build` 退出码 0**，且 `../api/src/wwwroot/assets/` 下
   至少 1 个文件 mtime 晚于本次构建开始时间——产物没被重写就是没构建成功。

   ```bash
   cd services/web && npm ci && npm run build
   ```

2. **构建耗时 ≤180 秒**（本机 2G 内存，超过这个数通常是在换页而不是在编译，
   继续等只会 OOM）。
3. **改动页面必须 Playwright 实访 ≥1 次，控制台 JS 报错数 = 0**——
   `npm run build` 通过只证明能打包，证明不了页面能用。
4. **提交里若含 `wwwroot/assets/` 产物却不含对应 `src/` 改动，视为不合格**：
   那就是 2026-09-07 那个「线上能发、克隆下来重建不出前端」的状态又回来了。

## 门禁盯着它的两条

`services/web/` 存在之后，这两条规则才真正生效（在此之前它们报 SKIP）：

- **G10 输入框字号 ≥16px** —— iOS Safari 会自动放大 `font-size<16px` 的
  input/textarea，布局错位、发送按钮被挤出视口。内联 `style` 覆盖 CSS 类，
  两者必须一致。
- **G11 全屏浮层 z-index ≥1000** —— 现有全局层级：Navbar 100、抽屉 200、
  `.bottom-tab-bar` 200、audiobook-player 250。听书阅读器取 z100 栽过：
  顶部靠 DOM 顺序压住了 Navbar，底部却被 BottomTabBar 把翻页/进度条整条遮没。

## 明确不做

- **不单独部署前端服务**。没有独立的 web 容器、没有 SSR、没有 Node 运行时。
  产物是纯静态文件，由 API 发出去 —— 少一个进程就少一处会挂的地方。
- **dev 模式的 proxy 只用于本地开发**（`vite.config.js` 里代理到 :5000），
  生产环境走 nginx，跟这段配置无关。

## 结构

```
src/pages/      按模块分：admin(26) teacher secondhand courses account home forum ...
src/components/ 跨页复用组件（Navbar、BottomTabBar 等全局固定栏在这）
src/api/        后端接口封装，一个模块一个文件
src/utils/      工具函数
```
