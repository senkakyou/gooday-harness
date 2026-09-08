# math-episodes —— 奇妙数学动画产线

面向 8-10 岁的数学动画讲解：SVG 逐帧 + Playwright 截图 + edge-tts 配音，成片上架。
每天 02:00 出 20 集（选题池取完自动停）。

## 构成（整条产线一起迁，不是只搬入口）

| 文件 | 职责 |
|------|------|
| `run.py` | 调度：挑下一集、去重、交给 build |
| `math_pool.py` | 选题池 + 已完成清单 |
| `math_episodes.py` | 集目定义 |
| `math_engine.py` | SVG 动画外壳 |
| `math-build.py` | 出片：渲染 + 配音 + 上传 |

## 判据

```bash
python3 workflows/math-episodes/run.py 1 --no-publish   # 出 1 集不发布
```

## 迁移时改的路径

- 集 spec：`scripts/data/math-specs` → `/var/lib/gooday-harness/state/math-episodes/specs`
  （产物不进版本库，G01）
- 上传目录：`src/GoodayTools/wwwroot/uploads` → `/srv/gooday-harness/media/uploads`
- `.env` → `/opt/gooday-harness/.env`

## 以 agent 身份跑
产线要调 claude CLI，用的是 agent 的凭据。`# runas: agent` 不能改成 root，
否则模型调用会失败（凭据不在那儿）。

## 明确不做
不重复出已完成的集 —— 去重同时看 `math_pool.DONE` 和 specs 目录里已有的编号。
