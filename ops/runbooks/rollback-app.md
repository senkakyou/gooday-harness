# 应用切换回滚

> 2026-09-07 切换：nginx 上游 8080（旧 `gooday_app`）→ 8081（新 `gooday-harness-api`）

## 什么时候需要回滚

新栈出问题、qianky 用不了、或数据异常。**判据是 qianky 能不能用**，不是别的。

## 回滚（约 15 秒）

```bash
# 1. 改回上游
sed -i 's#127.0.0.1:8081#127.0.0.1:8080#g' /opt/gooday/nginx/conf.d/gooday.conf
docker exec gooday_nginx nginx -t && docker exec gooday_nginx nginx -s reload

# 2. 起回旧栈
docker compose start app

# 3. 验证（必须做，别只看命令没报错）
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost/
```

配置备份在 `/var/lib/gooday-harness/checkpoints/nginx-*/`。

## 为什么回滚是安全的

**新旧两栈读的是同一个数据库卷** `gooday_gooday_data`——不是副本。
所以回滚不会丢数据：新栈期间写入的东西，旧栈同样看得到。

这也是当初决定「沿用同一个卷而非复制」的原因：
**复制会立刻产生两份真相，那时候回滚才叫灾难。**

## 切换时做过的验证

1. 新栈起在 8081 与旧栈并存，三个端点状态码逐一比对一致
2. 用 qianky(id=10) 真实 token 直连两栈，返回数据逐字一致
3. 切 nginx 后经 HTTPS 用 qianky 身份验证 200
4. **停掉旧栈后链路仍通**——这一步才是决定性的：
   前面几步都可能是「其实还在走旧栈」，停掉它才证明流量真在新栈
5. 停旧栈后 qianky 四个接口全 200，工具接口返回 99 条

第 4 步的思路值得记住：**验证「切过去了」不能靠看日志或猜，
要靠「把旧的拿掉，看还行不行」。**

---

## 完整回滚（含 nginx，2026-09-07 后适用）

nginx 也已迁入 harness，回滚要多一步：

```bash
# 1. 停 harness 栈
cd /opt/gooday-harness/ops/docker && docker compose stop nginx api

# 2. 起旧栈
docker compose up -d app nginx

# 3. 改回上游（旧 nginx 读的是 /opt/gooday/nginx/conf.d）
sed -i 's#127.0.0.1:8081#127.0.0.1:8080#g' /opt/gooday/nginx/conf.d/gooday.conf
docker exec gooday_nginx nginx -t && docker exec gooday_nginx nginx -s reload

# 4. 验证
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost/
```

**前提：`/opt/gooday` 目录还在。** 一旦删除，回滚只能从 GitHub 封存点
`bcc8d6e` 恢复源码后重建——那要几十分钟而不是几十秒。

**所以建议：新栈稳定运行一周之后再删 `/opt/gooday`。**
数据库与证书用的是同一批卷，删目录不会丢数据，但会丢掉快速回滚的能力。
