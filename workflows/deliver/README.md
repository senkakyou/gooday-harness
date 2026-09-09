# workflows/deliver · 把已付款工单做成客户手里的交付物

一轮做一件事：**挑一张已收款、还没交付齐的工单，把三样凑齐、上架、让如意通知客户。**
大海不介入——出问题告警灵犀，同一张单连挂两次才升级。

```
工单（已收款 + 有平台账号）
  → 生成在线版（单文件网页）      ← 人格与铁则用威震天的 prompt
  → 自动打包下载包（在线版 + 使用说明）
  → 上架成客户的私有工具          ← POST /api/admin/tools/deliver
  → 出视频讲解                    ← 调 workflows/tool-video
  → 三样齐 → 如意私信客户 → 工单可结单
```

```bash
python3 run.py                 # 挑 1 张（cron 走这条）
python3 run.py --ticket 33     # 指定工单（跳过"已收款"以外的筛选，用于重试）
python3 run.py --dry-run       # 只生成不落盘不上架，看看模型产出什么
```

## 为什么生成这一步在这里，不在 bot-weizhentian 里

它的输入是客户写的需求，**是注入的主要入口**，所以那个角色一个工具都不给（和如意同理）。
写文件必须留在确定性代码里。但人格和铁则以 `services/bot-weizhentian/prompt.md`
为**单一真源**——这里加载它，只在后面拼一段"交付物长什么样"的格式契约。
改开发口径去改那个 prompt，不要在这里另起一套。

## 产出与依赖

- 交付物：`/srv/gooday-harness/media/uploads/private/<工单号>/`（静态层一律 404，
  只能通过 `/api/tools/{slug}/online|video|download` 取，接口里查归属）
- 证据（含自检结果与失败原因）：`/var/lib/gooday-harness/evidence/deliver/`
- 进度：`/var/lib/gooday-harness/state/deliver/progress.json`
- 日志：`/var/log/gooday-harness/deliver.log`
- 依赖：运行库（root 才读得到 → `runas: root`）、claude 凭据（`HOME=/home/agent`）、
  `workflows/tool-video`（出第三样）

## 判据（可证伪）

1. **有待交付工单时，每天至少推进一张**。连续三天日志里没有 ✅ = 这条线停了。
2. 交付物过机器自检才落盘：≥800 字节、是完整 HTML 文档、没有 TODO/此处省略、
   **没有外部脚本/样式/fetch**（单文件、不联网是硬性契约——
   交付物在私有目录下，外链取不到；联网请求会把客户数据带出去）。
3. 上架后 `deliver` 端点返回 `complete=true`，即在线、视频、下载三样在磁盘上都真的在。
4. 三样齐的那一次让如意发出通知，且**只发一次**。
5. 未收款的单一个都不动（金额 > 0 的 received 记录，和 dev bot 那道闸同口径）。

## 停摆判定

**判活看产物 mtime，不看日志。**

- `/var/lib/gooday-harness/evidence/deliver/` 最新文件超 **72 小时**没更新，
  而 `GET /api/admin/tools/deliver/{ticketId}` 还有 `complete=false` 的在途工单 → 这条线死了。
- 灵犀连续两次收到同一张单的告警 → 按大海的口径该升级给他。

## 演练

- [x] **外部依赖失败区分"该等"和"该换"**：模型凭据/额度类错误立刻停这一轮并告警
      （`is_infra_error`），不退避空转；出片失败由 tool-video 自己判并抛非零码。
- [x] **幂等续跑**：`deliver` 端点是 upsert；已有在线版就跳过生成、直接补视频；
      通知只在三样齐的那一次发且只发一次。
- [x] **失败不留半成品**：自检不过就不落盘（宁可晚交也不交空壳）；
      上架后回查不过由 tool-video 自己撤回。
- [ ] **未演练**：模型产出的网页里含恶意逻辑但绕过了正则自检。
      正则只挡明显的外链和 fetch，挡不住混淆——这条靠"交付物默认私有、
      只有客户本人能打开"兜底，不是靠自检。

## 已知边界

- **线下客户（工单没有 ClientId）跳过**：交付物必须挂在某个账号名下。
  这类单仍走人工（`SubStatus=delivered` 确认后结单）。
- **交付物只能是单文件网页**：私有文件的取用接口不接受路径参数
  （见 `docs/decisions/005`），多文件网页的相对引用取不到。
