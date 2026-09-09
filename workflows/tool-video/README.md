# workflows/tool-video · 给工具出双人对话讲解片

一轮做一件事：**挑一个还没有讲解、但有人用的工具，出一条男女双人对讲的讲解片，
上架，回查，把稿子和链接私信给站长。**

片子长什么样、必须满足什么，写在 **`docs/specs/003-tool-video-standard.md`**（标准）。
这里只讲这条产线怎么跑、怎么判它死活。

```bash
python3 run.py                    # 按规则挑 1 个（cron 走这条）
python3 run.py --slug pdf-converter   # 指定工具（已有讲解的也会重做，旧片自动删）
python3 run.py --limit 3
python3 run.py --no-publish       # 只出片不上架，产物留在 MEDIA_DIR
python3 run.py --self-test        # 不调模型，渲一条 48 秒样片，验证渲染链路还活着
```

## 产出

- 成片：`/srv/gooday-harness/media/tool-video/<slug>/<slug>.mp4`
- 上架后：`uploads/tools/<工具名>/讲解.mp4`，并写进该工具的 `VideoUrl`
- 稿子与验收结果：`/var/lib/gooday-harness/evidence/tool-video/`
- 进度：`/var/lib/gooday-harness/state/tool-video/progress.json`
- 日志：`/var/log/gooday-harness/tool-video.log`

## 依赖

- **运行库**（读工具列表、签 JWT）在 docker 卷里，只有 root 读得到 →
  cron 里是 `# runas: root`。
- **claude 凭据**（写稿）靠 `HOME=/home/agent` 指过去：凭据是同一个物理文件，
  **绝不复制第二份**——OAuth 的 refreshToken 会轮换，两份副本各自刷新会互相顶掉。
- 手动以 agent 身份跑时用 `TOOLVIDEO_DB=<可读的库>` 覆盖库路径。
- edge-tts（配音，一男一女两个音色，各带一个备用音色）
- Playwright / chromium（渲染）、ffmpeg（音乐合成、混音、合片）、Pillow（成片抽查）

## 判据（可证伪）

1. **有待处理工具时，每周至少出一条。** 连续两周日志里没有"✅"= 这条线停了。
2. 成片能被 ffprobe 读出音视频两条流，时长 ≥ 60 秒（上限 20 分钟只是跑飞保护）。
3. **成片抽查五个时刻，字幕区必须真有字**（`render.verify_frames`）。
   这条是拿命换的：曾经 ffmpeg 返回 0、时长也对，但画面一路飞到片尾定格，
   声音在讲第三段——只验返回码完全看不出来。
4. 上架后回查线上：详情接口认它、静态直链 206 支持 Range。回查不过整体撤回。
5. **90 天内播放数仍为 0 的片子**，说明这条线在自嗨——该停或该改形态。

## 停摆判定

**判活看产物 mtime，不看日志**（日志会骗人：权限警告顶掉真因，只剩 rc=1）。

- `/srv/gooday-harness/media/tool-video/` 最新目录超 **14 天**没更新，且站上仍有
  "有人用但没讲解"的工具 → 这条线死了。
- 每周日的 `--self-test` 是专门的哨兵：主任务一周才跑一次，
  渲染链路（chromium / edge-tts / ffmpeg）哪天坏了，不自检就要等到下周一才发现，
  而那时看到的错会被当成"这个工具不好写"。

## 演练

- [x] **外部依赖失败能区分"该等"和"该换"**：edge-tts 主音色失败立刻换备用音色；
      主备都失败判外部故障、停这一轮并私信告警，不退避空转。
      模型凭据/额度类错误同样立刻停轮（`is_infra_error`），不当成"今天写得不好"。
- [x] **中断后幂等续跑**：只处理 `VideoUrl` 为空的工具，
      已有讲解的一概不碰（人工换过的片子不会被自动覆盖）；
      同一工具连挂 3 次拉黑，要重试得显式 `--slug`。
- [x] **失败不留半成品**：上架后回查不过 → 撤字段 + 删文件；
      重做时先验新片再删旧片，不会出现"有讲解按钮点开是空的"。

## 为什么写稿这一步不让模型直接写画面

模型只填结构化字段（板块类型 + 文案），HTML 在 `render.py` 里。
一是排版会一集一个样，二是把不可信文本原样插进页面是另一回事。
文案还要过三道闸（事实/口径/深度），不过闸整篇拒收——
**宁可这一轮不出片，也不出一条吹牛或注水的**。见 `writer.py`。
