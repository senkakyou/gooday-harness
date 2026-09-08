# 应用回滚

> **状态：2026-09-08 重写。**
> 原手册教人把 nginx 上游改回 8080、`docker compose start app` 起回旧栈——
> 那条路**已经不存在了**：旧栈随 `/opt/gooday` 改名 `/opt/goodayback` 一起退役，
> 容器 `gooday_app`/`gooday_nginx` 都已停止。
>
> **照着一份过期的 runbook 操作，比没有 runbook 更危险**——
> 出事时人不会先怀疑手册，只会以为自己敲错了。

## 什么时候需要回滚

站点 500、页面白屏、API 全挂。**判据是真实用户能不能用**，不是别的。

## 先分清是哪一类

回滚的对象不同，做法完全不同：

| 症状 | 多半是 | 去哪一节 |
|---|---|---|
| 每个请求都 500，容器却 `running` | 配置/密钥没传进去 | [配置回滚](#一配置回滚最常见) |
| 页面样式乱、JS 报错 | 前端产物 | [前端回滚](#二前端回滚) |
| 容器起不来、日志有异常栈 | 镜像/代码 | [镜像回滚](#三镜像回滚) |
| 数据不对 | **不要回滚镜像** | [数据](#四数据) |

## 一、配置回滚（最常见）

2026-09-07 真事故：`docker compose up -d api` 之后整站 500，
容器状态 `running`、日志不红，**只有真发请求才炸**。
根因是 `${JWT_SECRET}` 空展开（compose 的变量插值不读 `env_file:`）。

```bash
cd /opt/gooday-harness/ops/docker
docker compose config | grep -c 'Jwt__Secret: .\+'    # 应为 1；是 0 就是密钥没传进去
ls -l .env                                            # 应是指向 ../../.env 的软链
docker compose up -d api
sleep 8 && curl -sk -o /dev/null -w '%{http_code}\n' https://localhost/
```

软链没了就补：`ln -sfn /opt/gooday-harness/.env /opt/gooday-harness/ops/docker/.env`

## 二、前端回滚

产物在 `services/api/src/wwwroot/`，跟代码一起进版本库，所以用 git 回退：

```bash
cd /opt/gooday-harness
git log --oneline -5 -- services/api/src/wwwroot     # 找上一个好版本
git checkout <commit> -- services/api/src/wwwroot
cd ops/docker && docker compose build api && docker compose up -d api
```

要从源码重建：`cd services/web && npm ci && npm run build`
（产物落到 `../api/src/wwwroot`，两次构建逐字节一致）。

## 三、镜像回滚

```bash
cd /opt/gooday-harness
git log --oneline -10                                # 找上一个好 commit
git checkout <commit> -- services/api/src
cd ops/docker && docker compose build api && docker compose up -d api
```

**回滚后必须验**，别只看命令没报错：

```bash
curl -sk -o /dev/null -w '首页 %{http_code}\n' https://localhost/
curl -sk -o /dev/null -w 'API  %{http_code}\n' https://localhost/api/tools
docker logs gooday-harness-api --tail 20
```

## 四、数据

**数据不对不要回滚镜像**——那不解决问题，还会掩盖原因。

快照在 `/srv/gooday-harness/backups/gooday/`（每小时一份，留 24 份；每日一份，留 7 份）。

```bash
ls -lt /srv/gooday-harness/backups/gooday/hourly/ | head -3
# 先在副本上验，确认这份快照真的是好的，再考虑换库
sqlite3 <快照> "SELECT COUNT(*) FROM Tools;"
```

换生产库要停 api、换文件、起 api，**并且换之前先把当前库另存一份**——
换错方向就没得救了。

## 兜底：整套重建

`/opt/goodayback`（1.5G）是旧系统的封存，**它不是可运行的回滚目标**，
只是万一漏了什么还能捞文件出来。真正的重建路径是：

```bash
git clone git@github.com:senkakyou/gooday-harness.git /opt/gooday-harness
cd /opt/gooday-harness && cp <备份的 .env> .env
sudo bash ops/install.sh
cd ops/docker && docker compose up -d
```

数据库与证书用的是 docker 卷（`gooday_gooday_data`、`gooday_gooday_certs`），
**不随仓库走**，重建时它们还在原地。

## 判据

回滚做完，这四条全绿才算完：

```bash
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost/            # 200
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost/api/tools   # 200
systemctl list-units 'gooday-harness-*' --no-legend | awk '{print $4}'  # 全 running
python3 /opt/gooday-harness/workflows/patrol/run.py                     # 无 P0
```
