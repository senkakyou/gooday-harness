# hello-harness —— 自我进化闭环的最小可运行演示

**这是整个 harness「会不会真的自我进化」的判据。**
不需要读文档、不需要大模型、不需要连生产，一条命令看它自己变好：

```bash
cd examples/hello-harness && python3 run.py --loop 6
```

```
=== hello-harness：10 条用例，最多 6 轮 ===
  第1轮 ⬆️ promote:promoted  通过率 30% → 70%  规则: arabic,chinese
  第2轮 ⬆️ promote:promoted  通过率 70% → 90%  规则: arabic,chinese,strip_unit
  第3轮 ⬆️ promote:promoted  通过率 90% → 100% 规则: arabic,chinese,strip_unit,chinese_unit
  第4轮 ✅ evaluate:no_change_needed  通过率 100% → 100%

✅ 已收敛：100% 通过，无需再改
```

## 任务本身（刻意选得很小）

`task.py` 是个数量解析器：把「3」「三」「3个」「三个」「３」解析成整数。
初始只认阿拉伯数字，10 条用例过 3 条。

任务小是**故意**的 —— 演示的是闭环机制，不是解析器有多聪明。
用例、失败分类、候选策略全部一目了然，
这样谁都能核对「它到底是真在学，还是在假装」。

## 一轮里实际发生了什么

| 环 | 文件 | 干了什么 |
|----|------|---------|
| Run | `task.py` | 拿当前规则表跑 10 条用例 |
| Evaluate | `phases/evaluate.py` | 算通过率，**记下每条失败的具体输入与期望** |
| Learn | `phases/learn.py` | 把失败归类成 `chinese_numeral` / `arabic_with_unit` … 结构化经验 |
| Improve | `phases/improve.py` | 经验类型 → 候选规则，每个带 target/why/scope/risk/acceptance |
| Experiment | `task.py:variant()` | 在**隔离副本**上装规则跑一遍，不碰真身 |
| Gate | `phases/gate.py` | 三条判据：分数须**超过**基线、**已通过的用例一条都不能退化**、候选不许崩 |
| Promote | `task.py:promote()` | 过关才改真身，先存 checkpoint，改完再验一次 |

留痕落在 `$GOODAY_HARNESS_STATE`（默认 `/var/lib/gooday-harness`）：
`tasks/ events/ evidence/ evaluations/ decisions/ experience/ checkpoints/` 七样都有。
看一份 Decision 就知道**为什么改、影响面多大、风险是什么、拿什么验收**。

## 它证明了什么、没证明什么

**证明了**：Run→Evaluate→Learn→Improve→Experiment→Gate→Promote 全环有执行体，
无人介入能连转多轮、能收敛、**能正确地停下来**（`no_change_needed`）。
最后一条容易被忽略：为了「让循环转起来」而去改一个本来正常的系统，
是最容易被忽略的破坏方式。

**没证明**：真实业务上的效果。真实任务的失败分类远比这里模糊，
候选也不会来自一张固定策略表。所以 `improver` 是可插拔的 ——
换成模型驱动的实现，其余六环不用动。

**为什么不直接拿模型演示**：那样 CI 就验不了它。
验证不了的闭环，就是又一个「写了但不知道有没有在起作用」的东西 ——
而那正是这个项目反复栽过的坑。

## 判据（CI 与 Runtime Patrol 都查这条）

```bash
python3 run.py --loop 6        # 退出码 0 = 收敛到 100%；非 0 = 闭环坏了
```

配合 `packages/evolve/test_loop.py`（13 项失败路径自测）：
**这里保证顺利时它能转，那边保证出事时它能停。**
