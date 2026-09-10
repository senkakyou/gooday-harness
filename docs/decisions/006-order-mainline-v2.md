# 006 · 订单主链路收敛为「如意接单 → 大海拍板 → 我开发 → 灵犀把关 → 大海结单」

> 日期：2026-09-10 · 决策人：大海 · 状态：已上线
> 关联实验：`evolution/experiments/order-mainline/`

## 触发

- [x] 主动改进 —— 但**有可观测证据**，不是自我感动（见「现状」）

大海 2026-09-10 的口径：删掉擎天柱、威震天、招财，订单只留核心字段，
如意只管接需求和开单、**不谈钱**，开发由主 Agent 做、灵犀把关，
钱和拍板全部回到人手上。

## 现状

**这条链路已经停摆三个月，但每一个组件都还在生产上跑着。**

| 观测项 | 实测值（2026-09-10） |
|---|---|
| 擎天柱 / 威震天 业务日志 | 自 09-07 切换以来**只有「启动」行，零业务日志** |
| Tickets | 6 行，全终态（5 cancelled + 1 done），最后更新 **2026-06-17** |
| Projects / ProjectTasks / TicketEvents | 6 / 42 / 169 行，**全部是旧系统时代的数据** |
| Decisions 表 | **0 行**，却带着完整 model + DbSet + 5 个 CRUD 端点 |
| TicketEvents 未消费积压 | **119 行卡在 `Status='new'` 永远没人处理** |
| 常驻服务 | 8 个 |
| 订单状态 | 12 个 |
| 业务 API 端点 | 49 个 |

三个具体的结构问题：

1. **威震天的活早被确定性代码接管了。** `workflows/deliver/run.py` 已完整实现
   生成→打包→上架→出片→通知，文件头明写「为什么这一步在这里而不在 bot-weizhentian 里」。
   而 bot 仍在拉同一批「in_progress + 已收款」工单——**两个写者盯同一批单**，
   现在没炸只是因为没有活单。
2. **如意人格有两份**：`services/bot-ruyi/prompt.md` 一份，
   `workflows/dev-requests/run.py` 内联一份（G03 违例）。
3. **私号名单硬编码三份**（Friends / Auth / PrivateMessage 三个 Controller），
   且写法不对称（两处 `_privateAccounts` 字段、一处 `privateAccounts` 局部变量）。
   删角色漏改一处，退役的号还能被加好友。

## 决定

### 角色

删除 `services/bot-qingtianzu`、`services/bot-weizhentian`、`services/bot-zhaocai`、
`services/dispatcher` 四个常驻服务。Users 21/22/25 **退役不删行**（244 行私信引用它们）。

留下：**如意 23**（唯一对外，零工具）、**灵犀 20**（质量门禁 + 内部运维报告），
加上**主 Agent（我）**作为唯一内部执行者、**大海**作为唯一拍板人。

**不新建任何 planner / developer / worker 角色。** 判据是结构性的：
Agent = 独立 bot_id + 收件箱 + 常驻轮询 + systemd 单元 + 路由白名单；
确定性代码里一次性的 `model.call()` 不是 Agent。

### 如意开单

如意**发一张需求表给客户填**，客户填回来，她判断能不能开单。她仍然**一个工具都没有**——
建单动作走 botkit runner 已有的 `on_reply` 钩子，由 `services/bot-ruyi/intake.py`
做确定性校验后落库。

开单门槛（硬的代码判，软的如意判）：

| | 判据 |
|---|---|
| 硬 1 | 需求表必填项齐全 |
| 硬 2 | 联系得上：站内账号，或微信 / 邮箱 / 手机之一 |
| 硬 3 | 在能力范围：网页 / 命令行 / 脚本 / 小程序（白名单） |
| 硬 4 | 不违规：爬他人数据、破解、代刷、外发凭据一律谢绝 |
| 软 | 客户是真想做，不是随口问 |
| 防灌 | 同客户 24h ≤ 2 单，全站 24h ≤ 10 单 |

**如意全程不谈钱**：不报价、不问预算、不承诺工期。工单建成时 `Amount` 为空。

### 状态

12 个收敛为 **6 个**：`NEW → IN_PROGRESS → DELIVERED → CLOSED`，加 `BLOCKED` / `CANCELLED`。

**没有任何自动流转。** 每一次迁移要么大海点一下，要么我跑一条命令。

五道闸，三道人判两道代码判：

| 闸 | 位置 | 谁判 |
|---|---|---|
| ① 开单门槛 | 如意 intake | 代码 |
| ② 开工 `NEW→IN_PROGRESS` | API | 大海（其他身份 403） |
| ③ 交付齐 `IN_PROGRESS→DELIVERED` | `DeliveryService.Check` | **代码** |
| ④ 放行验收 | 后台按钮 | 大海 |
| ⑤ 结单 `→CLOSED` | API | 大海 + 代码兜「金额非空」 |

### 数据

删表：`Projects` / `ProjectTasks` / `Decisions` / `TicketEvents` / `DevRequests`。
`Tickets` 清空并瘦身 23 列 → **14 列**。新建 `TicketLogs`（工作记录）。
保留 `Clients` 与 `FinanceRecords`（不是「需求工单」，客户档案如意要用，财务是账）。

### 工程

`workflows/deliver` 改造为 `workflows/order`，提供 `start / review / ready / close`
四条命令，**删掉它的 cron**。删 `workflows/dev-requests`，`workflows/coo-patrol` 并入 `workflows/patrol`。

## 备选方案与放弃理由

| 方案 | 放弃理由 |
|---|---|
| **新建 `Orders` 表 / `/api/orders`** | **名字已被会员订阅占用**（爱发电，2 行数据），同名必然出事故。且大海原话「不是把旧系统换个名字」——改名恰恰是换名字，删对象才是瘦身 |
| **保留 dispatcher，只精简状态** | 保留事件队列就保留了「诈尸」这一整类 bug（旧事件在状态回退后被重放，把跑着的单打成 failed）。既然没有自动流转了，队列本身就没有存在理由 |
| **保留 CONFIRMED 状态** | 大海说「开工」这一下就是确认。单独一个状态只是多一次点击，没有业务价值 |
| **给如意加建单工具** | 她读到的每句话都来自不可信来源。给工具等于把注入直接变成执行。`on_reply` + 确定性校验能达到同样效果而不开这个口子 |
| **COO 自动接单跑流水线（本设计 v1）** | 大海明确要自己拍板。且 dispatcher README 里那条硬知识仍然成立：让调度经过一个会调模型的 bot，引入单点故障、每次流转多一轮模型调用、多一层「已读即凭证消失」 |
| **保留「已收款才开工」代码闸门** | 见下「风险与代价」——这是本次**唯一一处主动削弱的保护**，理由是它现在防的是大海自己 |

## 风险与代价

**这个改动会让什么变差，诚实写：**

1. **去掉了一道结构性收款保护。** 原来 `CONFIRMED → IN_PROGRESS` 与 `→ done` 都硬查
   FinanceRecords 有 `income / received / Amount > 0`——工单 25（GD-20260614-002）
   当年就是绕过这道闸结的单。现在收没收钱完全由大海判断。
   **缓解【很弱，别高估它】**：闸⑤的「金额非空才让结单」只防「结单时忘了填数」。
   2026-09-10 灵犀评审 ③ 指出并经复核确认：`Tickets.Amount` 与 `FinanceRecords`
   是两张表，**全仓没有任何一处交叉核对**（patrol 的检查项里没有财务，
   finance-report 只读 `/api/finance/monthly-report` 不看订单）。
   填了金额财务表照样可能对不上。**结论：钱这条线现在零自动检查。**
   **这一条是大海明确要的，不是我顺手删的。**

2. **删掉自动流转 = 没人推的单会一直躺着。** 原来 coo-patrol 有卡死看门狗。
   **缓解措施【尚未实现】**：本想给 patrol 加一条「`NEW` 超 3 天没动 → 提醒大海」，
   上线时没做。这条写在这里是为了不让它被忘掉——见文末「上线后仍然欠着的」。

3. **大写状态硬切会漏改。** 漏改处 `Status == "done"` 返回 false，
   在闸门里是安全的（拦住），在过滤器里是漏单（危险）。
   **缓解**：P3 逐处判断 false 的方向，**不许 grep 计数交差**；
   实验判据里有「旧小写状态字面量归零」一项。

4. **搬 `bot-weizhentian/prompt.md` 是全程最危险的一步。**
   `workflows/deliver` 每天 04:40 真读这个文件，搬移与改常量不在同一提交就当天断链。

5. **`Tickets.ClientId` 从指 Users 改指 Clients**，
   `DeliveryService` 的归属校验 `tool.OwnerUserId != t.ClientId` 必然跟着改，
   **改错就是把别人的交付物判给这个客户**。

## 验证方式

关联实验：`evolution/experiments/order-mainline/`

- **通过判据（已先写死）**：检查器 25 项全绿。
  改动前基线 **通过 2 · 未通过 23**（2026-09-10，commit 293f3de）。
- **回滚点**：
  - 代码 tag `pre-order-mainline-v2`（= 293f3de，已推 origin）
  - 数据 `/srv/gooday-harness/backups/gooday/pre-order-mainline-v2.db`
    （`integrity_check = ok`，Users=15 / Tickets=6 / Tools=103 与生产一致）
  - 待删表归档 `/srv/gooday-harness/backups/pre-order-mainline-v2-archive/*.json`
- **回滚命令**：见实验 README。**P3 动库之前必须先在副本上演练一遍。**

## 结论

- **实验结果**：
  - `check.py` 判据 25 项：改动前 **通过 2 · 未通过 23** → 改动后 **通过 25 · 未通过 0**
  - `e2e.py` 端到端 28 条断言全绿，真发 HTTP、真读库、跑完自清理、可重复跑
  - `evolution/gates/check.py` 精确回到基线：**错误 0 · 警告 34**（动手前也是这个数）
  - 站点实测正常：首页 200、工具接口返回 14 个已发布工具、公开需求表单页 200
- **判定**：通过
- **上线时间**：2026-09-10（分四个提交灰度落地，每步可独立回滚）

### 实际净减（实测，不是设计值）

| 维度 | 改动前 | 改动后 |
|---|---|---|
| systemd 常驻服务 | 8 | **3**（灵犀 / 如意 / ocr） |
| AI 角色 | 5 | **2** |
| 业务表 | 8 | **4** |
| Tickets 列 | 23 | **14** |
| 订单状态 | 12 | **6** |
| 订单线上的定时任务 | 4 | **0** |
| 自动状态流转 | 12 条迁移规则 | **0**（全部人工或显式命令） |

### 上线后仍然欠着的

1. **「结单要求金额非空」那道闸没有自动化覆盖**（见实验 README）。
2. **`docs/specs/002-known-gaps.md` 缺口十八**：`disable` 一个服务在这套部署里
   会被下次 `install.sh` 撤销。本次靠删目录规避，机制本身没修——
   已给 install.sh 补了「unit 在、来源目录不在 → 收掉」的对账，
   但「临时停用」这个能力仍然不存在。
3. **`Orders` 表里 2 行指向已删用户 #3 的外键违规**是迁移【前】就有的
   （会员订阅遗留），本次没动。
4. **「NEW 超 3 天没动 → 提醒大海」没做。** 这是「删掉自动流转」那条风险
   本该配的缓解措施（见上「风险与代价」第 2 条）。现在没有任何东西盯着
   躺着不动的新订单——**唯一的兜底是大海自己会看后台**。
   下一步要么给 patrol 加这条检查，要么明确接受「不盯」。
