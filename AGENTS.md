# Gooday · Agent 作业入口

> 本文件是**索引，不是手册**。上限 150 行（norms/H01）。
> 细节全在 `norms/`，别往这里堆——它一膨胀，分层就失效了。

## 这是什么

Gooday 是一个由 AI 员工运营的数字公司 + 内容平台。
客户下单、方案、开发、交付、收款由六个 AI 角色完成；内容产线自动出片上架。

## 目录结构

**五个扩展点，各自带 `_template/`。新增成员 = 复制模板，不改任何现有文件。**

```
services/     长驻进程：一个目录 = 一个可独立部署的服务
              api  web  bot-灵犀  bot-如意  dispatcher  patrol …
              └── <名>/{README.md, main.py, deploy/unit.service}

pipelines/    内容产线：一个目录 = 一条产线
              └── <名>/{README.md, run.py, deploy/schedule.cron}

packages/     跨服务共用库（被 ≥2 处用到才放这儿）
              └── <名>/{README.md, ...}

norms/        规范，三层：H(通用) C(数字公司) G(本项目)
checks/rules/ 检查器，同样三层，一条规范一个文件

ops/          不属于任何单个服务的：install.sh  nginx/  runbooks/
kits/         可分发产品   docs/{specs,incidents}/   content/  创作源
```

**部署配置随服务走**（`services/<名>/deploy/`），不集中放 `ops/`。
`ops/install.sh` 只做通配扫描，永远不列举成员——所以新增服务不用改它。

**仓库外**（G01，不进 git）：
`/var/lib/gooday/state/` 状态 · `/var/log/gooday/` 日志 ·
`/srv/gooday/media/` 产物 · `/srv/gooday/backups/` 备份

## 新增一个东西

```bash
cp -r services/_template  services/<名>      # 加服务
cp -r pipelines/_template pipelines/<名>     # 加产线
cp -r packages/_template  packages/<名>      # 加共用库
# 加规范：norms/<层>/ 丢 .md + checks/rules/<层>/ 丢 .py，两边同一提交
sudo bash ops/install.sh                     # 装上，不需要改这个脚本
```

## 五条铁律

违反任何一条，`checks/check.py` 会红。**先读 `norms/00-index.md` 再动手。**

1. **五类分离** —— 代码、配置、规范、状态、产物各有其位。
   **状态和产物不得出现在仓库内**（`/var/lib/gooday/`、`/srv/gooday/`）。
2. **目录即契约** —— `apps/` `pipelines/` 下每个子目录必须有 `README.md`，
   且含可证伪的「判据」章节。写不出判据的模块，说明你不知道它算不算成功。
3. **单一真源** —— 同一份配置只能有一处。crontab 只在 `ops/cron/`，
   systemd 只在 `ops/systemd/`，别在别处放副本、别手工 `.bak`。
4. **部署可重建** —— `ops/` 下所有配置必须被 `ops/install.sh` **整目录扫描**安装。
   新增配置不需要改安装脚本；改了安装脚本才能装上的东西，迟早会漏。
5. **规范必须可执行** —— `norms/` 里每条标 `[可检查]` 的条目，
   在 `checks/rules/` 必须有实现。两边脱钩，检查器自己会红。

## 动手前必做

```bash
python3 checks/check.py .        # 看基线，别在红着的地方上面加新债
```

## 改完必做

- [ ] `python3 checks/check.py .` 不比动手前更红
- [ ] 动了常驻服务？确认**进程启动时间晚于代码 mtime**，否则你验的是旧代码
- [ ] 动了 cron？等一个执行周期，确认**日志文件真的出现**（`crontab -l` 不算数）
- [ ] 提交信息里写**怎么验的**，不是"应该没问题"

## 三条不可协商

- **凭据、密钥、token 任何理由都不输出**到屏幕、日志、外部，不进版本库。
- **资金相关判定永不自愈** —— 对不上就停下来问人。
- **静态检查全绿 ≠ 系统能跑** —— 上线前必须端到端真跑一次。

## 规范分层

| 层 | 管什么 | 在哪 |
|---|---|---|
| **H** | 通用 AI 作业规范 | `norms/H-*.md` |
| **C** | AI 数字公司运营 | `norms/C-*.md` |
| **G** | Gooday 项目专属（踩出来的） | `norms/G-*.md` |

通用检查（密钥、大文件、静默吞错）外包给 gitleaks / pre-commit / Semgrep，
`checks/` 只写**现成工具不可能知道的项目专属规则**。别造轮子。

## 长期目标

本骨架将开源为通用工程模板，Gooday 本体保持私有作参考实现。
方向已定、未启动，详见 `docs/specs/001-开源为工程骨架模板.md`。
**这意味着：写规范时假设外人会读到它**——别把业务细节焊进条文。

## 事故了怎么办

1. 按 `docs/incidents/` 的模板写复盘
2. **7 天内产出一条可检查的规范**，进 `norms/` + `checks/rules/`
3. 新检查器必须**在修复前的代码上会红** —— 否则它是假的
