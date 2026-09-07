# invest-warmup —— 投资自选预热

工作日 08:05 触发一次自选股全量重算，把结果灌进缓存，让大海开盘时点开就有数。

## 为什么直连 8081 而不走 nginx
重建 140 只自选要 150~190 秒，nginx 的 150s 超时会把请求掐断。
所以直连 app 端口绕开它。

**迁移时改过：原来是 `127.0.0.1:8080`（旧 app），harness 的 api 在 8081。**
旧端口在切换后已经不通，这条不改就会每个工作日静默失败。

## 判据
```bash
bash workflows/invest-warmup/run.sh
tail -1 /var/log/gooday-harness/invest-warmup-detail.log   # 应为 OK http=200 ... items=140
```
耗时超 240 秒会额外标 `SLOW`，那是提醒不是失败。
