# Gooday Harness

一个会**改进自己**的系统骨架。

它是 Gooday 数字公司的新架构，同时是一套可以被别人拿走用的工程规范
——因为规范的每一条都配了能自动跑的检查器，而不是写在文档里等人自觉。

> **状态：已接管生产（2026-09-07 切换）。**
> 9 个 services（5 个 bot ＋ dispatcher ＋ ocr ＋ api ＋ web）、14 条 workflows、
> 4 个 packages、2 条进化闭环在跑。旧 Gooday 已封存为 `/opt/goodayback`，不再接流量。
>
> 尚未闭合的：`evolution/evaluators/` 与 `evolution/experiments/` 只有模板、
> **零个真实成员**——第二层循环的 Evaluate/Experiment 两环目前是空跑。
> 缺口清单见 `docs/specs/002-known-gaps.md`。

---

## 它解决什么

大多数系统能把事做完，但不会变好。做完就结束了——
没人回答"刚才那次做得怎么样"，失败的原因散在日志里没人捡，
改进靠人拍脑袋，改错了也没有退路。

Gooday Harness 强制系统跑**两个循环**：

```
第一层 · 执行     Task → Context → Plan → Execute → Verify → Result
                                                        │
第二层 · 进化     Evaluate → Learn → Improve → Experiment → Gate → Promote/Rollback
```

第二层是重点，也是市面上普遍缺的一环。执行层已经有成熟选择
（LangGraph、CrewAI、各家 SDK），工具与通信层已被 MCP / A2A 标准化——
**框架本身正在变成可替换的胶水**。所以这里不做另一个 Agent 框架，
只做**能挂在任何执行层之上的自我迭代层**。

## 三条设计立场

**一、规范必须能被自动判定真假。**
不能判定的不是规范，是愿望。`policies/` 里每条标 `[可检查]` 的条目，
在 `evolution/gates/rules/` 必须有实现，两边脱钩时检查器自己会红。

**二、每条规范都附换来它的那次失败。**
教条抄不出好规范。你觉得某条多余时，先看它下面那段事故——
`.git` 涨到 491M、凭据失效三周无人发现、43 段音频永久静音，都在里面。

**三、没有证据不许改。**
任何自动改动必须留下 Task / Event / Evidence / Evaluation / Decision / Checkpoint。
可追溯不是审计需求，是自我迭代的前提——你没法改进一件你看不见的事。

## 快速开始

```bash
python3 evolution/gates/check.py .        # 看基线
cat AGENTS.md                             # 索引不是手册，上限 150 行
cat policies/00-index.md                  # 规范总表（契约）
```

新增任何东西都是复制模板，不改现有文件。**六个扩展点**，各自带 `_template/`：

```bash
cp -r services/_template              services/<名>
cp -r workflows/_template             workflows/<名>
cp -r packages/_template              packages/<名>
cp -r evolution/loops/_template       evolution/loops/<名>
cp -r evolution/evaluators/_template  evolution/evaluators/<名>
cp -r evolution/experiments/_template evolution/experiments/<名>
sudo bash ops/install.sh                  # 装上——不需要改这个脚本
```

## 目录

| | |
|---|---|
| `services/` `workflows/` `packages/` | 第一层：执行 |
| `evolution/{loops,evaluators,experiments,gates}/` | 第二层：进化 |
| `policies/{H,C,G}/` | 规范三层：通用 / 数字公司 / 本项目 |
| `ops/` `docs/` `examples/` `content/` | 部署、文档、示例、创作源 |

`evolution/gates/` 形状与其他三个不同——它是**一个工具**（`check.py` ＋ `rules/{H,C,G}/`），
不是成员集合，所以没有 `_template/`。

运行期数据全在仓库外：`/var/lib/gooday-harness/`、`/var/log/gooday-harness/`、
`/srv/gooday-harness/`。**状态、日志、产物、备份一律不进版本库**——
上一版就是栽在这条上，2.8G 仓库里 1.2G 是媒体、580M 是数据库快照。

## 判据

这套东西自己也得能被判死刑：

1. 接入后 30 天内，至少一次 CI 因规范检查变红并被真正修复
   —— 一次没红过，说明检查器太松，等于没接。
2. 每次事故后 7 天内，`policies/` 增加一条可检查的规范
   —— 事故没转化成规范，说明复盘走过场。
3. 每条规范都能指出换来它的那次具体失败
   —— 指不出来的，说明是抄来的教条，应当删除。

任一连续两个季度不达标，**这套东西应当被废弃或重做**。

## 许可

MIT，见 [LICENSE](LICENSE)。
