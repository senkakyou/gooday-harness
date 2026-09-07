# 规范总表

> **本表是契约**：带 `[可检查]` 的条目，必须在 `evolution/gates/rules/` 有同编号实现；反之亦然。
> 两边脱钩时 `check_rule_coverage` 会红。
>
> 立场：**一条规范如果不能被自动判定真假，它就不是规范，是愿望。**

## 分层

| 层 | 管什么 | 来源 | 能不能改 |
|---|---|---|---|
| **H** | 通用 AI 作业规范 | `harness-kit` | 尽量别改，改了就和上游分叉 |
| **C** | AI 数字公司运营 | `kits/ai-company-kit` | 同上。**它是要卖给别家的产品，不是内规** |
| **G** | Gooday 项目专属 | 自己踩出来的 | 随时加，事故驱动 |

**不重复原则**：同一件事只在一层出现。
H03「禁止静默吞错」和 C09「异常必给回执」是同一件事的两种说法——
接入时必须合并到一处，不能两层各留一条。

---

## 什么该外包，什么必须自己写

**这是本项目最容易犯的错**：手搓通用检查器。别干。

| 关注点 | 交给 | 为什么不自己写 |
|---|---|---|
| 密钥泄露 | **gitleaks**（pre-commit）+ **TruffleHog**（CI，带验证） | 手写正则会把「检测器自己的正则」当成命中——本项目真实踩过 |
| 静默吞错 / 危险模式 | **Semgrep** | AST 感知，不是 grep；`except: pass` 在收尾代码里是正当的，grep 分不出来 |
| 大文件入库 | **pre-commit** `check-added-large-files` + git-lfs | 一行配置的事 |
| 代码风格 | ruff / eslint | — |

`checks/` **只写现成工具不可能知道的规则**——状态机语义、心跳约定、
本项目的血泪。那才是资产。

> 环境约束：本机 2G 内存。gitleaks + pre-commit 放本地（轻），
> Semgrep / TruffleHog 只在 CI 跑。

---

## G 层 · 结构规范（骨架成立的前提）

### G01 五类分离 `[可检查]`

代码、配置、规范、状态、产物各有其位。**状态和产物不得出现在仓库内。**

| 类别 | 位置 | 进 git |
|---|---|---|
| 代码 | `services/` `pipelines/` `packages/` `checks/` | ✅ |
| 配置 | 随服务/产线走（`*/deploy/`）+ 全局 `ops/` | ✅ |
| 规范 | `policies/` `docs/` | ✅ |
| **状态** | `/var/lib/gooday-harness/state/` | ❌ 可重建 |
| **日志** | `/var/log/gooday-harness/` | ❌ 滚动 |
| **产物** | `/srv/gooday-harness/media/` | ❌ 体积大 |
| **备份** | `/srv/gooday-harness/backups/` | ❌ 运行期数据 |

> 教训：上一版把心跳文件、`*-state.json`、22 个日志、1.2G 媒体、580M 数据库快照
> 全塞在代码目录和版本库里。`.git` 涨到 491M，`scripts/` 平铺 100 个文件，
> 清理时分不清哪些能删——**因为它们本来就不该在一起**。

### G02 目录即契约 `[可检查]`

`services/` `pipelines/` `packages/` 下每个成员必须有 `README.md`，且含「判据」章节，
判据必须可证伪。`_template/` 与 `_shared/` 这类下划线开头的不是成员，不查。

| ❌ 不算判据 | ✅ 算判据 |
|---|---|
| 让工具更好用 | 90 天内被打开 ≥1 次，否则下架 |
| 内容更丰富 | 每天出片 ≥20 集，连续 7 天失败率 <5% |

> 写不出判据的模块，说明你不知道它算不算成功——那它凭什么存在。

### G03 单一真源 `[可检查]`

**「单一真源」不等于「集中存放」。**

配置跟着**归属方**走，且只有那一份：

| 配置 | 归属 |
|---|---|
| 服务 unit / drop-in | `services/<名>/deploy/` |
| 产线 cron 片段 | `pipelines/<名>/deploy/` |
| 全局（nginx 等） | `ops/nginx/` |

集中存放（所有 `.service` 塞进 `ops/systemd/`）反而制造问题：
新增成员必须改公共目录，而改公共目录就会漏——那是 G06 要防的事故。

**汇总产物不入库**：crontab 与 systemd 单元由 `ops/install.sh` 从各归属方汇总生成，
版本库里再留一份必然与真源分叉。

**禁止手工 `.bak` 版本备份**——版本库本身就是干这个的。

> 教训：上一版 `scripts/` 里有 `crontab.bak`、`crontab.bak.20260811`、
> `crontab.bak.20260814` 三份，没人知道哪份是真的。

### G04 部署可重建 `[可检查]`

`ops/install.sh` 必须对扩展点做**通配扫描**（`services/*/deploy`、`pipelines/*/deploy`、
`ops/nginx/*`），**永远不列举成员**。它还必须创建仓库外的四个位置（G01）。

与 G06 的分工：**G06 查成员符不符合模板，G04 查安装脚本认不认得新成员。**

> 教训：`claudecred.conf` 已在服务器上生效，但安装脚本只写死装 `memorymax.conf`。
> 一旦重装，bot 退回读失效凭据，表现是「活着但答不出话」，心跳和 systemd 全绿。

### G05 规范必须可执行（元规范）`[可检查]`

`policies/` 每条 `[可检查]` 条目在 `evolution/gates/rules/` 有实现；反向亦然。

> 教训：提示词注入防御条款写进文档三个月，**一个 bot 的 prompt 里都没有**。
> 没有检查器的规范，就是一份没人读的文档。

### G06 扩展点契约 `[可检查]`

**新增一个成员 = 复制一个模板目录，不改部署脚本、不改公共代码。**

已知的三处例外（2026-09-07 复核实测）：`policies/00-index.md` 登记（契约本身）、
`ops/nginx/`（对外暴露 HTTP 时）、`.env`（新环境变量）。
**声称"零改动"是不诚实的**——把例外写明，比让人自己撞上强。

五个扩展点，每个自带 `_template/`：

| 扩展点 | 新增方式 | 成员必须有 |
|---|---|---|
| `services/` | `cp -r services/_template services/<名>` | `README.md`、`deploy/unit.service` |
| `pipelines/` | `cp -r pipelines/_template pipelines/<名>` | `README.md`、`deploy/schedule.cron` |
| `packages/` | `cp -r packages/_template packages/<名>` | `README.md` |
| `policies/{H,C,G}/` | 丢一个 `.md` 进去 | 条目登记进本表 |
| `evolution/gates/rules/{H,C,G}/` | 丢一个 `.py` 进去 | `RULE` / `TITLE` / `check(ctx)` |

**部署配置随服务走，不集中放**——`services/<名>/deploy/` 而不是 `ops/systemd/`。
`ops/install.sh` 只做通配扫描，永远不列举成员。

> 教训：上一版新增 drop-in 必须手工改安装脚本。结果 `claudecred.conf`
> 在服务器上生效了、脚本没同步，重装即静默丢配置——bot「活着但答不出话」，
> 心跳和 systemd 全绿。**根因不是忘了改，是结构要求你记得改。**

### G07 改动可追溯 `[可检查]`

**没有证据不许改。** 任何自动改动必须留下六样：

| 留痕 | 落在哪 |
|---|---|
| **Task** 这次要干什么 | `/var/lib/gooday-harness/tasks/` |
| **Event** 过程中发生了什么 | `/var/lib/gooday-harness/events/` |
| **Evidence** 凭什么这么判 | `/var/lib/gooday-harness/evidence/` |
| **Evaluation** 打了几分、为什么 | `/var/lib/gooday-harness/evaluations/` |
| **Decision** 决定改什么、谁批的 | `docs/decisions/`（**进版本库**） |
| **Checkpoint** 改之前的可回滚点 | `/var/lib/gooday-harness/checkpoints/` |

**结构齐全 ≠ 证据存在。** G07 还做运行期实证：`tasks/`、`events/` 为空，
或超过 7 天没有新记录，或存在 `.trace-failure` 标记，一律 ERROR——
只查「有没有放证据的地方」是不够的，那正是凭据失效三周无人发现的形状。
写入方是 `packages/trace`（零依赖）。

配套：每个实验必须关联一个 Decision 并写明回滚点；
每个评价器必须说明 Evidence 来源——没有证据的评价是拍脑袋，
用它驱动改进只会放大噪音。

> 教训：2026-09-07 踩的每个坑都是「发生了但没留痕」。凭据 8/25 就失效，
> 三周无人发现；drop-in 装上了但脚本没记，重装即丢；注入条款写了三个月
> 没进任何 prompt。**可追溯不是审计需求，是自我迭代的前提**——
> 你没法改进一件你看不见的事。

---

## G 层 · 项目规范（踩出来的，现成工具不可能知道）

| # | 规范 | 检查 | 换来它的失败 |
|---|---|---|---|
| **G10** | 输入框字号 ≥16px | `[可检查]` | iOS Safari 点击 <16px 输入框会自动放大整页，发送按钮被挤没 |
| **G11** | 全屏浮层 z-index ≥1000 | `[可检查]` | 阅读器 z100 被 BottomTabBar z200 盖住，自己的控制条整条不可见 |
| **G12** | C# 字符串禁用 `>=` / `<=` | `[可检查]` | 编译报 CS0019；SQLite TEXT 列比金额要 `CAST(x AS REAL)`，直接比是字典序，`"9" > "10"` |
| **G13** | edge-tts 音色须在探活白名单内 | `[可检查]` | 用了已下线音色 → 43 段永久 0 字节，而重试逻辑把它当限流，空转一小时等一个永不会来的窗口 |
| **G14** | cp 数据库前必须 WAL checkpoint | `[可检查]` | WAL 模式下写入先落 `-wal`，直接 cp 主文件会丢数据 |
| **G15** | 新静态扩展名必须注册 MIME | `[可检查]` | `UseStaticFiles` 只服务内置 MIME 列表，`.epub` 传上去了但一拉就 404，整页白屏 |
| **G16** | effect cleanup 读 ref 不读 state | 人工 | 依赖数组小时 cleanup 闭包捕获首帧 state，退出时把真实进度覆盖成 0% |

---

## 加一条规范的流程

1. 先想清楚**检查器怎么写**。写不出来的，要么改写成能检查的形式，要么标「人工」
   并在 `ops/runbooks/` 给它一个端到端验收动作。
2. 规范进 `policies/`，检查器进 `evolution/gates/rules/`，同一个提交。
3. **新检查器必须在修复前的代码上会红**——在坏代码上也不报警的检查器，等于没写。
