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
- 回滚命令：
  ```bash
  git -C /opt/gooday-harness checkout pre-order-mainline-v2
  sudo systemctl stop gooday-harness-*                       # 先停写入方
  sudo cp /srv/gooday-harness/backups/gooday/pre-order-mainline-v2.db \
          /var/lib/docker/volumes/gooday_gooday_data/_data/gooday.db
  sudo bash /opt/gooday-harness/ops/install.sh
  ```
- **回滚必须演练过**：P3 动库之前先在副本上跑一遍上面这串，确认 Users=15 能查出来再动生产。

## 判据

1. 终止时间：**`check.py` 退出码为 0 的那一刻即结束**，不设「观察中」的开放期。
2. 结论写回 `docs/decisions/006-order-mainline-v2.md`，否则这次实验白做。
3. 检查器退出码即结论：`0` 通过，`1` 未通过。红着不许进下一阶段。
