# workflows/order · 订单的四条显式命令

把一张订单从「大海说开工」推到「东西齐了等他放行」。
取代 `workflows/deliver`（每日轮询拉单）与 `services/bot-weizhentian`（常驻开发 bot）。

## 它在整条链路的位置

```
客户 → 如意开单(NEW) → 大海与客户确认、下开工令
                          ↓
        ┌───────────── 本流程 ─────────────┐
        │ start  → IN_PROGRESS，建工作目录   │
        │ build  → 可选：机器生成单文件网页   │
        │ review → 送灵犀评审，取回结论 ⇄ 改  │
        │ ready  → 三样齐 → 上架（不通知客户）│
        └───────────────┬─────────────────┘
                        ↓
      大海点「放行验收」→ 如意通知客户 → 大海结单(close)
```

## 用法

```bash
python3 run.py start   GD-20260910-001    # NEW → IN_PROGRESS
python3 run.py build   GD-20260910-001    # 可选，多数单子由主 Agent 自己做
python3 run.py review  GD-20260910-001    # 0=通过 1=打回 2=还没回 3=三轮不过已 BLOCK
python3 run.py ready   GD-20260910-001    # 上架并报告，【不通知客户】
python3 run.py close   GD-20260910-001    # DELIVERED → CLOSED
```

## 判据（可证伪）

1. **没有定时任务。** `deploy/schedule.cron` 里没有任何非注释行；
   跑完 `ops/install.sh` 后 `crontab -l` 的托管块里不出现 `order`。
2. **ready 不会通知客户。** 跑完 `ready` 后，`PrivateMessages` 里
   不新增任何发给客户的消息；通知只在 `POST /api/tickets/{id}/transition`
   的 `release` 事件里发生。
3. **没有灵犀的通过结论就不让上架。** 未跑过 `review` 直接 `ready` 必须非零退出，
   除非显式带 `--skip-review`。
4. **review 可重入。** 连续跑两次 `review`，灵犀只收到一条评审请求，
   第二次是接着等而不是重发（靠 state 里的 `pendingReview`）。
5. **三轮不过就停。** 第 3 次打回后再跑 `review`，订单进 `BLOCKED` 且
   `BlockedReason` 非空，退出码 3。
6. **交付物自检拦得住。** 含外链脚本 / 对外 fetch / TODO / 小于 800 字节的产物，
   `ready` 必须拒绝上架。

## 目录

```
run.py                  四条命令
prompts/build.md        交付物生成的提示词（【单一真源】，原 bot-weizhentian/prompt.md）
deploy/schedule.cron    只有注释——本流程刻意不设定时任务
```

## 为什么 prompts/build.md 不是一个「角色」

判据是结构性的，不是叫法问题：

| | Agent | 提示词 |
|---|---|---|
| 独立 bot_id | 有 | 无 |
| 收件箱 | 有 | 无 |
| 常驻轮询 | 有 | 无 |
| systemd 单元 | 有 | 无 |
| 消息路由白名单 | 有 | 无 |

`build.md` 是后者：确定性代码在 `build` 这一步一次性 `model.call()`，
无状态、无身份、无收件箱。多数订单由主 Agent 用自己的工具开发，
根本不会走到那一步。

docs/decisions/006 明令「不新建 planner / developer / worker 角色」，
本流程遵守这条——**它没有增加任何一个会自己醒来的东西**。

## 状态与产物（都在仓库外，G01）

```
/var/lib/gooday-harness/state/order/<订单号>.json    评审轮次、pendingReview
/var/lib/gooday-harness/evidence/order/*.json        每步的证据
/srv/gooday-harness/work/<订单号>/                   工作目录（需求原文 + 交付物）
/srv/gooday-harness/media/uploads/private/<订单号>/  上架用的私有交付物
```
