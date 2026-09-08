# coo-patrol —— 工单流业务巡检

每 5 分钟检查工单/项目/调度器的业务状态，能自愈的自愈，不能的升级给站长。

## 与 workflows/patrol 的分工（重要）

旧的 `lingxi-coo-patrol.py` 有 14 项检查，其中 **6 项和 harness patrol 重合**。
迁过来时把重合的注掉了 —— 两套系统对同一件事各报一次，
结果是人开始忽略告警，那比少一个告警更糟。

| 归 patrol（基础设施） | 归本工作流（业务流） |
|---|---|
| 服务在不在跑、心跳 | 工单卡单 `check_stuck_tickets` |
| 数据库快照新鲜度 | 读了不办/超时 `check_pending_timeout` |
| 数据库完整性 | 脏状态 `check_dirty_state` |
| TLS 证书到期 | 数据一致性 `check_consistency` |
| Claude 凭据有效性 | 收件积压 `check_inbox_backlog` |
| | 调度器状态 `check_dispatcher` |
| | Claude 并发槽 `check_claude_queue` |
| | 日报是否真发出 `check_daily_report` |

被注掉的调用**保留了函数体**，注释写明由谁接管 ——
删掉的话，日后想查「这项以前怎么做的」就没有出处了。

## 判据

```bash
DRY_RUN=1 python3 workflows/coo-patrol/run.py   # 只打印摘要不发消息
```
一切正常时输出「一切正常」；有问题时输出「N 项已处理，M 项需人工」。

## 迁移时改的

- 服务名：`gooday-lingxi` 等 → `gooday-harness-bot-lingxi` 等（旧单元已不存在，
  不改的话「服务没在跑」会每 5 分钟误报一次）
- 容器名：`gooday_app` → `gooday-harness-api`
- 状态文件 → `/var/lib/gooday-harness/state/coo-patrol/`
- 备份目录、`.env` → harness 下对应位置

## 明确不做
调度器 on 时不碰工单卡单自愈（`dispatch_is_on()` 判断）——
那归 dispatcher 管，两边都动会造成双重重派。
