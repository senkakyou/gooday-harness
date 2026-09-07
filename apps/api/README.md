# apps/api · 后端

ASP.NET Core，SQLite。承载网站、工单、论坛、听书、财务的全部接口。

## 跑

```bash
docker compose -f ops/docker/docker-compose.yml build app
docker compose -f ops/docker/docker-compose.yml up -d app
```

## 边界

- 运行期数据库在 docker volume，**不在本目录**（G01）。
- `wwwroot/uploads` 是 bind mount 指向 `/srv/gooday/media/`，**媒体不进版本库**（G01）。
- 新增静态文件类型必须注册 MIME，否则一律 404（G15）。

## 判据

1. 接口改动上线后 **24 小时内 5xx 率 < 0.5%**，超过即回滚。
2. 每个新增写接口（POST/DELETE）必须有 **≥1 条失败路径的实测记录**
   （重复操作返回 400、未授权返回 401），写进提交信息。
3. 构建产物 `bin/` `obj/` **始终为 0 个被跟踪文件**（G01 会查）。
