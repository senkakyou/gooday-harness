# evolution/ · 第二层循环：系统改进自己

> **注：文中拿「dispatcher 的影子模式」举例说明 Experiment 环。**
> 影子模式本身仍是有效的实验手段（零风险验证新决策逻辑），
> 但 dispatcher 与 patrol 都已切到生产模式，别照字面以为它们还在影子里跑。

第一层循环（`services/` `workflows/`）让系统**把事做完**。
第二层循环让系统**把事做得更好**——做完不算结束，要能回答"刚才做得怎么样"，
并且把答案变成下一次的改动。

```
        ┌─────────── 第一层：执行 ───────────┐
        │  Task → Context → Plan → Execute   │
        │           → Verify → Result        │
        └──────────────┬─────────────────────┘
                       │ Result + Evidence
                       ▼
        ┌─────────── 第二层：进化 ───────────┐
        │  Evaluate  这次做得怎么样（打分）    │  evaluators/
        │     ↓                              │
        │  Learn     失败原因归档为经验        │  docs/incidents/
        │     ↓                              │
        │  Improve   提出改动方案             │  docs/decisions/
        │     ↓                              │
        │  Experiment 影子/灰度/前后对比验证   │  experiments/
        │     ↓                              │
        │  Gate      质量门禁                 │  gates/
        │     ↓                              │
        │  Promote 或 Rollback               │  ops/install.sh + checkpoint
        └────────────────────────────────────┘
```

## 铁律：**没有证据不许改**

任何自动改动必须留下这六样，缺一不算数（policies G07 会查）：

| 留痕 | 是什么 | 落在哪 |
|---|---|---|
| **Task** | 这次要干什么 | `/var/lib/gooday-harness/tasks/` |
| **Event** | 过程中发生了什么 | `/var/lib/gooday-harness/events/` |
| **Evidence** | 凭什么这么判（日志片段、指标、样本） | `/var/lib/gooday-harness/evidence/` |
| **Evaluation** | 打了几分、为什么 | `/var/lib/gooday-harness/evaluations/` |
| **Decision** | 决定改什么、谁批的 | `docs/decisions/`（进版本库） |
| **Checkpoint** | 改之前的可回滚点 | `/var/lib/gooday-harness/checkpoints/` |

> 今晚（2026-09-07）踩的每一个坑都是"发生了但没留痕"：
> 凭据 8/25 就失效了，没人知道；drop-in 装上了但脚本没记，重装即丢；
> 注入条款写了三个月没进 prompt，没有任何地方能发现。
> **可追溯不是审计需求，是自我迭代的前提**——你没法改进一件你看不见的事。

## 为什么不做成通用 Agent 框架

执行层已经拥挤且被巨头占据（LangGraph 主打可审计+可回滚、CrewAI 覆盖 60% 财富 500、
OpenAI/Google/Microsoft 各自带 SDK），而 MCP 已经标准化工具层、A2A 标准化通信层——
**框架本身正在变成可替换的胶水**。

第二层循环是那里**没有**的东西。所以本目录的定位是：

> **挂在任何执行层之上的自我迭代层。**
> 不自己实现 Runtime，不绑定某个框架。底下是 Claude CLI、LangGraph 还是别的，都行。

## 三个组成部分

| 目录 | 是什么 | 扩展方式 |
|---|---|---|
| `evaluators/` | **怎么给结果打分**。一个目录一个评价器 | `cp -r evaluators/_template evaluators/<名>` |
| `experiments/` | **改动怎么验证才算通过**。一个目录一个实验 | `cp -r experiments/_template experiments/<名>` |
| `gates/` | **质量门禁**。规范的执行体，`check.py` + `rules/{H,C,G}/` | 丢一个 `.py` 进 `rules/<层>/` |

`gates/` 和另外两个形状不同——它是**一个工具**，不是成员集合，所以没有 `_template/`。

## 已经存在的雏形（不是从零开始）

Gooday 里这个循环已经有碎片，缺的是串成显式闭环：

| 循环环节 | 现有的东西 |
|---|---|
| Evaluate | `patrol` 的 11 项巡检、日报/月报 |
| Learn | `docs/incidents/` 事故复盘 |
| Experiment | `dispatcher` 的**影子模式**（只算不做，比对一致率）——这是现成的实验机制 |
| Gate | `gates/check.py` |
| Rollback | 数据库快照 + systemd 可重启 |

影子模式尤其值得复用：它已经证明可以在零风险下验证一个新决策逻辑对不对。
