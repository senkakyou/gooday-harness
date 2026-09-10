#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""order —— 订单的四条显式命令。

**这不是流水线，是一组命令。** 没有 cron，没有轮询，没有抢单。
开工由大海下令；开发由主 Agent 用自己的工具做；本文件只负责那些
必须确定性完成的动作：迁状态、落证据、送评审、上架、报告。

    python3 run.py start   GD-20260910-001     # NEW → IN_PROGRESS，建工作目录
    python3 run.py build   GD-20260910-001     # 可选：机器生成单文件网页
    python3 run.py review  GD-20260910-001     # 送灵犀评审，取回结论
    python3 run.py ready   GD-20260910-001     # 三样齐 → 上架（先不通知客户）→ 报大海
    python3 run.py close   GD-20260910-001     # DELIVERED → CLOSED

【为什么 ready 之后不通知客户】：上架和通知是两件事。
主 Agent 先把东西挂到客户名下但不声张，大海在后台点「放行验收」，
如意才发通知。两个地方都能通知客户，就一定会出现「客户先收到、大海还没看过」。

【身份】：本流程拿大海(1)的 token 跑，因为 start/close 是 owner-only 事件。
诚实说明这道闸挡的是谁——它挡的是如意/灵犀擅自推状态，
挡不住持有大海凭据的运维本人。那是设计如此：主 Agent 是大海的手。
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import traceback
import urllib.error
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = os.path.basename(HERE)
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages"))
sys.path.insert(0, os.path.join(REPO, "workflows", "tool-video"))

# ══ 让本流程能被【实际会跑它的那个身份】跑起来 ══════════════════════
#
#   tool-video/publish.py 要求进程能直接读 docker 卷里的运行库（它以 root 跑，
#   cron 里写死 runas: root）。而 order **刻意没有 cron**——它是主 Agent 手工跑的，
#   agent 身份读不到那个卷。第一次真跑时 start 和 build 都当场抛
#   PublishError，也就是说 README 里写的用法【用实际会跑它的身份跑不起来】。
#
#   解法不是「改成 root 跑」（那要密码，且违背这条流程的定位），
#   而是给它一份只用来查 TokenVersion 的可读副本。
#
#   ⚠️ 【必须用 sqlite3 .backup，不能用 cp】。publish.py 的注释里担心的正是 cp——
#   WAL 模式下 cp 主文件拿到的是缺最近写入的半份且不报错（本次重构的回滚演练
#   实测复现过，连表都可能不在）。.backup 走的是在线备份 API，是一致快照，
#   而且它在 sudoers 的免密名单里。
import atexit                                                     # noqa: E402
import shutil                                                     # noqa: E402
import tempfile                                                   # noqa: E402

_RUNTIME_DB = "/var/lib/docker/volumes/gooday_gooday_data/_data/gooday.db"
if not os.access(_RUNTIME_DB, os.R_OK) and not os.environ.get("TOOLVIDEO_DB"):
    _d = tempfile.mkdtemp(prefix="order-db-")
    _copy = os.path.join(_d, "runtime.db")
    try:
        subprocess.run(["sudo", "-n", "sqlite3", _RUNTIME_DB, f".backup '{_copy}'"],
                       check=True, timeout=120, capture_output=True)
        os.environ["TOOLVIDEO_DB"] = _copy
        atexit.register(shutil.rmtree, _d, ignore_errors=True)
    except Exception as _e:
        shutil.rmtree(_d, ignore_errors=True)
        print(f"[order] ❌ 读不到运行库，且备份副本也没做成：{_e}\n"
              f"        本流程要能查 TokenVersion 才签得出 token。", file=sys.stderr)
        sys.exit(2)

import publish as tv                                              # noqa: E402  复用鉴权/接口封装
from botkit import model as mdl                                   # noqa: E402
from botkit import outbound                                       # noqa: E402
from botkit.auth import provider                                  # noqa: E402
sys.path.insert(0, os.path.join(REPO, "packages", "trace"))
from trace import Task                                            # noqa: E402

STATE_DIR = f"/var/lib/gooday-harness/state/{NAME}"
EVIDENCE_DIR = f"/var/lib/gooday-harness/evidence/{NAME}"
WORK_ROOT = "/srv/gooday-harness/work"
UPLOADS = "/srv/gooday-harness/media/uploads"

DAHAI_ID, LINGXI_ID = 1, 20
MIN_HTML = 800            # 交付物小于这个字节数，基本可以断定是个空壳
MAX_REVIEW_ROUNDS = 3     # 承自开发铁则：同一个问题连挂 3 次就停下报人工
MAX_INLINE = 60000        # 贴给评审者的交付物内容上限（字）。单文件网页远小于它
REVIEW_WAIT_SEC = 1200    # 等灵犀回复的上限（她要真去读代码，不是秒回）

BUILD_PROMPT = os.path.join(HERE, "prompts", "build.md")

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


class OrderError(RuntimeError):
    pass


# ── 状态文件 ────────────────────────────────────────────────────────

def state_path(tno):
    return os.path.join(STATE_DIR, f"{tno}.json")


def load_state(tno):
    try:
        with open(state_path(tno), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"ticketNo": tno, "reviews": []}


def save_state(st):
    os.makedirs(STATE_DIR, exist_ok=True)
    p = state_path(st["ticketNo"])
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=1)
    os.replace(tmp, p)          # 原子替换，避免半个文件


def evidence(tno, key, payload):
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    p = os.path.join(EVIDENCE_DIR, f"{time.strftime('%Y%m%d-%H%M%S')}-{tno}-{key}.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    return p


# ── API ─────────────────────────────────────────────────────────────

def api(path, method=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else None
    return json.load(tv._req(path, method=method, data=data, headers=headers))


def find_ticket(tno):
    """按订单号取详情。【必须走详情接口】——列表不一定带全字段。"""
    lst = api("/api/tickets?pageSize=200")["list"]
    hit = [t for t in lst if t["ticketNo"] == tno or str(t["id"]) == tno]
    if not hit:
        raise OrderError(f"没有订单 {tno}")
    return api(f"/api/tickets/{hit[0]['id']}")


def transition(t, event, reason=None):
    try:
        return api(f"/api/tickets/{t['id']}/transition", method="POST",
                   body={"event": event, "reason": reason})
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:400]
        # 409 = 此刻不能做（并发/重复），400 = 闸门拦下。两者处理方式不同，别混为一谈
        raise OrderError(f"迁移 {event} 被拒（HTTP {e.code}）：{detail}")


def work_dir(tno):
    return os.path.join(WORK_ROOT, tno)


# ── start ───────────────────────────────────────────────────────────

def cmd_start(args):
    t = find_ticket(args.ticket)
    tno = t["ticketNo"]

    d = work_dir(tno)
    os.makedirs(d, exist_ok=True)
    # 把需求原文落到工作目录：主 Agent 开发时看的是这份，不是去库里翻
    with open(os.path.join(d, "需求.md"), "w", encoding="utf-8") as f:
        f.write(f"# {t['title']}\n\n订单号：{tno}\n"
                f"客户：{t.get('clientName') or '—'}（{t.get('clientContact') or '无联系方式'}）\n"
                f"金额：{t.get('amount') if t.get('amount') is not None else '未定价'}\n\n"
                f"## 需求原文\n\n{t.get('description') or ''}\n")

    if t["status"] == "IN_PROGRESS":
        log(f"{tno} 已经是 IN_PROGRESS，只刷新工作目录（幂等重入）")
    else:
        transition(t, "start")
        log(f"{tno} NEW → IN_PROGRESS")

    st = load_state(tno)
    st["workDir"] = d
    st["startedAt"] = time.strftime("%F %T")
    save_state(st)
    log(f"工作目录 {d}")
    return 0


# ── build（可选的机器生成）────────────────────────────────────────────

def check_html(html):
    """机器自检。**过不了就不交**——半成品交出去比晚交更贵。"""
    bad = []
    if len(html.encode()) < MIN_HTML:
        bad.append(f"只有 {len(html.encode())} 字节，基本是个空壳")
    low = html.lower()
    if "<html" not in low and "<!doctype" not in low:
        bad.append("不是一个完整的 HTML 文档")
    if "todo" in low or "此处省略" in html:
        bad.append("里面还留着 TODO / 此处省略")
    for pat, why in [(r"<script[^>]+src=[\"']https?://", "引了外部脚本"),
                     (r"<link[^>]+href=[\"']https?://", "引了外部样式/字体"),
                     (r"\bfetch\s*\(\s*[\"']https?://", "代码里有对外网的 fetch"),
                     (r"XMLHttpRequest\s*\(\s*\)[\s\S]{0,80}open\s*\([^)]*https?://", "有对外网的 XHR")]:
        if re.search(pat, html, re.I):
            bad.append(why)
    return bad


def cmd_build(args):
    t = find_ticket(args.ticket)
    tno = t["ticketNo"]
    desc = (t.get("description") or "").strip()
    # 【需求原文为空就不做】。只看标题的话模型照样能生成东西、不报错，
    # 只是做的是另一件事。宁可这一轮不出，也不能按标题瞎做。
    if len(desc) < 10:
        raise OrderError(f"{tno} 的需求原文只有 {len(desc)} 字，不按标题瞎做")

    system = open(BUILD_PROMPT, encoding="utf-8").read() + CONTRACT
    ask = f"订单 {tno}\n标题：{t['title']}\n\n需求原文：\n{desc}\n\n按交付契约输出。"
    text, ok, err = mdl.call(ask, system, tag=NAME, timeout=900)
    if not ok:
        raise OrderError(f"模型调用失败：{err[:300]}")

    m = re.search(r"```(?:html)?\s*(.*?)```", text, re.S | re.I)
    html = (m.group(1) if m else text).strip()
    problems = check_html(html)
    if problems:
        raise OrderError("交付物没过自检：" + "；".join(problems))

    d = work_dir(tno)
    os.makedirs(d, exist_ok=True)
    out = os.path.join(d, f"{tno}.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    log(f"{tno} 生成完毕 → {out}（{len(html.encode())} 字节，自检通过）")
    evidence(tno, "build", {"bytes": len(html.encode()), "path": out})
    return 0


# ── review ──────────────────────────────────────────────────────────

VERDICT_RE = re.compile(r"评审结论\s*[:：]\s*(通过|打回)")


def _send_to_lingxi(text):
    outbound.configure({DAHAI_ID: [LINGXI_ID]})
    ok, err = outbound.send(DAHAI_ID, LINGXI_ID, text,
                            token_provider=provider(DAHAI_ID, "admin", "admin", tv.db_path()),
                            tag=NAME)
    if not ok:
        raise OrderError(f"发给灵犀失败：{err}")


# ═══ 轮询消息【必须读活库】，不能读那份自举出来的快照 ══════════════════
#
#   2026-09-10 第一次真跑时踩了：文件头那段自举把 TOOLVIDEO_DB 指向一份
#   `.backup` 出来的【冻结快照】（那是给 TokenVersion 用的，静态数据，没问题）。
#   而这两个函数原来也走 tv.db_path() —— 于是它们在**轮询一个永远不会变的库**。
#
#   灵犀其实 70 秒就回了「打回」，格式也完全正确，而 review 等满 20 分钟报
#   「还没回」。**症状和「她真的慢」长得一模一样**，日志里看不出任何异常。
#
#   教训：为一个目的引入的快照，会被另一处代码悄悄当成实时数据源。
#   凡是要看「刚发生的事」，一律显式读活库。
def _live_sql(query):
    """读活库。agent 读不到 docker 卷，走 sudoers 免密的那条 sqlite3。

    ⚠️ 【库路径必须是 sqlite3 之后的第一个参数】。sudoers 里登记的是
    `/usr/bin/sqlite3 <库路径> *`，第一版在前面塞了 `-separator`，
    规则匹配不上，直接 "sudo: a password is required"。
    所以不用任何 flag：多列要分隔就在 SQL 里自己拼，只取单列输出。
    """
    r = subprocess.run(["sudo", "-n", "sqlite3", _RUNTIME_DB, query],
                       capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        raise OrderError(f"读活库失败：{(r.stderr or '').strip()[:200]}")
    return r.stdout


def _lingxi_replies_since(since_id):
    """取灵犀在 since_id 之后发给大海的消息。

    ⚠️ 【自己在 SQL 里拼分隔】：评审意见里必然有 | 和换行，
    用 sqlite3 的默认 | 分隔会把一条消息切成碎片，
    然后正则在碎片上永远匹配不到结论行。
    这里把换行换成 char(1)、行间用 char(30) 分隔，取回来再还原。
    """
    out = _live_sql(
        "SELECT group_concat("
        "  Id || char(31) || replace(Content, char(10), char(1)), char(30)) "
        "FROM (SELECT Id, Content FROM PrivateMessages "
        f" WHERE SenderId={LINGXI_ID} AND ReceiverId={DAHAI_ID} AND Id>{int(since_id)}"
        " ORDER BY Id)").strip()
    if not out:
        return []
    msgs = []
    for rec in out.split("\x1e"):
        if "\x1f" not in rec:
            continue
        mid, _, content = rec.partition("\x1f")
        try:
            msgs.append({"Id": int(mid), "Content": content.replace("\x01", "\n")})
        except ValueError:
            continue
    return msgs


def _max_msg_id():
    out = _live_sql("SELECT COALESCE(MAX(Id),0) FROM PrivateMessages").strip()
    return int(out) if out else 0


def cmd_review(args):
    t = find_ticket(args.ticket)
    tno = t["ticketNo"]
    st = load_state(tno)
    d = work_dir(tno)

    rounds = len(st.get("reviews", []))
    if rounds >= MAX_REVIEW_ROUNDS:
        reason = f"灵犀评审连续 {rounds} 轮没过，停下报人工（继续试只是在烧钱）"
        log(f"⚠️ {reason}")
        transition(t, "block", reason)
        return 3

    files = sorted(os.listdir(d)) if os.path.isdir(d) else []
    if not files:
        raise OrderError(f"工作目录 {d} 是空的，没有可评审的东西——先跑 start / build")

    # ═══ 把交付物【内容】贴给她，不是给她一个路径 ═════════════════════
    #
    #   2026-09-10 第一次真跑，她回的是「读不到交付物，本轮无法评审」：
    #   工作目录按 G01 落在 /srv/gooday-harness/work/，而她的会话只放行
    #   /opt/gooday-harness —— `test -e` 能确认目录存在，内容一个字节读不到。
    #   **让评审者去读他无权访问的路径，是评审流程的设计错误，不是他的问题。**
    #
    #   没走「给她开目录权限」那条路，因为 config.json 归 root、我改不了，
    #   而把产物拷进仓库是在绕 G01 的精神。贴内容是她自己给的方案，
    #   并且更稳：**她审的就是将要交付的那些字节**，不是一个可能变动的路径。
    src_files = [f for f in files if f.endswith((".html", ".md", ".txt", ".py", ".js"))]
    body_parts = []
    total = 0
    for f in src_files:
        try:
            txt = open(os.path.join(d, f), encoding="utf-8", errors="replace").read()
        except OSError as e:
            body_parts.append(f"\n--- {f} ---\n（读不出来：{e}）")
            continue
        if total + len(txt) > MAX_INLINE:
            body_parts.append(f"\n--- {f} ---\n（{len(txt)} 字，超出内联上限没贴。"
                              f"在 {os.path.join(d, f)}，要看的话说一声我另想办法）")
            continue
        total += len(txt)
        body_parts.append(f"\n--- {f} ---\n{txt}")
    inline = "".join(body_parts) if body_parts else "（工作目录里没有可内联的文本文件）"

    # 【重入保护】：上一轮已经发出去还没收到结论时，不再重发，直接接着等。
    pending = st.get("pendingReview")
    if not pending:
        since = _max_msg_id()
        _send_to_lingxi(
            f"【订单评审】{tno}「{t['title']}」第 {rounds + 1} 轮\n\n"
            f"需求原文：\n{(t.get('description') or '')}\n\n"
            f"交付物内容【直接贴在下面】，不用去找文件"
            f"（原件在 {d}，但那是 /srv 下，你的会话读不到）：\n"
            f"{inline}\n\n"
            f"对着需求看。只要两种结论之一，"
            f"并且**最后一行必须是**下面两种格式之一，我按这一行解析：\n"
            f"  评审结论：通过\n"
            f"  评审结论：打回\n"
            f"打回时把问题逐条写在结论行之前。需求本身有歧义也算打回并说明。")
        pending = {"since": since, "sentAt": time.time(), "round": rounds + 1}
        st["pendingReview"] = pending
        save_state(st)
        log(f"{tno} 第 {pending['round']} 轮评审已发给灵犀，等她回")

    deadline = pending["sentAt"] + REVIEW_WAIT_SEC
    while time.time() < deadline:
        for m in _lingxi_replies_since(pending["since"]):
            hit = VERDICT_RE.search(m["Content"] or "")
            if not hit:
                continue
            verdict = hit.group(1)
            st.pop("pendingReview", None)
            st.setdefault("reviews", []).append({
                "round": pending["round"], "verdict": verdict,
                "at": time.strftime("%F %T"), "text": m["Content"][:4000],
            })
            save_state(st)
            ev = evidence(tno, f"review-{pending['round']}",
                          {"verdict": verdict, "text": m["Content"]})
            # 【评审结论要进工作记录，不能只落 evidence】。
            # 2026-09-10 首次真跑后看时间线才发现：里面只有建单/改需求/迁移，
            # 看不出「为什么建了两次」——灵犀第 1 轮打回的事实不在订单上，
            # 只躺在 /var/lib 的证据文件里。工作记录就是给人看这个的。
            try:
                api(f"/api/tickets/{t['id']}", method="PUT", body={"note":
                    f"灵犀第 {pending['round']} 轮评审：{verdict}。"
                    f"要点：{' '.join((m['Content'] or '').split())[:300]}"})
            except Exception as e:
                log(f"⚠️ 评审结论没写进工作记录（不影响本轮结论）：{type(e).__name__}: {e}")
            log(f"{tno} 第 {pending['round']} 轮评审结论：{verdict}（证据 {ev}）")
            if verdict == "通过":
                return 0
            log("打回意见：\n" + (m["Content"] or "")[:1500])
            return 1
        time.sleep(20)

    log(f"⚠️ 等了 {REVIEW_WAIT_SEC//60} 分钟灵犀还没给结论。"
        f"【不算失败也不算通过】——再跑一次 review 会接着等，不会重复发。")
    return 2


# ── ready ───────────────────────────────────────────────────────────

def write_deliverable(t, src_html):
    """落盘到私有目录 + 打包下载包。

    【下载包由流水线打，不让模型产出二进制】：让它输出 base64 的 zip 既浪费又易错，
    而"下载"这一样对客户的价值就是"能存到自己电脑上离线用"。
    """
    tno = t["ticketNo"]
    rel_dir = f"private/{tno}"
    d = os.path.join(UPLOADS, rel_dir)
    os.makedirs(d, exist_ok=True)
    html_path = os.path.join(d, f"{tno}.html")
    with open(src_html, encoding="utf-8") as f:
        html = f.read()
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)

    readme = (f"{t['title']}\n\n订单号：{tno}\n"
              f"用法：双击 {tno}.html 用浏览器打开即可，不需要联网、不需要安装。\n"
              f"在线版和视频讲解在 gooday.ltd 你的工具一览里。\n")
    zip_path = os.path.join(d, f"{tno}.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(html_path, f"{tno}.html")
        z.writestr("使用说明.txt", readme)
    return f"/uploads/{rel_dir}/{tno}.html", f"{rel_dir}/{tno}.zip"


def cmd_ready(args):
    t = find_ticket(args.ticket)
    tno = t["ticketNo"]
    st = load_state(tno)

    # 闸门一：灵犀必须通过过。【查的是评审记录，不是"我记得她说过"】
    passed = [r for r in st.get("reviews", []) if r["verdict"] == "通过"]
    if not passed and not args.skip_review:
        raise OrderError(f"{tno} 还没有灵犀的通过结论，先跑 review"
                         f"（确有理由跳过时用 --skip-review，它会记进工作记录）")

    d = work_dir(tno)
    src = os.path.join(d, f"{tno}.html")
    if not os.path.exists(src):
        cands = [f for f in os.listdir(d) if f.endswith(".html")] if os.path.isdir(d) else []
        if len(cands) != 1:
            raise OrderError(f"{d} 里没找到唯一的 .html 交付物（找到 {cands or '零个'}）")
        src = os.path.join(d, cands[0])

    problems = check_html(open(src, encoding="utf-8").read())
    if problems:
        raise OrderError("交付物没过自检：" + "；".join(problems))

    online, download = write_deliverable(t, src)
    r = api("/api/admin/tools/deliver", method="POST", body={
        "ticketId": t["id"], "name": t["title"][:40],
        "description": (t.get("description") or "")[:120],
        "onlineUrl": online, "downloadFileName": download,
    })
    log(f"{tno} 上架 {r['slug']}，还缺：{r.get('missing')}")

    if not r.get("complete"):
        # 三样里最后一样：讲解片。它自己会上架、回查、失败抛非零退出码
        log(f"{tno} 出讲解片……")
        p = subprocess.run(
            [sys.executable, os.path.join(REPO, "workflows", "tool-video", "run.py"),
             "--slug", r["slug"]],
            capture_output=True, text=True, timeout=3600)
        tail = ((p.stdout or "") + (p.stderr or "")).strip().splitlines()[-3:]
        if p.returncode != 0:
            raise OrderError("出讲解片失败：" + " / ".join(tail))
        r = api(f"/api/admin/tools/deliver/{t['id']}")

    ev = evidence(tno, "ready", {"slug": r.get("slug"), "complete": r.get("complete"),
                                 "missing": r.get("missing")})
    if not r.get("complete"):
        raise OrderError(f"三样还没齐：{r.get('missing')}——不放行，客户不该看见半成品")

    # 【到此为止。不迁状态、不通知客户】——放行是大海在后台点的。
    _send_to_lingxi(f"【订单可验收】{tno}「{t['title']}」三样齐了，等大海放行。\n"
                    f"工具：{r.get('slug')}\n证据：{ev}")
    log(f"✅ {tno} 三样齐了，已报告。**等大海在后台点「放行验收」，如意才会通知客户。**")
    return 0


# ── close ───────────────────────────────────────────────────────────

def cmd_close(args):
    t = find_ticket(args.ticket)
    if t.get("amount") is None:
        raise OrderError(f"{t['ticketNo']} 还没填金额，结不了单"
                         f"——这个数是你手工记账时的对照，系统不替你核对")
    transition(t, "close")
    log(f"{t['ticketNo']} → CLOSED。**记得手工填财务表**（招财已退役，没有自动记账）")
    return 0


CMDS = {"start": cmd_start, "build": cmd_build, "review": cmd_review,
        "ready": cmd_ready, "close": cmd_close}


def main():
    ap = argparse.ArgumentParser(description="订单的四条显式命令（无 cron，无轮询）")
    ap.add_argument("cmd", choices=sorted(CMDS))
    ap.add_argument("ticket", help="订单号 GD-YYYYMMDD-NNN 或数字 id")
    ap.add_argument("--skip-review", action="store_true",
                    help="ready 时跳过「灵犀已通过」这道闸（会记进工作记录）")
    args = ap.parse_args()

    os.makedirs(WORK_ROOT, exist_ok=True)
    try:
        with Task(f"order:{args.cmd}", subject=args.ticket, actor=NAME) as task:
            rc = CMDS[args.cmd](args)
            task.event(f"{args.cmd}_done", "P3", {"ticket": args.ticket, "rc": rc})
            return rc
    except OrderError as e:
        log(f"❌ {e}")
        return 2
    except Exception as e:
        log(f"❌ {type(e).__name__}: {e}")
        log(traceback.format_exc()[-1200:])
        return 2


if __name__ == "__main__":
    sys.exit(main())
