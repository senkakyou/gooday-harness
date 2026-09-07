> **状态：已结案（2026-09-07 迁移收尾）。**
> 实验的归宿是决策记录，所以从 `evolution/experiments/` 挪到这里 ——
> 那是扩展点，留着已完成的实验会让新人照着抄一个不再成立的判据。
> 结论与后续处置见同目录的 `003-patrol-cutover.md`。

# experiments/patrol-cutover · patrol 影子 → 生产

## 要验证的改动

把 `workflows/patrol/config.json` 的 `mode` 从 `shadow` 改成 `active`，
让新 patrol 真正开始处置（重启挂掉的服务、修复凭据属主）。

## 关联的 Decision

`docs/decisions/003-patrol-cutover.md`

## 验证方式

**影子** —— 新逻辑只算不做，与现状比对一致率。

新 patrol 已在影子模式运行，每轮写 `patrol_summary` 事件；
旧 patrol 照常处置。由 `evolution/evaluators/patrol-agreement/` 每天比对。

选影子而非灰度或前后对比的理由：巡检的处置动作（重启服务）有副作用且不可分割，
没法只对 N% 生效；而"改动前后打分对比"需要先有基线，我们现在正是在建基线。

## 通过判据

**已先写死，不许跑完再定。**

1. `patrol-agreement` 评价器连续判 `pass`——即样本 ≥2016 轮（7 天）且**零分歧**。
2. 期间 `patrol_summary` 的 `failed_checks` 始终为空
   ——有巡检项自己挂过，说明那块从未被真正覆盖。
3. 期间无 `.trace-failure` 标记——证据链断过的话，上面两条的数据都不可信。

**三条全达成才算通过。任一不达标即否决，重新分析后再开新实验。**

## 明确不在本实验范围内

**覆盖面差距**：新 patrol 2 项 vs 旧 patrol 14 项。
一致率达标只证明「共同覆盖的部分判断一致」，不证明新的可以取代旧的。
切 `active` 之后**旧 patrol 仍须继续跑**，直到新的补齐覆盖面——
那是另一个 Decision 的事。

## 失败怎么办

- 回滚点：`/var/lib/gooday-harness/checkpoints/`（install.sh 每次都备份 crontab）
- 回滚命令：`config.json` 的 `mode` 改回 `shadow`
  ——**不需要改代码、不需要重装、不需要重启任何东西**
- 回滚演练：改 `mode` 后手动跑一轮，确认输出前缀从 `[patrol/生产]` 变回
  `[patrol/影子]`，且 `action_suppressed` 事件重新出现

## 终止时间

启动后 **10 天**。到期仍未达成判据即终止本实验并写回 Decision 结论——
不许无限期「观察中」。

## 判据

1. 实验必须有明确终止时间（见上）。
2. 结论（通过/否决）必须写回 `docs/decisions/003-patrol-cutover.md`，
   **否则这次实验白做**。
