# evolve —— 第二层循环的引擎

把「自我进化」从文档变成**可运行、可验证**的代码。

在它之前，`evolution/` 只有 Gate（检查器）和 Evaluator（打分）两环有执行体，
Learn 与 Improve 是人在写文档 —— 那样说「系统会自我进化」是自欺。

## 它做什么

一轮 `cycle()` 走七步：

```
Run → Evaluate → Learn → Improve → Experiment → Gate → Promote / Rollback
```

| 环 | 输入 → 输出 | 谁实现 |
|----|------------|--------|
| Run | inputs → results | `Subject.run` |
| Evaluate | results → `{score, verdict, failures, evidence}` | 使用方 |
| Learn | evaluation → `[Experience]`（结构化，非文档） | 使用方 |
| Improve | experiences → `[Candidate]` | 使用方 |
| Experiment | candidate.patch → **隔离副本** | `Subject.variant` |
| Gate | variant + baseline → `{passed, score, reasons}` | 使用方 |
| Promote | 过关才应用，带 checkpoint | `Subject.promote/rollback` |

每个 Candidate 必须自带 `target / why / scope / risk / acceptance / patch`
—— 说不清影响面和验收指标的改动不许进实验。

## 四条设计立场

1. **闭环必须能在没有大模型时跑通**。否则 CI 验证不了它，
   而验证不了的闭环就是又一个「写了但不知道有没有用」的东西。
   Improver 可插拔：默认确定性策略库，模型驱动实现作为可选项接入。
2. **任何一环失败都进安全状态并中止本轮**。不是「跳过继续走」——
   那会让一轮空转被记成一轮成功。
3. **没有基线不许自动 promote**。「改完了没变差」和「不知道有没有变差」
   是两回事，后者一律降级为 `needs_human`。
4. **全程留痕六样**：Task / Event / Evidence / Evaluation / Decision / Checkpoint。
   不是为了审计，是因为**你没法改进一件你看不见的事**。

## 安全边界（这些不是可选项）

- 候选**只在 `variant()` 返回的隔离副本上跑**，绝不拿真身做实验。
  `variant()` 构造失败 → 中止，不会退化成「改真身试试」。
- Promote 前存 checkpoint；**promote 后再验一次**，低于基线立即回滚
  （副本与真身存在环境差异，隔离副本上过了不等于真身上没事）。
- 门禁自身崩溃**不算通过**（`gate_crashed` 报 P0）。
- 只有「门禁正常判否」才继续试下一个候选；`rolled_back` / `needs_human` /
  门禁崩溃都是终止性结论，**原样返回不被覆盖**——
  把它们压成一句 `all_rejected`，值班的人就分不出
  「按设计拒绝了」和「上线后变差已回滚」，而后者是 P0。

## 判据

```bash
python3 packages/evolve/test_loop.py        # 13 项失败路径自测，退出码 0
cd examples/hello-harness && python3 run.py --loop 6   # 成功路径：自动收敛到 100%
```

`test_loop.py` 只测**失败路径**，是刻意的：成功路径由 hello-harness 演示，
而一个只在顺利时能跑的闭环最危险 —— 它会在出事那天把坏东西 promote 上去，
然后报告说「一轮成功」。

## 用法

```python
from loop import Loop, Subject

class MyTask(Subject):
    def run(self, inputs): ...
    def variant(self, patch): ...      # 必须返回隔离副本
    def checkpoint(self): ...
    def promote(self, patch): ...
    def rollback(self, ckpt): ...

Loop("my-loop", MyTask(),
     evaluator=..., learner=..., improver=..., gate=...,
     inputs=..., min_gain=0.0).cycle()
```

完整可运行示例见 `examples/hello-harness/`。
