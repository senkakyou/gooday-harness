# client-summary —— 每日客户小结

每天 02:00 为每位客户生成/更新一段小结，写回后台。调 Claude CLI 产出正文。

## 判据

```bash
python3 workflows/client-summary/run.py   # 输出「完成：更新 N 位，跳过 M 位」
```
单个客户失败不中止整轮，会记 `❌ 客户 X 失败`，这是设计如此 ——
一位客户的数据异常不该让其余人都没有小结。

## 依赖

- `JWT_SECRET`：cron 里 `source .env`；脚本自带 .env 直读兜底，**取不到就中止**
  （原来缺失时拿空串签名，每个请求 401 而日志看起来正常）
- Claude CLI 凭据（以 root 跑，用 drop-in 提供的凭据）
