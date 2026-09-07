# gooday-assets —— Gooday 的第一条真实业务闭环

canary 证明**Harness 自己能转**；本闭环证明**Harness 能改进真实系统**。
两个都要在，缺一个都说明不了问题。

被改进的是**运行中的 Gooday**：真库、真文件、真用户会撞见的 404。

## 它解决的真实问题

2026-09-07 巡检持续报 P0：「有 2 项已发布内容的文件丢了」。
实测两个 URL 对真实用户返回 **404**，而后台一切正常、页面照常列出来 ——
**只有点进去的人才知道**。

| Id | 工具 | 症状 | 归类 | 候选改动 |
|----|------|------|------|----------|
| 14 | Compare 比较工具 | 下载指向 `compare_20260429062048.html`，磁盘上没有 | `renamed_twin` | 指回磁盘上的 `compare.html` |
| 104 | 微软生成式AI课程 | 下载指向 `zip/generative-ai-beginners.zip`，磁盘和归档里都没有 | `orphan_download` | `HasDownload=0`，不再对外宣称有下载 |

首轮实跑：**0.9845 → 0.9922 → 1.0 → 收敛**（第 3 轮 `no_change_needed`）。
复验：工具 14 下载 404→200；工具 104 在线入口仍 200、仍是已发布。

## 为什么选它作为第一条

- **真实**——现在就在发生，巡检每 5 分钟报一次
- **可客观测量**——文件在不在，二值，没有解释空间
- **低风险**——改元数据字段，不动文件，checkpoint 是整行
- **可自动复验**——改完要么 URL 200，要么不再对外宣称有下载

## 七环怎么落到这条闭环上

| 环 | 这条闭环里是什么 |
|----|------------------|
| Run | 扫全部已发布工具，逐项判文件在不在（129 项） |
| Evaluate | 通过率 = 存在项/总项。**一项 404 就判 fail** —— 撞上的用户看到的是 100% 坏 |
| Learn | 按证据归类：`renamed_twin`（有同主干同时间戳的孪生体）/ `orphan_download`（哪都找不到） |
| Improve | 每类一条策略，候选自带 target/why/scope/risk/acceptance/patch |
| Experiment | `.dump Tools` 导出后本地重建一个**隔离库**，patch 只作用在副本上 |
| Gate | ①通过率必须超过基线 ②已正常的一项都不许变坏 ③已发布数不许减少 |
| Promote/Rollback | 先存 checkpoint（受影响行整行原值）→ 改 → 复验 → 低于基线立即回滚 |

## 三条硬边界

1. **隔离用 `.dump` 不用 `cp`**。WAL 模式下 cp 主文件会丢新写入（CLAUDE.md 记过）；
   而且 cp 出来的文件归 root，变体要写还得提权。dump 走事务视图，
   拿到的是一致快照，重建出来的库归当前身份，实验全程不需要任何提权。
2. **可改字段白名单写死在执行层**（`subject.ALLOWED_FIELDS`）。
   improve 里也有一份，但那是「生成候选时的自律」；执行层这份是
   「即使候选来路不明也改不动别的东西」。一个自动改生产库的东西，
   边界必须在最靠近写操作的地方再确认一次。实测拒绝 `IsPublished` 和 `1 OR 1=1`。
3. **在线页面找不到源文件时不自动下架**。那会让整个工具消失，
   影响面远超「关掉一个下载按钮」，留给人判断。

## Gate 为什么要查「已发布数不许减少」

因为**下架能让分数变好看**。把坏的内容删掉，通过率立刻 100% ——
但那是把问题藏起来，不是解决。这条判据堵死这条路。

## 判据

```bash
python3 evolution/loops/gooday-assets/test_loop_assets.py   # 离线自测，不碰生产
python3 workflows/evolve/run.py                             # 真跑（需 root/授权）
```

跑完 `$GOODAY_HARNESS_STATE/decisions/` 里应有本轮 Decision，
含 target/why/scope/risk/acceptance/status/result/checkpoint。

## 明确不做

- **不动文件**。只改数据库字段。找回丢失文件是人的事，不是它的事。
- **不改 IsPublished**。下架是业务决定。
- **不碰 Tools 以外的表**。
