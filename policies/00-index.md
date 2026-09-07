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
| **对所有服务相同的 drop-in** | `ops/dropins/` |

集中存放（所有 `.service` 塞进 `ops/systemd/`）反而制造问题：
新增成员必须改公共目录，而改公共目录就会漏——那是 G06 要防的事故。

**但归属方是「集合」时例外**：大模型凭据的 drop-in 对每个调模型的服务
内容完全相同，随服务走就是 N 份真副本，改一次要改 N 处。
这时它的归属方不是某个服务，而是「所有需要它的服务」——
所以放 `ops/dropins/`，由 install.sh 装给全部服务。
判据仍然成立：**那一份仍然只有一处**。

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

### G08 部署必须验证生效 `[可检查]`

**「我把东西放到了那里」不等于「那里的东西起作用了」。**

部署的每一类动作，都要有一个能证明它生效的检查跟在后面；
证明不了的，必须【明确打印「当前不生效」】——最怕的是全绿而实际没用。

> 教训：`install.sh` 往 `/etc/nginx/conf.d/` 写配置，`install` 返回 0、
> 脚本打印成功——但这台机器**宿主机根本没装 nginx**，它跑在容器里、
> 配置来自 bind mount。配置写进去了、全绿、零效果。
>
> **比冲突更难发现**：冲突至少会报错，写到没人读的位置什么都不报。
> 同一形态反复出现过：drop-in 装上但脚本没记（重装即丢，全绿）、
> 凭据失效三周（心跳/systemd/服务列表全绿）、注入条款写文档三个月没进 prompt。

### G09 命名规则 `[可检查]`

命名不统一的代价不是"不好看"，是**工具会骗你**。

| 对象 | 规则 | 例 |
|---|---|---|
| 所有路径 | **全 ASCII** | 中文写进内容，不写进文件名 |
| 扩展点成员目录 | kebab-case 小写 | `bot-lingxi`、`audiobook` |
| 模板 / 内部件 | `_` 开头 | `_template`、`_shared` |
| 规则文件 | `<层小写><NN>_snake_case.py` | `g08_deploy_verified.py` |
| Spec / Decision | `NNN-kebab-case.md` | `003-nginx-isolation.md` |
| 事故复盘 | `YYYY-MM-DD-kebab-case.md` | `2026-09-07-credential-expiry.md` |
| 部署文件 | 固定名 | `unit.service`、`schedule.cron` |

> 教训：`git ls-files` / `git diff --name-only` 默认把非 ASCII 文件名转义成
> `"docs/\345\267\245..."`。拿它和 `find` 的输出做比对时中文名全部对不上，
> **差点判定「整个 docs 目录丢了」**——实际一个都没丢。
>
> 更讽刺的是：G09 第一版被这个现象本身打败了——转义后的字符串是纯 ASCII，
> 于是「检查文件名是否 ASCII」漏掉了所有中文名。根治是
> `git -c core.quotepath=false`，已修进 `check.py` 的 `tracked()`。

### G18 密钥声明 `[可检查]`

`.env.example` 必须存在并列出全部所需密钥，**且不含任何真值**（它进版本库）。
真 `.env` 永不进版本库；服务模板的 `EnvironmentFile` 路径必须一致。

**密钥与配置分离**：配置进版本库（可 review、可回滚、是真源），密钥不进。
混在一起的话，改一个模型名也要碰密钥文件，而且「当前生效的配置是什么」
会失去单一真源——只能上服务器看。

> 密钥泄露检测交给 gitleaks / TruffleHog，不在这里造轮子。
> 本条只管【声明的完整性】——那是现成工具不知道的项目约定。
> 缺声明的后果是：新机器部署时缺键，而且**不知道缺什么**。

设计见 `docs/specs/004-secrets-and-config.md`。

### G19 配置必须被播种 `[可检查]`

有 `config.example.json` 的 workflow，`ops/install.sh` 必须负责让 `config.json` 存在；
而 `config.json` 本身不得进版本库（各机器不同）。

> 教训：install.sh 本有播种逻辑，重写 crontab 的 runas 分组时**被连带删掉**。
> 结果三个 workflow 装上了却没 config，一跑就退——而 install 全绿、cron 装上了、
> 日志里只有一行没人看的「缺 config.json」。备份因此停了几小时，
> 直到 patrol 的 config_drift 项才抓出来。
>
> 「装完了」不等于「能跑」，与 G08 同族。

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
### G17 门禁必须被自动触发 `[可检查]`

**规范 ＋ 检查器 ＋ 没人自动跑它 = 等于没有。**

必须同时有：CI 工作流调用 `evolution/gates/check.py`、pre-commit 本地钩子、
以及服务器上的定时巡检（CI 盖不到运行期实证）。

> 教训：站长问「骨架算完事了吗」，一查才发现 15 条规范和一个检查器
> 全靠人记得敲命令——既无 CI 也无 pre-commit。
> 这和「注入条款写进文档三个月没进 prompt」「drop-in 装了但脚本没记」
> 「备份配置了但没在跑」是**完全同一个形状**：东西存在，但不会自动生效。
> 本项目存在的理由就是消灭这个形状，它自己更不能犯。

> 编号说明：本条是结构规范，但 G10 之后已被项目层占用。
> **编号只增不复用**（旧号是引用锚点），所以结构层与项目层的号段不连续。
> 2026-09-07 本条初版误用了已被占的 G11，检查器现已能检测编号重复。


---

## H 层 · 通用 AI 作业规范

来源 `harness-kit`。**只接入在本仓库当前状态下真正执行的条目**——
永远 SKIP 的规则会让人对 SKIP 脱敏，真正该注意的就被淹没了。
去重与接入决策见 `docs/specs/005-policy-layers.md`。

### H01 上下文入口 `[可检查]`

仓库根必须有 `AGENTS.md`，且**不超过 150 行**。它是索引不是手册——
一旦膨胀成几百行，AI 每次都要整读一遍，分层就失效了。

### H08 提交必须带验证证据 `[可检查]`

提交信息里要能看出**用什么验的**：跑了什么命令、看到什么输出、
哪个判据达成了。「应该没问题」不是证据。

> 本项目反复栽在「以为验过了」上：复验时进程跑的还是旧代码、
> 静态检查全绿而系统跑不起来、检查器在坏代码上也不报警。
> **没有证据的「已验证」等于没验证。**

### 已被 G 层吸收，不接入

H03（禁止静默吞错）→ C09 ｜ H05（可证伪判据）→ G02 ｜
H06（二进制不入库）→ G01 ｜ H09（规范与检查器对应）→ G05 ｜
H11（事故产出规范）→ C19。理由见 spec 005。

---

## C 层 · AI 数字公司运营

来源 `ai-company-kit`（**它是要给别家用的产品，不是内规**）。
C01–C12、C18 是 bot / 数字公司业务规范，`services/` 还没有成员，
接进来只会是一堆永远 SKIP 的规则——等迁到对应模块再接。

### C13 systemd 重启策略 `[可检查]`

必须 `Restart=always`；`StartLimitIntervalSec` / `StartLimitBurst`
必须写在 `[Unit]` 段。

> `on-failure` 时脚本「正常」退出（`return 0`）会让服务静静躺平，
> 不重启也不告警。而 StartLimit* 放进 `[Service]` 段时 systemd
> **直接忽略**，崩溃保护看起来配了、实际没生效（2026-09-07 实测踩到）。

### C14 cron 环境 `[可检查]`

crontab 必须 `SHELL=/bin/bash`；`source` env 必须用 `set -a` 包住。

> cron 默认 dash 没有 `source`，整行会**静默失败且连日志文件都不生成**——
> 只会在几天后发现「日报怎么一直没来」。而 `.env` 里没有 export 时，
> 光 source 也传不给 python 子进程。
>
> 配套人工纪律：新增 cron 后**必须等一个执行周期，确认日志文件真的出现**。

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
