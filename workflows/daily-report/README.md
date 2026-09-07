# daily-report —— 灵犀日报

每天 09:00 汇总工单/项目/财务，发一份日报。

## 判据
```bash
python3 workflows/daily-report/run.py     # 末行 [lingxi-daily] 日报发送 ✅
```

## 依赖
`JWT_SECRET`（同 client-summary，缺失即中止而非静默 401）。
