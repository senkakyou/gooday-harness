# services/api · 后端应用（ASP.NET Core）

Gooday 的 Web 后端。工具、论坛、食品安全、工单、财务的全部接口。

**这是唯一有真实用户的服务** —— qianky 每周用它的食品安全功能。

## 迁移方式：并存验证，不是一步切换

| | 旧栈 | 新栈 |
|---|---|---|
| 容器 | `gooday_app` | `gooday-harness-api` |
| 端口 | 8080 | **8081**（迁移期并存，不抢） |
| 源码 | `/opt/gooday/src/GoodayTools` | `services/api/src`（本仓库） |
| 产物 | `wwwroot/uploads` 混在源码里 | `/srv/gooday-harness/media/`（G01：产物出仓库） |
| 数据库 | 卷 `gooday_gooday_data` | **同一个卷**（`external: true`） |

**数据库沿用同一个卷，不复制。** 切换的本质是「换个进程读同一份数据」，
复制会立刻产生两份真相——那才是真正丢数据的方式。

`external: true` 还有一层作用：`docker compose down` 不会误删它。

## 迁移时踩到的

**应用拒绝用默认 JWT 密钥启动**，报「生产环境不可使用默认 JWT 密钥」。
原因是它要的是 .NET 配置命名 `Jwt__Secret`，不是裸的 `JWT_SECRET`。

**这是个好设计**：传错名字时它不会用默认值凑合，而是直接拒绝启动。
宁可起不来，也不要用一个人人都知道的密钥在生产跑。

## 判据

1. **qianky 的真实身份端到端可用**——这是整件事唯一的硬判据。
   *2026-09-07 实测：用 qianky(id=10) 的 token 调新栈，
   `/api/auth/profile` 与 `/api/food-safety/records` 均 200，
   返回数据与旧栈逐字一致（通海县花果山泉水厂的检查记录）。*
2. 新旧栈同一端点返回相同状态码。*实测三个端点全部一致。*
3. 内容资产不丢：工具 103 个、论坛 42 帖、uploads 135 个文件。
   由 `workflows/patrol` 的 `checks/assets.py` 每 5 分钟自动核对。

## 尚未做的（切换步骤）

新栈已验证可用，但**还没切**：nginx 仍指向旧栈 8080。

切换 = 改 `ops/nginx/` 的上游到 8081 → reload → 验证 qianky 链路 → 停旧栈。
**那一步是单点操作，无法影子验证**，应当在 qianky 不用的时段做。
