# Gooday Harness · Agent 作业入口

> 本文件是**索引，不是手册**。上限 150 行（policies/H01）。
> 细节全在 `policies/`，别往这里堆——它一膨胀，分层就失效了。

## 这是什么

一个由 AI 员工运营的数字公司 + 内容平台，**并且它会改进自己**。

系统分两个循环：**执行**（把事做完）和**进化**（把事做得更好）。
目录就是按这两个循环组织的。

## 目录结构

```
┌─ 第一层：执行循环 ──────────────────────────────────────────┐
│ services/<名>/    README.md · main.py · deploy/unit.service  │
│ workflows/<名>/   README.md · run.py  · deploy/schedule.cron │
│ packages/<名>/     跨模块共用库（被 ≥2 处用到才建）          │
└─────────────────────────────────────────────────────────────┘
                        │ Result + Evidence
                        ▼
┌─ 第二层：进化循环 ──────────────────────────────────────────┐
│ evolution/                                                  │
│   evaluators/<名>/  给结果打分：这次做得怎么样               │
│   experiments/<名>/ 改动怎么验证（影子 / 灰度 / 前后对比）    │
│   gates/            质量门禁：check.py + rules/{H,C,G}/      │
└─────────────────────────────────────────────────────────────┘

policies/{H,C,G}/   规范三层：H 通用 · C 数字公司 · G 本项目
ops/                install.sh · nginx/ · runbooks/
docs/               specs/ 设计 · decisions/ 改动理由 · incidents/ 事故
examples/           可分发示例    content/  创作源
```

**仓库外**（policies G01，不进 git）：

```
/var/lib/gooday-harness/  state/ tasks/ events/ evidence/ evaluations/ checkpoints/
/var/log/gooday-harness/  日志          /srv/gooday-harness/  media/ 产物 · backups/ 备份
```

## 新增一个东西

**五个扩展点各自带 `_template/`。复制模板即可，不改任何现有文件。**

```bash
cp -r services/_template            services/<名>       # 加服务
cp -r workflows/_template           workflows/<名>      # 加流程
cp -r evolution/evaluators/_template  evolution/evaluators/<名>   # 加评价器
cp -r evolution/experiments/_template evolution/experiments/<名>  # 加实验
cp -r packages/_template            packages/<名>       # 加共用库
# 加规范：policies/<层>/ 丢 .md ＋ evolution/gates/rules/<层>/ 丢 .py，同一提交
sudo bash ops/install.sh            # 装上——不需要改这个脚本
```

## 七条铁律

违反任一，`evolution/gates/check.py` 会红。**先读 `policies/00-index.md`。**

1. **五类分离** —— 状态、日志、产物、备份不得出现在仓库内。
2. **目录即契约** —— 每个成员必须有 `README.md` 且含**可证伪**的判据。
3. **单一真源** —— 配置跟归属方走且只有一份；汇总产物不入库；禁手工 `.bak`。
4. **部署可重建** —— `install.sh` 只做通配扫描，永不列举成员。
5. **规范可执行** —— `policies/` 与 `gates/rules/` 一一对应，脱钩即红。
6. **扩展点契约** —— 新增成员 = 复制模板，不碰现有文件。
7. **改动可追溯** —— 任何自动改动留下 Task / Event / Evidence / Evaluation /
   Decision / Checkpoint。**没有证据不许改。**

## 动手前后

```bash
python3 evolution/gates/check.py .     # 动手前看基线，别在红着的地方加新债
```

改完必须逐项确认：

- [ ] 检查器不比动手前更红
- [ ] 动了常驻服务？**进程启动时间晚于代码 mtime**，否则你验的是旧代码
- [ ] 动了 cron？等一个执行周期，**确认日志文件真的出现**（`crontab -l` 不算数）
- [ ] 提交信息写**怎么验的**，不是"应该没问题"

## 三条不可协商

- **凭据、密钥、token 任何理由都不输出**到屏幕、日志、外部，不进版本库。
- **资金相关判定永不自愈** —— 对不上就停下来问人。
- **静态检查全绿 ≠ 系统能跑** —— 上线前必须端到端真跑一次。

## 通用检查外包，不造轮子

密钥→gitleaks / TruffleHog，静默吞错→Semgrep，大文件→pre-commit。
`gates/rules/` **只写现成工具不可能知道的项目专属规则**。见 policies「什么该外包」。

## 长期目标

第二层循环（`evolution/`）将开源为**可挂在任何执行层之上的自我迭代层**——
不自己实现 Runtime，不绑定框架。Gooday 是它的第一个真实用户，不是"示例"。
方向已定、未启动，详见 `docs/specs/001-*.md`。
**写规范时假设外人会读到**——别把业务细节焊进条文。

## 事故了怎么办

1. 按 `docs/incidents/` 模板写复盘
2. **7 天内产出一条可检查的规范** → `policies/` ＋ `gates/rules/`
3. 新检查器必须**在修复前的代码上会红** —— 否则它是假的
