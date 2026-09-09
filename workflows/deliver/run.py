#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""deliver —— 把已付款工单做成客户手里的交付物，全程不惊动大海。

一轮做一件事：**挑一张已收款、还没交付齐的工单，把三样凑齐、上架、让如意通知客户。**

    工单（已收款）
      → 生成在线版（单文件网页）        ← 用威震天的人格与铁则
      → 自动打包下载包（在线版 + 说明）
      → 上架成客户的私有工具（灵犀身份调 deliver 端点）
      → 出视频讲解（调 workflows/tool-video）
      → 三样齐 → 如意私信客户 → 工单可以结单
      → 任何一步失败：告警灵犀，大海不介入

【为什么生成这一步在这里、而不在 bot-weizhentian 里】
它的输入是客户写的需求，是注入的主要入口，所以那个角色**一个工具都不给**
（和如意同理）。写文件这种事必须留在确定性代码里。
但人格和铁则仍以 `services/bot-weizhentian/prompt.md` 为**单一真源**——
这里加载它，只在后面拼一段"交付物长什么样"的格式契约。

    python3 run.py                 # 挑 1 张（cron 走这条）
    python3 run.py --ticket 33
    python3 run.py --limit 2
    python3 run.py --dry-run       # 只生成不落盘不上架
"""
import argparse
import json
import os
import re
import ssl
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = os.path.basename(HERE)
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages"))
sys.path.insert(0, os.path.join(REPO, "workflows", "tool-video"))

import publish as tv                                              # noqa: E402  复用它的鉴权/接口封装
from botkit import model as mdl                                   # noqa: E402
from botkit import outbound                                       # noqa: E402
from botkit.auth import provider                                  # noqa: E402

STATE_DIR = f"/var/lib/gooday-harness/state/{NAME}"
EVIDENCE_DIR = f"/var/lib/gooday-harness/evidence/{NAME}"
UPLOADS = "/srv/gooday-harness/media/uploads"
PROGRESS = os.path.join(STATE_DIR, "progress.json")

LINGXI_ID, ADMIN_ID = 20, 1
MAX_ATTEMPTS = 2          # 同一张单连挂两次就升级给大海（他的口径：那时才找我）
MIN_HTML = 800            # 交付物小于这个字节数，基本可以断定是个空壳

DEV_PROMPT = os.path.join(REPO, "services", "bot-weizhentian", "prompt.md")

CONTRACT = """

【本次任务的交付契约——按这个格式产出，其它一概不要】

你要交付的是**一个单文件网页**：所有 HTML、CSS、JavaScript 写在同一个 .html 里，
打开就能用，不依赖任何外部资源（不许 CDN、不许外链字体、不许联网请求）。

理由是硬性的：交付物放在客户的私有目录下，只有他本人能取，
外部引用一律取不到；而联网请求会把客户的数据带出去。

只输出一个 ```html 代码块，块里是完整的 .html 内容，块外不要任何解释文字。

页面要求：
- 顶部有标题和一句话说明它干什么
- 需求里明说的功能都要能真的跑（不要写"此处省略"、不要留 TODO）
- 自带一份极简用法说明（页面里，不是注释里）
- 中文界面，移动端也能用
"""


def log(msg):
    print(f"[{NAME}] {time.strftime('%F %T')} {msg}", flush=True)


def load_progress():
    try:
        with open(PROGRESS) as f:
            return json.load(f)
    except Exception:
        return {"done": {}, "failed": {}}


def save_progress(p):
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = PROGRESS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(p, f, ensure_ascii=False, indent=1)
    os.replace(tmp, PROGRESS)


def evidence(key, payload):
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    p = os.path.join(EVIDENCE_DIR, f"{time.strftime('%Y%m%d-%H%M%S')}-{key}.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    return p


def notify_lingxi(text):
    """告警只发灵犀。大海的原话是"交付我不介入"——他不该收到过程告警。"""
    try:
        outbound.configure({ADMIN_ID: [LINGXI_ID]})
        ok, err = outbound.send(ADMIN_ID, LINGXI_ID, text,
                                token_provider=provider(ADMIN_ID, "admin", "admin", tv.db_path()),
                                tag=NAME)
        if not ok:
            log(f"⚠️ 告警没发出去：{err}")
    except Exception as e:
        log(f"⚠️ 告警异常：{type(e).__name__}: {e}")


# ---------------- 选题 ----------------

# 【白名单，不是黑名单】。原来写的是"排除 done/cancelled/refunded/refunding/pending"，
# 剩下的 failed 和 customer_rejected 就漏进来了——那两个状态的单都是已收款、
# 正在议退款或返工的，机器会生成一版然后通知客户"做好了🎉"，
# 而站长这边正准备退钱。（2026-09-09 灵犀评审 C）
DOABLE_STATUS = ("delivering",)


def candidates(limit, ticket_id=None):
    """挑「进入交付阶段、已收款、有平台账号、还没交付齐」的工单。

    【必须已收款】：和 dev bot 的闸门口径一致（金额 > 0 的 received 记录）。
    【收款判定必须在这里】而不是在 main() 里：放在外面的话，
    列表最上面那张未收款的新单会天天占掉 limit=1 的唯一名额，
    下面那些已收款的老单永远排不上——饿死，而且日志看起来一切正常。
    """
    tickets = json.load(tv._req("/api/tickets?pageSize=100"))["list"]
    out = []
    for t in tickets:
        if ticket_id and t["id"] != ticket_id:
            continue
        if not ticket_id:
            if t["status"] not in DOABLE_STATUS:
                continue
            if not t.get("clientId"):
                continue          # 线下客户没账号，交付物挂不到谁名下
            if not paid(t["id"]):
                continue
        st = json.load(tv._req(f"/api/admin/tools/deliver/{t['id']}"))
        if st.get("complete"):
            continue              # 已经交付齐了
        # 【列表接口不返回 Description】（TicketsController 的 Select 里没有它），
        # 直接用列表里的 ticket 去生成，模型看到的就只有标题——
        # 整条线会"按标题瞎做"，而且它做得出东西来，不报错。
        # 必须再拉一次详情。（2026-09-09 灵犀评审 P0）
        full = json.load(tv._req(f"/api/tickets/{t['id']}"))
        out.append((full, st))
        if len(out) >= limit:
            break
    return out


def paid(ticket_id):
    recs = json.load(tv._req(f"/api/finance?ticketId={ticket_id}&pageSize=50"))
    items = recs.get("list") or recs.get("items") or (recs if isinstance(recs, list) else [])
    return any(r.get("type") == "income" and r.get("paymentStatus") == "received"
               and float(r.get("amount") or 0) > 0 for r in items)


# ---------------- 生成交付物 ----------------

class DeliverError(RuntimeError):
    def __init__(self, msg, infra=False):
        super().__init__(msg)
        self.infra = infra


def generate_html(ticket):
    """按需求生成单文件网页。人格与铁则来自威震天的 prompt（单一真源）。"""
    system = open(DEV_PROMPT, encoding="utf-8").read() + CONTRACT
    desc = (ticket.get("description") or "").strip()
    # 【需求原文为空就不做】。上一版从工单列表拿 ticket，而列表接口不返回
    # Description，于是模型只看到标题——它照样能生成东西，不报错，
    # 只是做的是另一件事。宁可这一轮不出，也不能按标题瞎做。
    if len(desc) < 10:
        raise DeliverError(f"工单 {ticket['ticketNo']} 的需求原文是空的（只有 {len(desc)} 字），"
                           f"不按标题瞎做。检查 /api/tickets/{ticket['id']} 是否返回 description")
    ask = (f"工单 {ticket['ticketNo']}\n标题：{ticket['title']}\n\n"
           f"需求原文：\n{desc}\n\n按交付契约输出。")
    text, ok, err = mdl.call(ask, system, tag=NAME, timeout=900)
    if not ok:
        raise DeliverError(f"模型调用失败：{err[:300]}", infra=mdl.is_infra_error(err))

    m = re.search(r"```(?:html)?\s*(.*?)```", text, re.S | re.I)
    html = (m.group(1) if m else text).strip()
    problems = check_html(html)
    if problems:
        raise DeliverError("交付物没过自检：" + "；".join(problems))
    return html


def check_html(html):
    """机器自检。**过不了就不交**——半成品交出去比晚交更贵。"""
    bad = []
    if len(html.encode()) < MIN_HTML:
        bad.append(f"只有 {len(html.encode())} 字节，基本是个空壳")
    low = html.lower()
    if "<html" not in low and "<!doctype" not in low:
        bad.append("不是一个完整的 HTML 文档")
    if "todo" in low or "此处省略" in html or "略" == html.strip()[-1:]:
        bad.append("里面还留着 TODO / 此处省略")
    # 单文件、不联网：这两条是交付契约的硬性部分，也是客户数据不外泄的前提
    for pat, why in [(r"<script[^>]+src=[\"']https?://", "引了外部脚本"),
                     (r"<link[^>]+href=[\"']https?://", "引了外部样式/字体"),
                     (r"\bfetch\s*\(\s*[\"']https?://", "代码里有对外网的 fetch"),
                     (r"XMLHttpRequest\s*\(\s*\)[\s\S]{0,80}open\s*\([^)]*https?://", "有对外网的 XHR")]:
        if re.search(pat, html, re.I):
            bad.append(why)
    return bad


def write_deliverable(ticket, html):
    """落盘到私有目录 + 自动打包下载包。

    【下载包由流水线打，不让模型产出二进制】：让它输出 base64 的 zip 既浪费又易错，
    而"下载"这一样对客户的价值就是"能存到自己电脑上离线用"——
    把在线版本体加一份说明打包就满足了。
    """
    rel_dir = f"private/{ticket['ticketNo']}"
    d = os.path.join(UPLOADS, rel_dir)
    os.makedirs(d, exist_ok=True)
    name = ticket["ticketNo"]
    html_path = os.path.join(d, f"{name}.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)

    readme = (f"{ticket['title']}\n\n"
              f"工单号：{ticket['ticketNo']}\n"
              f"用法：双击 {name}.html 用浏览器打开即可，不需要联网、不需要安装。\n"
              f"在线版和视频讲解在 gooday.ltd 你的工具一览里。\n")
    zip_path = os.path.join(d, f"{name}.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(html_path, f"{name}.html")
        z.writestr("使用说明.txt", readme)
    return f"/uploads/{rel_dir}/{name}.html", f"{rel_dir}/{name}.zip"


# ---------------- 上架 / 出片 ----------------

def deliver_call(body):
    return json.load(tv._req("/api/admin/tools/deliver", method="POST",
                             data=json.dumps(body).encode(),
                             headers={"Content-Type": "application/json"}))


def make_video(slug):
    """调 tool-video 产线出讲解片。它自己会上架、回查、失败会抛非零退出码。"""
    r = subprocess.run(
        [sys.executable, os.path.join(REPO, "workflows", "tool-video", "run.py"), "--slug", slug],
        capture_output=True, text=True, timeout=3600)
    tail = ((r.stdout or "") + (r.stderr or "")).strip().splitlines()[-3:]
    if r.returncode != 0:
        raise DeliverError("出讲解片失败：" + " / ".join(tail))
    return " / ".join(tail)


def one(ticket, status, *, dry=False):
    tno, tid = ticket["ticketNo"], ticket["id"]
    result = {"ticketNo": tno, "ticketId": tid, "at": time.strftime("%F %T"), "steps": []}

    if not (status.get("exists") and "在线版缺失" not in status.get("missing", [])):
        log(f"{tno}：生成在线版")
        html = generate_html(ticket)
        result["htmlBytes"] = len(html.encode())
        if dry:
            result["steps"].append("dry-run：生成完就停")
            return result
        online, download = write_deliverable(ticket, html)
        result["steps"].append(f"落盘 {online}")
        d = deliver_call({"ticketId": tid, "name": ticket["title"][:40],
                          "description": (ticket.get("description") or "")[:120],
                          "onlineUrl": online, "downloadFileName": download})
        result["slug"] = d["slug"]
        result["steps"].append(f"上架 {d['slug']}，还缺：{d['missing']}")
    else:
        d = json.load(tv._req(f"/api/admin/tools/deliver/{tid}"))
        result["slug"] = d["slug"]
        result["steps"].append("在线版和下载包已就位，跳过生成")

    if dry:
        return result

    # 三样里的最后一样
    st = json.load(tv._req(f"/api/admin/tools/deliver/{tid}"))
    if not st["complete"]:
        log(f"{tno}：出讲解片")
        result["steps"].append("出片：" + make_video(st["slug"]))

    final = json.load(tv._req(f"/api/admin/tools/deliver/{tid}"))
    result["complete"] = final["complete"]
    result["missing"] = final.get("missing", [])
    if final["complete"]:
        # 再调一次 deliver：三样齐了它会让如意通知客户（幂等，只发一次）
        d = deliver_call({"ticketId": tid})
        result["notified"] = d.get("notified")
        # 【措辞要准】：出片那一步挂视频时也走 deliver 端点，三样正好在那时齐，
        # 通知就是那一步发的。这里再调就是 false。写成"此前已通知过"会让人
        # 以为客户没收到——本轮到底发没发，看这一轮里有没有人发过
        result["steps"].append("通知客户" if d.get("notified")
                               else "客户已收到通知（在补视频那步发出）")
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticket", type=int)
    ap.add_argument("--limit", type=int, default=1)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    progress = load_progress()
    todo = candidates(args.limit, args.ticket)
    if not todo:
        log("没有待交付的工单——这是正常状态，不是失败")
        return 0

    rc = 0
    for ticket, status in todo:
        tno = ticket["ticketNo"]
        if progress["failed"].get(tno, 0) >= MAX_ATTEMPTS and not args.ticket:
            log(f"跳过 {tno}：已连续失败 {MAX_ATTEMPTS} 次，等人看（要重试用 --ticket）")
            continue
        try:
            r = one(ticket, status, dry=args.dry_run)
            r["evidence"] = evidence(tno, r)
            if not args.dry_run:
                progress["done"][tno] = {"at": r["at"], "complete": r.get("complete")}
                progress["failed"].pop(tno, None)
                save_progress(progress)
            log(f"✅ {tno}：{' → '.join(r['steps'])}")
            if r.get("complete") is False:
                log(f"⚠️ {tno} 还差：{r.get('missing')}")
        except Exception as e:
            rc = 2
            infra = getattr(e, "infra", False)
            n = progress["failed"].get(tno, 0) + 1
            progress["failed"][tno] = n
            save_progress(progress)
            log(f"❌ {tno}：{type(e).__name__}: {e}")
            log(traceback.format_exc()[-1200:])
            evidence(tno + "-failed", {"ticketNo": tno, "error": str(e), "attempt": n})
            notify_lingxi(
                f"⚠️ 交付流水线卡住了：{tno}「{ticket['title']}」\n"
                f"第 {n} 次失败：{str(e)[:300]}\n"
                + ("这是基础设施问题（凭据/额度/外部服务），重试没用，要人看一眼。\n"
                   if infra else "")
                + (f"已经连挂 {n} 次，按大海定的口径该升级给他了。\n" if n >= MAX_ATTEMPTS else
                   "下一轮会自动重试。\n")
                + f"重跑：python3 {HERE}/run.py --ticket {ticket['id']}")
            if infra:
                break     # 基础设施坏了，继续跑下一张只是用同样的姿势再失败一次
    return rc


if __name__ == "__main__":
    sys.exit(main())
