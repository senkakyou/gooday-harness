# workflows/evaluate · 跑所有评价器

每天 08:00 一轮，把 `evolution/evaluators/` 下每个评价器都跑一遍。

## 为什么需要它

评价器只该负责**怎么打分**，不该各自去管**什么时候跑**——
那样每加一个评价器就要加一条 cron，迟早有人忘。

更重要的是：**没有任何东西自动跑的评价器，是又一个「存在但不生效」的东西。**
和「注入防御条款写进文档三个月没进任何 bot 的 prompt」是同一个形状
（policies G17）。这个项目的全部意义就是消灭这种形状。

## 产出

- 每轮 = 一个 Task，每个评价器的结果 = 一个 Event
- 评价结果本身由各评价器写进 `/var/lib/gooday-harness/evaluations/`
- 日志：`/var/log/gooday-harness/evaluate.log`

## 依赖

- `evolution/evaluators/*/evaluate.py` —— 有目录没执行体会报 P1，
  「建了目录但没实现」等于没有
- `packages/trace`

## 判据

1. **每天必须留下一个 `evaluate` Task**——连续两天没有，说明 cron 挂了。
   由 patrol 的证据链检查间接覆盖。
2. **`evaluate_summary` 的 `failed` 必须为空**——非空说明有评价器自己挂了，
   那块从此不再被评价，而系统看起来一切正常。
3. **评价器退出码非 0 不算「跑失败」**——那是它判了 warn/fail，是正常工作。
   两者必须分清，否则真正的崩溃会淹没在噪音里。

## 停摆判定

`/var/lib/gooday-harness/evaluations/` 最新文件超过 48 小时未更新 = 停摆。
判活看**产物**，不看日志——日志会骗人。
