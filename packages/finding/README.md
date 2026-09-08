# finding —— 发现的分类与聚合

`workflows/patrol` 与 `workflows/coo-patrol` 共用。抽出来的理由是它被 ≥2 处用到
（`packages/` 的判据），而不是"看起来该抽"。

## 它解决什么

2026-09-08 之前两个巡检有**两条互不相通的输出路径**：patrol 的发现进 `events/`，
coo-patrol 的只进一条发给站长的消息。谁也看不见谁 ——
第二层循环对 coo-patrol 那 8 项业务检查完全是瞎的，patrol 的退避与升级也管不到。

**可见性是基础设施问题，不该由「这条给人看还是给机器看」来决定。**
所以证据流统一，处置策略靠事件上的 `disposition` 字段区分：
**混的是存储，不是处置。**

## 两件事

| | |
|---|---|
| `classify(kind)` | 查 `ops/dispositions.json`，返回 `(disposition, known)` |
| `Aggregator` | 同指纹在窗口内合并计数，不每次新开事件 |

### disposition 为什么外置

由发现方自己打标，等于把「什么该人管」的判断权交给发现方，标错了就静默漏掉。
表在 `ops/dispositions.json`，可审、可 diff、可被门禁检查。

**不在表里的一律 `notify-only`——向人判断的方向失败。**
默认 `auto` 意味着对没想过的情况自动动手，那是最危险的一边。
但默认安全不等于可以不管：`known=False` 时调用方必须另报一条 P2，
否则「外置可审」会退化成「外置但没人维护」。

规则表**读不到时同样全部按 notify-only**——表坏了不能变成「全部自动处置」。

### 聚合的必要性有实测支撑

334 条 finding 只有 **60 个不同指纹**，重复最多的一条出现了 **87 次**
（同一个 P0 每 5 分钟报一次，直到它被修掉）。
notify-only 全量落而不聚合，`events/` 自己会变成噪音源，patrol 反而更瞎。

指纹用 `check + what`，不用整个 payload：`why` 里常带时间和计数
（「已 5.9 小时未更新」），每轮都不一样，拿它算指纹等于没聚合。

## 判据

```bash
python3 packages/finding/test_finding.py
```

## 明确不做

- **不决定处置动作本身**。它只回答「这条该自动处置还是只通知」，
  真去执行的是 patrol 的动作分级与白名单。
- **不发消息**。发消息是 events 的下游 sink，不在这里。
