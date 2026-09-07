# 事故复盘：结构在、但没在起作用，且没有任何东西会说

> 2026-09-07 · 影响面：数据库备份中断约 1 小时；巡检一整项静默未跑 · 级别：P1

## 1. 现象

迁移 patrol / db-snapshot / disk-cleanup / cert-renew 四个 workflow 到新架构，
停掉旧 cron、装上新 cron。

**表面上一切正常**：`install.sh` 全绿、cron 装上了、`patrol` 每 5 分钟报
「一切正常」、`failed_checks` 是空的。

实际上同时存在**三个故障**，一个都没被报出来。

## 2. 时间线

| 时刻 | 事件 |
|---|---|
| 08:10 | 停掉旧的 4 个 cron |
| 08:13 | 发现新的三个根本没装（托管块只有 patrol）——**备份从此空档** |
| 08:14 | 跑 install.sh，报告成功。**实际装的是三小时前的代码** |
| 08:18 | 发现部署副本停在 `a61044c`，`git pull` 后才有那三个 workflow |
| 08:22 | cron 跑 db-snapshot → **缺 config.json，一跑就退** |
| 08:23 | patrol 的 `config_drift` 项抓出「三个 workflow 缺 config」 |
| 09:xx | 修完全部三层，等 root cron 验证 |

**「问题实际开始」到「被发现」约 10 分钟**——不是因为监控好，
而是因为我正好在盯着。**没人盯的话，备份会一直停下去。**

## 3. 根因

三个故障，同一个根因：

> **结构在、但没在起作用，且没有任何东西会说。**

| # | 具体 | 为什么不报 |
|---|---|---|
| ① | 停了旧 cron 但没装新的 | 没有任何东西知道「新旧应当配对」 |
| ② | install.sh 装的是旧代码 | 脚本只验「写入成功」，不验「装的是不是最新版本」 |
| ③ | 三个 workflow 缺 `config.json` | `config.json` 被 gitignore（正确），但没人负责播种；日志里那行没人看 |
| ④ | `db_health` 整项静默未跑 | 配置缺 `databases` 段 → **遍历空列表**：不报错、不算失败、`failed_checks` 为空 |

④ 最阴：**遍历空列表是「成功地什么都没做」**，
在任何统计口径下都表现为正常。

再往下一层：③ 的播种逻辑本来是有的，**在重写 crontab 的 runas 分组时被连带删掉了**——
是重构回归，不是从没写过。

## 4. 为什么没早点发现

- [x] **有监控但对这种失败形态静默跳过**（④ 遍历空列表）
- [x] **根本没有这项监控**（① 新旧配对、② 版本一致、③ 配置播种）

## 5. 产出的规范

| 编号 | 内容 | 可检查 | 实现 |
|---|---|---|---|
| **G19** | 有 `config.example.json` 的 workflow，install.sh 必须播种 | 是 | `evolution/gates/rules/G/g19_config_seeded.py` |
| — | install.sh 版本前置检查：本地与远端不一致即拒绝安装 | 是 | `ops/install.sh` 第 0 段 |
| — | `migration` 巡检：新旧恰好一个在跑 | 是 | `workflows/patrol/checks/migration.py` |
| — | `config_drift` 巡检：config.json 缺 example 的段即报 | 是 | `workflows/patrol/checks/config_drift.py` |

## 6. 验证

- [x] 复刻回归（删掉 install.sh 的播种段）→ **G19 立刻报错**并列出 4 个受影响 workflow
- [x] 造落后一个提交的部署副本 → **版本检查拒绝安装**，退出码 1
- [x] 当前半吊子状态 → `migration` 当场抓出三个空档
- [x] 部署副本旧配置 → `config_drift` 当场抓出三个缺 config

**每一条新检查都在「事故发生的那一刻」会红。** 在坏代码上不报警的检查器等于没写。

## 7. 顺带修掉的同族问题

`os.path.exists` 在父目录不可读时也返回 `False`——
以非 root 身份跑时会把「权限不足」误报成「文件不存在」。
今天在三处栽过同一形态：`db_health`、`migration`、`db-snapshot`，全部改为
先探父目录可读性，分别报「查不了」与「确实没有」。

**「查不了」不等于「没问题」**——这是本项目最贵的一条经验，
今天一天在六个不同位置重复出现。
