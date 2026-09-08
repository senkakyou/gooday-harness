#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""定期把新产出的成语集打包成"喜马手动上传清单"推到灵犀聊天(大海)。
只推 上次之后 的新集(进度 ~/.chengyu_pushed)，没有新集就静默退出。"""
import os,time,subprocess
DB="/var/lib/docker/volumes/gooday_gooday_data/_data/gooday.db"
BOOK=13; BASE="https://gooday.ltd"; PUSHED=os.path.expanduser("~/.chengyu_pushed")
def db(sql): return subprocess.run(["sudo","-n","/usr/bin/sqlite3","-separator","\x1f",DB,sql],capture_output=True,text=True).stdout
last=int(open(PUSHED).read().strip()) if os.path.exists(PUSHED) else 8
rows=[r for r in db(f"SELECT OrderNo,Title,MediaUrl FROM AudiobookChapters WHERE AudiobookId={BOOK} AND OrderNo>{last} ORDER BY OrderNo;").strip().split("\n") if r]
if not rows: print("无新集，跳过"); raise SystemExit
lines=[]
for r in rows:
    o,title,url=r.split("\x1f")
    lines.append(f"{title} {BASE}{url}")
maxno=rows[-1].split("\x1f")[0]
msg=("📤【成语时光机·新集上传清单】共"+str(len(rows))+"集，手动传喜马「成语时光机」(中文版)：\n"
     +"\n".join(lines)
     +"\n上传三项：①专辑=成语时光机(非English) ②是否AI合成=是 ③标题照上面。")
ts=time.strftime("%Y-%m-%d %H:%M:%S")+".0000000"

# 【清单要分段】。这条绕开 API 直接写库，服务端那道 4000 的判定碰不到，
# 所以不会被拒 —— 但攒下的集数一多，就会写出一条几万字的消息：
# 前端得渲染它、任何转发它的地方会被 400 挡掉。一次 PUSHED 复位就能造出 600 行。
# 上限与切法复用 packages/botkit/outbound，不在这里写第二份数字（G03 / G21）。
import sys
sys.path.insert(0,"/opt/gooday-harness/packages/botkit")
from outbound import MAX_CONTENT, split
segs = split(msg) if len(msg) > MAX_CONTENT else [msg]
if len(segs) > 1: print(f"清单 {len(msg)} 字超过上限 {MAX_CONTENT}，分 {len(segs)} 段")
for seg in segs:
    seg_sql=seg.replace("'","''")
    db(f"INSERT INTO PrivateMessages (SenderId,SenderUsername,ReceiverId,ReceiverUsername,Content,CreatedAt,IsRead) VALUES (20,'灵犀',1,'admin','{seg_sql}','{ts}',0);")
open(PUSHED,"w").write(maxno)
print(f"已推 {len(rows)} 集清单(至第{maxno}集)")
