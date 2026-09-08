# 002 · 已知缺口（骨架阶段）

> 2026-09-07 灵犀架构复核后记录 · **2026-09-08 状态：多数已填平**
>
> 各条现状看它自己那一行的勾选；未勾的仍然成立。
> 「缺口三：迁移期的共享命名空间」记的是当时处境——迁移已于 2026-09-07 收尾，
> 但 crontab / nginx / systemd 是共享命名空间这件事本身没变，
> 下次再做类似切换仍然适用。

把缺口写下来，比让它在迁移时才被发现强。每条都注明**它会怎么坏**。

---

## ~~缺口一：六样留痕只有三样有写入方~~ ✅ 2026-09-07 已闭合

G07 要求 Task / Event / Evidence / Evaluation / Decision / Checkpoint。现状：

| 留痕 | 有没有人写 |
|---|---|
| Evidence / Evaluation | ✅ `evolution/evaluators/_template/evaluate.py` |
| Decision | ✅ 人工写 `docs/decisions/` |
| Checkpoint | ⚠️ 只有 `install.sh` 备份 crontab 一处 |
| **Task** | ✅ `packages/trace` |
| **Event** | ✅ `packages/trace` |

**已闭合**：新增 `packages/trace`（零依赖，16 项自测全过），
G07 增加运行期实证——`.trace-failure` 标记非空、或 tasks/events 为空、
或超过 7 天没有新记录，一律 ERROR。

实测验证：造一个「目录建好但没人写」的空证据链，G07 报 2 个 ERROR；
用 trace 真写一条 Task+Event 后转绿。**这条从此不再是「检查有没有放证据的地方」。**

遗留：现在只有 trace 库本身在写，业务代码迁入时必须真的用它——
否则运行期检查会在部署后第 8 天开始报红（这是设计如此，不是 bug）。

---

## 缺口二：第二层循环缺 Learn 与 Improve 的执行体

`evaluators/`（Evaluate）和 `experiments/`（Experiment）有模板，
`gates/`（Gate）有实现，但中间两环只有文档没有代码：

- **Learn**：Evaluation 判 fail 之后，谁把原因归档成经验？现在靠人写 incidents。
- **Improve**：谁根据归档提出改动方案？现在靠人写 Decision。

骨架阶段这样是可以的（人来做这两环），但**必须承认它现在不是自动的**——
说"系统会自我进化"而这两环是人在跑，是自欺。

---

## 缺口三：迁移期的共享命名空间

路径已隔离（`/var/lib/gooday-harness/` 等），但这三样**是全机共享的**：

| | 风险 | 现状 |
|---|---|---|
| crontab | 整份替换会抹掉旧系统 11 个任务（含证书续期） | ✅ 已改为托管块，块外原样保留 |
| nginx | 见下 | ✅ 已处理（2026-09-07） |
| systemd | 服务名冲突 | ✅ 前缀 `gooday-harness-` 已隔离 |

---

### nginx 的真实情况（比"冲突"严重）

实测发现**宿主机根本没有 nginx**（`systemctl is-active nginx` → inactive）。
nginx 跑在容器 `gooday_nginx` 里（host 网络模式），配置来自
`/opt/gooday/nginx/conf.d` 的 bind mount，已占 **80/443** 与
`www.gooday.ltd gooday.ltd`。

原 `install.sh` 往 `/etc/nginx/conf.d/` 写 —— 写入成功、脚本全绿、**零效果**。
比冲突更难发现，因为什么都不报。

已改为：

1. 装进本项目自己的 `/opt/gooday-harness/nginx/conf.d/`
2. **装前预检**端口与 server_name 冲突（实测能识别 443 与两个 server_name）
3. **装后验证生效**——没有任何 nginx 在读该目录时，明确打印「当前不生效」
   而不是假装成功
4. 教训固化为 **G08 部署必须验证生效**（已实测：在修复前的代码上会红）

**迁移期这是预期状态**：旧系统的 `gooday_nginx` 仍独占 80/443，
新配置写好但不生效。真正切换时才把本目录挂进 nginx 容器——
那一刻是单点切换，两套 nginx 不可能同时持有同一端口。

---

## ~~缺口四：`.env` 与凭据尚未设计~~ ✅ 2026-09-07 已闭合

**已闭合**：设计见 `docs/specs/004-secrets-and-config.md`。

要点：密钥与配置**分离**（旧系统混在一个 .env 里，导致配置进不了版本库、
失去单一真源）；`.env.example` 进版本库声明需要哪些密钥但不含真值；
大模型凭据是单点且**绝不复制成多份**（OAuth refreshToken 轮换会互相顶掉）。
新增 policies **G18 密钥声明** 自动检查，实测在塞入真值时会红。

遗留（写在 spec 004「尚未决定」）：`JWT_SECRET` 的**轮换流程**没设计过，
迁 bot 前必须定；全局配置与模块配置的边界也还没划清。

---

## ~~缺口五：H 层与 C 层是空的~~ ✅ 2026-09-07 已闭合

**已闭合**：去重与接入决策见 `docs/specs/005-policy-layers.md`。

**5 条被 G 层吸收，不接入**：H03→C09、H05→G02、H06→G01、H09→G05、H11→C19。
**4 条现在接入**：H01（入口 ≤150 行）、H08（提交带验证证据）、
C13（systemd 重启策略）、C14（cron 环境）。
**其余暂不接入**：C01–C12/C18 是 bot 业务规范，`services/` 还没有成员——
接进来只会是一堆永远 SKIP 的规则，而永远 SKIP 会让人对 SKIP 脱敏。

原则：**规范跟着被管的东西走，不跟着「清单要填满」走。**

---

## 缺口六：上传白名单与 MIME 注册不一致（迁入应用时发现）

`Program.cs` 只注册了 7 种 MIME（epub / srt / lrc / z01-03 / apk），
但上传白名单允许 **.7z / .bat / .rar / .aac** 等类型。

**这四类传上去会 404**——和当年 `.epub` 那个坑同款：
`UseStaticFiles` 只服务内置 MIME 列表里的扩展名，未注册的一律 404。
文件传上去了、数据库有记录、页面列得出来，**点下载才 404**。

目前没有这些类型的文件，所以是潜在风险不是当前故障。
由 policies G15 每次检查时提示，迁入应用后一直显示为 26 条 WARN。

**修法**：要么给这些扩展名注册 MIME，要么从上传白名单里去掉。
两者必须一致——**允许上传却服务不了，是最糟的组合**。

---

## 优先级

1. ~~缺口一（Task/Event 无写入方）~~ ✅ 已闭合
2. ~~缺口三 nginx~~ ✅ 已闭合
3. ~~缺口四（密钥与配置）~~ ✅ 已闭合
4. ~~缺口五（H/C 接入）~~ ✅ 已闭合
5. **缺口二（Learn/Improve 自动化）—— 已定不做，见 spec 006**
6. **缺口六（上传白名单 vs MIME）—— 潜在 404，非当前故障**

剩余的两条遗留（不是缺口，是明确的待办）：

- `JWT_SECRET` 轮换流程（spec 004）——迁 bot 前必须定
- C01–C12/C18 等迁 `services/` 时接入（spec 005）
