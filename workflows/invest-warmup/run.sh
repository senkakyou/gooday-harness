#!/bin/bash
# 投资模块每日定点数据刷新(cron: 5 8 * * 1-5 UTC = 北京16:05 周一至五,收盘后)
# 记录抓取失败只数(errors>0=有票沿用旧快照,连续多天>0该查数据源了)
#
# 2026-08-04 加诊断:原来解析失败只写"JSON解析失败",查不出到底是超时、
# 502 还是响应被截断。现在附带 HTTP 码/耗时/响应字节数,失败时再记开头 120 字符。
#
# 2026-08-14 改直连,根治天天报 504 的假警报:
#   原来走 https://localhost(即 nginx),而这个接口重建 140 只自选要 150~190 秒,
#   超过 nginx 的 150s 代理超时 → nginx 先返 504,脚本记"失败"。
#   但查 AccessLogs 证实后端每次都跑完了(状态200,DurationMs 15.1万~19.2万,即 151~192 秒),
#   数据一直是新的,坏的只是可观测性——而日志天天红,真出事反而分辨不出来。
#   现在直连 127.0.0.1:8080 绕开 nginx 超时;耗时超 240 秒会额外标 SLOW,
#   因为耗时随自选池(现 140 只)线性增长,这是下一个会炸的地方。
LOG=/var/log/gooday-harness/invest-warmup-detail.log
URL="http://127.0.0.1:8081/api/invest/watchlist?refresh=1"   # 直连 app,别走 nginx(150s 超时)
BODY=$(mktemp)
META=$(curl -s --max-time 600 -o "$BODY" -w "%{http_code} %{time_total} %{size_download}" "$URL")
RC=$?
read -r HTTP TIME SIZE <<< "$META"

STAT=$(python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
print(f\"errors={d.get('errors','?')} items={len(d.get('items',[]))} bond={d.get('bondYield','?')}\")" "$BODY" 2>/dev/null)

# 耗时预警:重建时间随池子增长,逼近超时前先在日志里露头
SLOW=""
[ "${TIME%%.*}" -ge 240 ] 2>/dev/null && SLOW=" SLOW(耗时已超240s,该关注池子规模了)"

if [ -n "$STAT" ] && [ "$HTTP" = "200" ]; then
  echo "[$(date '+%F %T')] OK http=$HTTP ${TIME}s ${SIZE}B $STAT$SLOW" >> "$LOG"
else
  echo "[$(date '+%F %T')] FAIL curl=$RC http=$HTTP ${TIME}s ${SIZE}B ${STAT:-JSON解析失败} head=$(head -c 120 "$BODY" | tr -d '\n')$SLOW" >> "$LOG"
fi
rm -f "$BODY"
