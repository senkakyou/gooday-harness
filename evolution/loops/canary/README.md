# canary —— 自检探针闭环

**它证明的是「Harness 这套机器还活着」，不是「业务在自我进化」。**
这个区分很重要：别看着 decisions/ 里每天一条 promoted 就以为业务在自我改进。
业务闭环是 [gooday-assets](../gooday-assets/README.md)。

## 它做什么

每天在**这台机器的真实环境**里把 hello-harness 的解析器闭环跑一轮：
从 3/10 通过开始，走完 Evaluate→Learn→Improve→Experiment→Gate→Promote，
留下 Decision 与 Checkpoint。

## 为什么需要它

CI 里绿不代表服务器上行：凭据、Python 版本、`$GOODAY_HARNESS_STATE` 的权限、
磁盘满没满 —— 这些只有在真机上才暴露。
**闭环最危险的状态不是不转，是以为它在转。**

## 每轮从头开始，是刻意的

每轮都重建 `Parser()`，不继承上一轮的成果。否则收敛之后它每天只会报一句
`no_change_needed`，那样探针就**只测到了 Evaluate 一环**，
Promote / Checkpoint / Rollback 全都没被走过。

## 判据

```bash
python3 workflows/evolve/run.py     # 本闭环应报 promote:promoted
```

## 明确不做

不碰任何真实业务数据。它的 Subject 是 `examples/hello-harness` 里的解析器，
与 Gooday 的库、文件、用户完全无关。
