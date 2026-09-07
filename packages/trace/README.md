# packages/trace · 写 Task / Event / Checkpoint

policies **G07 要求任何自动行为留下六样痕**。本库负责其中三样，
另外三样由 `evolution/evaluators/`（Evidence、Evaluation）和人（Decision）写。

没有它，第二层循环就只是画在文档里的图——
`docs/specs/002` 把这条列为**最高优先级缺口**，本包就是补它的。

## 用法

```python
from trace import Task

with Task("deliver-ticket", subject="GD-20260907-003") as t:
    t.event("analysis_done", level="P3")
    t.checkpoint("before-deploy", ["/opt/gooday-harness/services/api"])
    t.event("delivered", level="P2", payload={"files": 3})
```

正常结束自动记 `status=ok`；抛异常自动记 `status=failed` 并带异常与栈，
**异常原样往上抛，不吞**。

## 落在哪

| | |
|---|---|
| Task | `/var/lib/gooday-harness/tasks/<id>.json`，一次一个文件 |
| Event | `/var/lib/gooday-harness/events/<日期>.jsonl`，按天追加 |
| Checkpoint | `/var/lib/gooday-harness/checkpoints/<task>-<name>/` |

用 `GOODAY_HARNESS_STATE` 环境变量可改根目录（测试用）。

## 一个必须讲清楚的取舍

**追踪库写失败时不抛异常，但绝不静默。**

抛异常会让「记录失败」连累「干活失败」；静默吞则是本项目最痛恨的那种失败——
你以为有证据，实际什么都没有（凭据失效三周无人发现就是这个形状）。

所以失败时：往 stderr 打一行 ＋ 写 `.trace-failure` 标记 ＋ 巡检据此告警。
**旁路坏了不连累主干，但必须有人知道。**

## 明确不做

- **不持有业务语义**——它只记录，不判断对错。判断是 `evolution/evaluators/` 的事。
- **不做查询/聚合**——那是读侧的事，别把它长成一个数据库。
- **不引入任何第三方依赖**——它是最底层的包，被所有人依赖，不能带包袱。

## 判据

1. **近 7 天 `tasks/` 与 `events/` 必须非空**——空的说明根本没人在用它，
   那 G07 就退化成「检查有没有放证据的地方」而不是「有没有证据」。
   由 `evolution/gates/rules/G/g07_traceability.py` 自动检查。
2. **`.trace-failure` 标记必须为空**——有标记说明写入链断了，
   而追踪链断掉时系统看起来一切正常，正是最危险的状态。
3. **零第三方依赖**——`import` 只允许标准库。
