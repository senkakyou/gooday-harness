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

## 四个组成部分

| 目录 | 是什么 | 扩展方式 | 现有成员 |
|---|---|---|---|
| `loops/` | **一条完整闭环**：谁被改进、怎么判好坏、怎么回滚。引擎是 `packages/evolve`，由 `workflows/evolve` 每天 07:30 各转一轮 | `cp -r loops/_template loops/<名>` | `canary`、`gooday-assets` |
| `evaluators/` | **怎么给结果打分**。一个目录一个评价器 | `cp -r evaluators/_template evaluators/<名>` | **0 个**（只有模板） |
| `experiments/` | **改动怎么验证才算通过**。一个目录一个实验 | `cp -r experiments/_template experiments/<名>` | **0 个**（只有模板） |
| `gates/` | **质量门禁**。规范的执行体，`check.py` + `rules/{H,C,G}/` | 丢一个 `.py` 进 `rules/<层>/` | 24 条规则（23 个 `.py` ＋ G05 由 `check.py` 自身实现） |

`gates/` 和另外三个形状不同——它是**一个工具**，不是成员集合，所以没有 `_template/`。

> **别把这张表当成"四环都在转"。** `evaluators/` 与 `experiments/` 至今零成员，
> 意味着 `workflows/evaluate` 每天 08:00 跑的是**一个空集合**。
> 闭环里真正在转的是 `loops/` 那两条——它们自带打分与门禁，不经由 `evaluators/`。
> 这是当前最大的一处「结构在、内容空」，记在 `docs/specs/002-known-gaps.md`。

## 两条真实闭环的分工

| | 证明什么 | 被改进的对象 |
|---|---|---|
| `loops/canary` | **Harness 这套机器还活着**（自检探针） | `examples/hello-harness` 的解析器 |
| `loops/gooday-assets` | **Harness 能改进真实系统** | 运行中的 Gooday：真库、真文件、真用户会撞见的 404 |

两个都要在。只有 canary 说明不了业务在改进；只有业务闭环则出事时分不清
是闭环坏了还是业务坏了。

## 循环各环现在由谁承担

| 循环环节 | 谁在做 | 自动？ |
|---|---|---|
| Evaluate | `loops/*/` 自带判据；`patrol` 11 项巡检、`coo-patrol` 业务巡检 | ✅ |
| Learn | `docs/incidents/` 事故复盘 | ❌ 人写 |
| Improve | `docs/decisions/` | ⚠️ 闭环内自动，闭环外人写 |
| Experiment | `loops/` 内置前后对比；`dispatcher` 影子模式已切生产模式，不再跑影子 | ⚠️ |
| Gate | `gates/check.py`（CI ＋ pre-commit ＋ 服务器巡检，G17） | ✅ |
| Rollback | 数据库快照（`workflows/db-snapshot`）＋ Checkpoint ＋ systemd 可重启 | ✅ |

Learn 与 Improve 的自动化**已定不做**，理由见 `docs/specs/006-learn-improve.md`——
不是忘了，是想清楚后决定由人来跑这两环。
