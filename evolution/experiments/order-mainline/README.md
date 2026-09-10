# experiments/order-mainline · 订单主链路收敛到「四个人一条线」

## 要验证的改动

把「客户→如意→擎天柱→威震天→dispatcher→deliver→交付」这条多角色多层链路，
收敛为 **客户 → 如意 → 大海 → 我 ⇄ 灵犀 → 大海 → 客户**：
删掉擎天柱、威震天、招财三个角色与 dispatcher，删掉工单→项目→子任务→事件四层对象，
订单状态从 12 个收敛到 5 个，且**全链路没有一个定时任务**。

## 关联的 Decision

`docs/decisions/006-order-mainline-v2.md`

## 验证方式

**前后对比 + 结构判据**。改动跨代码、数据库、接口三层，影子模式覆盖不到「东西有没有真的删掉」，
所以判据直接查终态。三类判据都**查行为不查名字**：

| 类别 | 怎么查 | 为什么不能只查名字 |
|---|---|---|
| 结构 | 读仓库文件，数角色数、人格份数、状态表处数 | 「文件还在不在」比「有没有 import 它」可证伪 |
| 库 | `sudo sqlite3` 读运行库的表、列、状态值 | 代码里删了模型 ≠ 库里删了表 |
| 接口 | 真发 HTTP，看路由存废 | Controller 文件删了但路由被别处注册过，只有实发能发现 |

## 两个检查器

| 文件 | 查什么 | 怎么跑 |
|---|---|---|
| `check.py` | **东西在不在**：角色数、人格份数、状态表处数、表与列、路由存废 | `python3 check.py` |
| `e2e.py` | **链路走不走得通、该拦的拦不拦得住**：真发 HTTP、真读库、跑完自清理 | `set -a; . .env; set +a; python3 e2e.py` |

静态检查全绿 ≠ 系统能跑（AGENTS.md 三条不可协商之一），所以两个都要绿。

### e2e.py 没覆盖的部分（明说，别当成验过了）

- **交付物生成 → 出讲解片 → 放行通知客户** 这一段：要真调模型、真渲染视频、
  真给客户发消息，一轮十几分钟且会打扰真人。只验证了「没有交付物时 release 必须被拦」。
- **「结单要求金额非空」那道闸**：要覆盖它得先把订单推到 DELIVERED，
  而那需要一件三样齐的真交付物。代码在 `TicketsController.Transition` 的
  `evt == "close" && t.Amount == null` 分支，**尚无自动化覆盖**。

## 通过判据

**改动前基线（2026-09-10，commit 293f3de）：判据 25 项 · 通过 2 · 未通过 23。**

通过 = 25 项全绿。其中 2 项在基线上就是绿的（`GET /api/tickets`、`GET /api/clients`
本来就该继续存在），它们是**反向对照**——如果哪次改动把它们弄红了，说明删过头了。

## 写这个检查器时当场抓到的两个假绿

**都在本文件的检查器自己身上**，记在这里是因为这两类错误会反复出现：

1. **「删掉的路由返 404」不成立。** 未知路径落 SPA 兜底返 `200 text/html`，
   `/api/definitely-not-a-real-route` 实测就是 200。照这个判据写，检查器
   **结构上就检测不到删除**，永远绿。改成看 Content-Type，并且**方法要用该路由真正实现的那个**
   （`GET /api/bot-finance` 返 HTML，因为它只有 POST，照 GET 判会误报已删除）。

2. **405 被当成了「路由存在」。** `POST /api/tickets/1/transition` 返回 405 空响应，
   而那个路由当时**根本还不存在**，检查器却给了它通过。对照组
   `POST /api/nonexistent/xyz` 同样 405 空响应，证明 405 只说明「该方法没实现」。

3. **私号名单漏查一份。** 正则只写了 `_privateAccounts`，漏掉 `AuthController.cs:196`
   那份**没有下划线的局部变量 `privateAccounts`**。两处写法不对称，规则只覆盖其中一种。

## 失败怎么办

- **代码回滚点**：tag `pre-order-mainline-v2`（= commit 293f3de，已推 origin）
- **数据回滚点**：`/srv/gooday-harness/backups/gooday/pre-order-mainline-v2.db`
  （`.backup` 在线备份，`PRAGMA integrity_check = ok`，Users=15 / Tickets=6 / Tools=103 与生产一致）
- **待删表归档**：`/srv/gooday-harness/backups/pre-order-mainline-v2-archive/*.json`
- 回滚命令（**已于 2026-09-10 在副本上实测演练**，见下）：
  ```bash
  D=/var/lib/docker/volumes/gooday_gooday_data/_data/gooday.db

  git -C /opt/gooday-harness checkout pre-order-mainline-v2
  docker stop gooday-harness-api                  # ← 主要写入方是容器，不是 systemd 服务
  sudo systemctl stop gooday-harness-bot-lingxi gooday-harness-bot-ruyi

  sudo cp /srv/gooday-harness/backups/gooday/pre-order-mainline-v2.db "$D"
  sudo rm -f "$D-wal" "$D-shm"                    # ← 【少这一行回滚就是无效的】

  docker start gooday-harness-api
  sudo bash /opt/gooday-harness/ops/install.sh
  ```

### 回滚演练结果（2026-09-10，在副本上真跑，不是推演）

**第一版回滚命令是错的**，演练当场把它证伪了。造一个「主库旧、`-wal` 里有新写入」的现场后：

| 做法 | 结果 |
|---|---|
| 只 `cp` 备份覆盖 `.db`，不动 `-wal` | ❌ 陈旧 WAL 被重放，**要回滚掉的那条写入又回来了**——回滚等于没回滚 |
| `cp` 覆盖 + `rm -f -wal -shm`，但备份是 `cp` 出来的 | ❌ `no such table` —— **`cp` 一个 WAL 库根本不算备份**，表和数据当时还在 WAL 里，拷到的主文件是空的 |
| `sqlite3 .backup` 出来的备份 + `cp` 覆盖 + `rm -f -wal -shm` | ✅ 只剩旧数据，新写入被真正回滚掉 |

两条换来的知识：

1. **`-wal` / `-shm` 必须删**，否则恢复出来的是「旧主库 + 新 WAL」的混合体。
2. **备份必须用 `sqlite3 .backup`（在线备份 API），不能用 `cp`。**
   本次的 `pre-order-mainline-v2.db` 用的就是 `.backup`（`integrity_check = ok`，
   Users=15 / Tickets=6 / Tools=103 与生产一致）；
   `workflows/db-snapshot` 也一直用 `.backup`，它的注释里正好写着这个陷阱——
   所以每小时那批自动备份是有效的，这条顺便复核过了。

## 判据

1. 终止时间：**`check.py` 退出码为 0 的那一刻即结束**，不设「观察中」的开放期。
2. 结论写回 `docs/decisions/006-order-mainline-v2.md`，否则这次实验白做。
3. 检查器退出码即结论：`0` 通过，`1` 未通过。红着不许进下一阶段。
