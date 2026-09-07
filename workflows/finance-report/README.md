# finance-report —— 月度财务报表

每月 1 号 09:30 出上月财务汇总。

## 判据
```bash
python3 workflows/finance-report/run.py
```

## 频率是【推定的】
按旧日志唯一一次写入（2026-09-01 09:30）推为 `30 9 1 * *`。
root crontab 读不到，请核对。
