# 002 · 已知缺口（骨架阶段）

> 2026-09-07 · 灵犀架构复核后记录 · 状态：**待填，不是 bug**

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

## 缺口四：`.env` 与凭据尚未设计

旧系统的 `.env` 含 `JWT_SECRET` 等，是单点。新骨架还没定：
凭据放哪、怎么轮换、多个服务怎么共享而不产生"两份副本各自刷新互相顶掉"的问题
（旧系统在 Claude OAuth 凭据上真踩过这个）。

---

## 缺口五：H 层与 C 层是空的

`policies/{H,C}/` 和 `evolution/gates/rules/{H,C}/` 只有 `.gitkeep`。
两个 kit 的规范尚未接入，也尚未与 G 层做**去重**——
`harness-kit` 的 H03「禁止静默吞错」和 `ai-company-kit` 的 C09「异常必给回执」
是同一件事的两种说法，接入时必须合并到一处。

---

## 优先级

1. ~~缺口一~~ ✅ 已闭合（2026-09-07）
2. **缺口三的 nginx 部分** —— 迁移时会当场炸，现在排第一
3. 缺口二（Learn/Improve 自动化）—— 可以先由人跑
4. 缺口四、五 —— 迁入代码前解决即可
