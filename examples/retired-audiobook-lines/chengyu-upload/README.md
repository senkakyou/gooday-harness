# chengyu-upload —— 成语时光机上传清单

每 3 天 21:00 生成一份「待传喜马拉雅」清单。**只生成清单，不自动上传** ——
喜马那边靠人工传，这个工作流负责让人知道该传什么。

## 判据

```bash
python3 workflows/chengyu-upload/run.py
```

## 明确不做
不碰音频文件本身，不调喜马 API。
