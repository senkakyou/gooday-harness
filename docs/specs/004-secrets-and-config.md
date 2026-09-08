# 004 · 密钥与配置

> 2026-09-07 定案 · **2026-09-08 状态：已落地**
>
> 文中「旧系统的问题」指已封存的 `/opt/goodayback`，正文保留作为**为什么这么设计**的出处。
> 现行做法：密钥在仓库根 `.env`（不进版本库），声明在 `.env.example`，
> `ops/docker/.env` 是指向它的软链——compose 的**变量插值只读项目目录下的 `.env`**，
> 不读 `env_file:`，这一条是 2026-09-07 整站 500 换来的。

## 旧系统的问题

`/opt/gooday/.env` 里混着两类完全不同的东西：

| 键 | 是什么 |
|---|---|
| `JWT_SECRET` | **真密钥** |
| `LINGXI_PASSWORD` | **真密钥** |
| `V3_NOTIFY` / `V3_DISPATCH` / `ANTHROPIC_MODEL` | 普通配置 |

消费者：6 个 systemd 单元（`EnvironmentFile`）＋ 4 处 cron（`source`）。

**混在一起的三个代价：**

1. 改一个模型名也要碰密钥文件。
2. 配置进不了版本库（因为同一个文件里有密钥），于是
   **「当前生效的配置是什么」没有单一真源**——只能上服务器看。
3. 每个消费者都拿到全部密钥，包括那些只需要配置的。

## 决定：分离

```
配置  ops/config.example.json  →  /etc/gooday-harness/config.json
      【进版本库】可 review、可回滚、是真源

密钥  .env.example（只有键名和占位符）→  /opt/gooday-harness/.env
      【绝不进版本库】0600，只给真正需要的消费者
```

`.env.example` 进版本库的作用是**声明需要哪些密钥**——
新机器部署时照着填，不用去猜。它本身不含任何真值。

## 大模型凭据：单点，且必须是单份

Claude OAuth 凭据是**全线单点**：所有调模型的地方共用
`/home/agent/.claude/.credentials.json`。

**绝不复制成多份。** OAuth 的 refreshToken 会轮换，
两份副本各自刷新会互相顶掉——旧系统在这上面真栽过：
root 侧和 agent 侧各一份，root 那份靠人工重新登录续命，
没人做，于是反复失效（2026-08-09 一次、08-25 一次，
其中一次 6 个 bot「活着但答不出话」连续多天，全绿无告警）。

现行做法（已在旧系统落地，新系统沿用）：
systemd drop-in 设 `HOME=/home/agent`，让所有服务指向**同一个物理文件**。

代价接受：bot 与 agent 会话共用同一账号额度。
长期根治仍是改用 `ANTHROPIC_API_KEY`——不过期、不刷新、无轮换竞争、额度隔离。

## 谁能读什么

| 消费者 | 需要 |
|---|---|
| `services/*`（bot） | 全部密钥 ＋ 配置 |
| `workflows/patrol` | **不需要任何密钥**——它只读系统状态 |
| `workflows/db-snapshot` | **不需要任何密钥**——它只读数据库文件 |
| `workflows/evaluate` | 不需要 |

**已迁入的三个 workflow 一个都不需要密钥。** 这不是巧合——
不需要密钥的东西先迁，是刻意的顺序：爆炸半径最小。

## 判据

1. `.env.example` 列出全部所需键，且**每个值都是占位符**——
   由 policies G18 自动检查。
2. 真 `.env` 永不进版本库——G01 ＋ gitleaks 双重拦。
3. 新增服务需要新密钥时，**必须同时更新 `.env.example`**，
   否则新机器部署会缺键且不知道缺什么。

## 尚未决定

- **轮换机制**：`JWT_SECRET` 换了之后，所有已签发的 token 全失效
  （旧系统 `TokenVersion` 机制与之相关）。轮换流程没设计过，迁 bot 前必须定。
- **`/etc/gooday-harness/config.json` 与各 workflow 自己的 `config.json` 的关系**：
  前者是全局配置，后者是模块配置，边界还没划清。
  现状是各模块自管，暂时够用。
