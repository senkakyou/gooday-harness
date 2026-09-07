# evolve —— 定时把注册的进化闭环各跑一轮

闭环引擎（`packages/evolve`）只负责**怎么转**，本 workflow 负责**什么时候转**。

没有它，`packages/evolve` 就是又一个「存在但不生效」的东西 ——
和「注入条款写进文档三个月没进 prompt」是同一个形状。

## 接一个新闭环

```
evolution/loops/my-loop/loop_def.py     导出 build() -> Loop
```

目录名 kebab-case（G09），`loop_def.py` 导出一个 `build()` 返回 `Loop` 实例。

**不用改本目录任何文件**（G06 扩展点契约）。递归发现，缺 `build()` 会报 P1
而不是被静默跳过。

## 判据

```bash
python3 workflows/evolve/run.py      # 退出码 0 = 所有闭环跑完且无崩溃
```

跑完后 `$GOODAY_HARNESS_STATE/decisions/` 应出现新决策。
`workflows/patrol/checks/evolution.py` 会盯着这个目录：
超过 26 小时没有新决策就报 P1 —— **「配置了备份」和「备份在跑」是两件事**，
闭环同理。

## 当前注册的闭环

| 名字 | 是什么 |
|------|--------|
| `canary` | 自检探针。跑 hello-harness 的解析器闭环，证明**在这台机器的真实环境里**七环都还能转 |

业务闭环接进来之前，canary 是唯一在转的 —— 这是诚实的状态，
不是「有业务闭环在跑」。它证明的是机器还活着，不是业务在进化。
