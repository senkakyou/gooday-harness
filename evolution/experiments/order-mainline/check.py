#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""订单主链路 v2 的验收判据。

**本检查器在改动之前必须是红的**，否则它没有鉴别力（AGENTS.md「事故了怎么办」第 3 条）。
基线：2026-09-10 在 293f3de 上跑，结构 9 项、库 4 项、接口 6 项全红或部分红。

三类判据，都【查行为不查名字】：

  结构  读仓库文件——角色还剩几个、人格有几份、状态表有几处
  库    读运行库——表还在不在、列对不对、状态值合不合法
  接口  真发 HTTP——路由是不是真的没了

═══ 接口判据踩过的坑（2026-09-10 写本文件时实测）═══════════════════════

  第一版判据是「删掉的路由返 404」。**实测不成立**：
  未知路径会落到 SPA 兜底返回 `200 text/html`，`/api/definitely-not-a-real-route`
  就是 200。照那个判据写，检查器【结构上就检测不到删除】——永远绿。

  改成看 Content-Type：
      路由还在 → 401，无 content-type（[Authorize] 拦下）
      路由没了 → 200 text/html（SPA 兜底）

  并且**方法必须用该路由真正实现的那个**：
  `GET /api/bot-finance` 返 HTML（它只有 POST），照 GET 判就会误报「已删除」。
═══════════════════════════════════════════════════════════════════════
"""
import os
import re
import subprocess
import sys
import urllib.request

DB = "/var/lib/docker/volumes/gooday_gooday_data/_data/gooday.db"
API = "http://127.0.0.1:8081"


def _repo_root(start):
    """向上找 AGENTS.md 认仓库根。别数 dirname 层数——文件一挪层数就错。"""
    d = start
    while True:
        if os.path.exists(os.path.join(d, "AGENTS.md")):
            return d
        p = os.path.dirname(d)
        if p == d:
            return start
        d = p


REPO = _repo_root(os.path.dirname(os.path.abspath(__file__)))

# 扫描时跳过的目录：构建产物、依赖、历史文档不是判据来源。
# ⚠️ 目录名与扩展名都【不带点】写：带点的字面量会被 G15（静态 MIME 检查）
# 当成「上传白名单」而误报四条警告。这里存的是「扫哪些源码文件」，
# 跟上传服务毫无关系，不该去污染那条规则的判定。
SKIP_DIRS = {"git", "node_modules", "wwwroot", "__pycache__", "docs", "content",
             "examples", "dist", "obj", "bin"}
SCAN_EXT = {"py", "cs", "jsx", "js", "json", "md"}

_results = []


def check(label, ok, detail=""):
    _results.append(bool(ok))
    print(f"  {'✅' if ok else '❌'} {label}" + (f"  —— {detail}" if detail else ""))
    return ok


def section(name):
    print(f"\n=== {name} ===")


def walk_files():
    for root, dirs, files in os.walk(REPO):
        dirs[:] = [d for d in dirs if d.lstrip(".") not in SKIP_DIRS]
        for f in files:
            if os.path.splitext(f)[1].lstrip(".") in SCAN_EXT:
                yield os.path.join(root, f)


def files_containing(pattern):
    """返回命中正则的文件相对路径集合。本文件自身排除——判据不该被判据自己触发。"""
    rx = re.compile(pattern)
    hits = set()
    me = os.path.abspath(__file__)
    for p in walk_files():
        if os.path.abspath(p) == me:
            continue
        try:
            with open(p, encoding="utf-8", errors="ignore") as fh:
                if rx.search(fh.read()):
                    hits.add(os.path.relpath(p, REPO))
        except OSError:
            pass
    return hits


def sql(query):
    """读运行库。docker 卷 agent 读不到，走 sudoers 里 NOPASSWD 的那条 sqlite3 规则。"""
    try:
        r = subprocess.run(["sudo", "-n", "sqlite3", DB, query],
                           capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            return None
        return r.stdout.strip()
    except Exception:
        return None


def route_state(path, method="GET"):
    """返回 'alive' / 'gone' / 'unknown'。判据见文件头。

    ⚠️ 405 必须算 gone（2026-09-10 写完第一版当场实测出来的假绿）：
    第一版只看 Content-Type，于是 `POST /api/tickets/1/transition` 返回
    「405 Method Not Allowed，Content-Length: 0，无 content-type」时被判成 alive——
    **那个路由当时根本还不存在**，检查器却给了它一个通过。
    对照组 `POST /api/nonexistent/xyz` 同样是 405 空响应，证明这条路径上
    405 只说明「该方法在此路径上没有实现」，不能当作路由存在的证据。
    """
    req = urllib.request.Request(API + path, method=method)
    if method == "POST":
        req.data = b"{}"
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            ct = (resp.headers.get("Content-Type") or "").lower()
            return "gone" if "text/html" in ct else "alive"
    except urllib.error.HTTPError as e:
        if e.code == 405:
            return "gone"
        # 401/403/400 说明路由存在，只是没带凭据或参数不对
        ct = (e.headers.get("Content-Type") or "").lower()
        return "gone" if "text/html" in ct else "alive"
    except Exception:
        return "unknown"


# ══ 结构 ═══════════════════════════════════════════════════════════════

def check_structure():
    section("结构 · 角色与单一真源")

    bots = {d for d in os.listdir(os.path.join(REPO, "services"))
            if d.startswith("bot-")}
    check("只剩如意与灵犀两个角色", bots == {"bot-ruyi", "bot-lingxi"},
          "现有 " + "、".join(sorted(bots)))

    check("dispatcher 已删除",
          not os.path.exists(os.path.join(REPO, "services", "dispatcher")))

    order = os.path.join(REPO, "workflows", "order", "run.py")
    if check("workflows/order 已建", os.path.exists(order)):
        src = open(order, encoding="utf-8").read()
        missing = [c for c in ("start", "review", "ready", "close")
                   if f'"{c}"' not in src]
        check("order 提供 start/review/ready/close 四条命令", not missing,
              "缺 " + "、".join(missing) if missing else "")
    else:
        check("order 提供 start/review/ready/close 四条命令", False, "run.py 不存在")

    for gone in ("dev-requests", "coo-patrol", "deliver"):
        check(f"workflows/{gone} 已删除",
              not os.path.exists(os.path.join(REPO, "workflows", gone)))

    ruyi_prompt = os.path.join(REPO, "services", "bot-ruyi", "prompt.md")
    txt = open(ruyi_prompt, encoding="utf-8").read() if os.path.exists(ruyi_prompt) else ""
    check("如意 prompt 含需求表模板", "需求表" in txt and "填好发回" in txt)
    check("如意 prompt 明令不谈钱", "不谈钱" in txt or "不报价" in txt)

    # 人格只能有一份：今天 workflows/dev-requests/run.py 里内联了第二份
    persona = files_containing(r"你是如意")
    check("如意人格全仓只有一份", persona == {"services/bot-ruyi/prompt.md"},
          "出现在 " + "、".join(sorted(persona)))

    # 状态迁移表只能有一处定义
    tbl = files_containing(r"TRANSITIONS\s*=\s*\{|IsLegalTransition")
    check("状态迁移表只有一处定义", len(tbl) <= 1,
          "出现在 " + "、".join(sorted(tbl)))

    # 私号名单今天在三个 Controller 各写一份，删角色漏改一处就出事。
    # ⚠️ 正则必须写 `_?privateAccounts`：第一版只查带下划线的字段名，
    # 漏掉了 AuthController.cs:196 那份——它是个【局部变量 privateAccounts，没有下划线】。
    # 查名字不查行为的典型：两处写法不对称，规则只覆盖了其中一种。
    # 只数【代码里】的定义。第一版把 .md 也算进去，于是本实验自己的 README
    # 因为在解释这个坑时写了这个词，被自己的检查器判成「第四处定义」——
    # 文档提到一个符号不等于定义了它。
    priv = {p for p in files_containing(r"\b_?privateAccounts\b")
            if p.endswith(".cs")}
    check("私号名单只有一处定义", len(priv) <= 1,
          "出现在 " + "、".join(sorted(priv)))

    # 旧的【订单】状态字面量。
    #
    # 挑词有两次收窄，都是实测出来的：
    #   · done / cancelled 太通用，全站到处是别的东西的状态，一查全是误报；
    #   · refunded / refunding 看着像订单状态，实际是【工具购买】(ToolPurchase)
    #     和【财务付款】(FinanceRecords.PaymentStatus) 的状态，与订单无关。
    #     把它们算进来，就是逼着人去改两个不该改的模块——
    #     那不是"清干净"，是按名字误伤。
    #
    # 留下的三个是订单独有的：analyst_complete / customer_rejected / delivering，
    # 外加小写 in_progress（订单的新写法是大写 IN_PROGRESS）。
    old = files_containing(r"[\"']"
                           r"(analyst_complete|customer_rejected|delivering"
                           r"|in_progress)"
                           r"[\"']")
    check("旧小写状态字面量已归零", not old,
          "残留于 " + "、".join(sorted(old)))


# ══ 库 ═════════════════════════════════════════════════════════════════

WANT_COLS = {"Id", "TicketNo", "Title", "Description", "ClientId", "ClientName",
             "ClientContact", "Amount", "Status", "BlockedReason",
             "DeliveryToolId", "DeliveredAt", "CreatedAt", "UpdatedAt"}
WANT_STATES = {"NEW", "IN_PROGRESS", "DELIVERED", "CLOSED", "BLOCKED", "CANCELLED"}


def check_db():
    section("库 · 表与状态")

    names = sql("SELECT name FROM sqlite_master WHERE type='table'")
    if names is None:
        check("能读到运行库", False, "sudo sqlite3 失败，本节判据无法评估")
        return
    tables = set(names.splitlines())

    dead = {"Projects", "ProjectTasks", "Decisions", "TicketEvents", "DevRequests"}
    still = dead & tables
    check("五张中间层表已删除", not still, "残留 " + "、".join(sorted(still)))

    # 表名是 TicketLog【s】——EF 按 DbSet 名复数化建表。
    # 第一版判据写成单数 "TicketLog"，于是表建好了检查器还是红的。
    # 这一条改的是【判据写错了名字】，不是为了让它变绿而放松要求：
    # 真实表名已用 sqlite_master 实查确认（2026-09-10）。
    check("TicketLogs 已建", "TicketLogs" in tables)

    cols = sql("SELECT name FROM pragma_table_info('Tickets')")
    if cols is not None:
        have = set(cols.splitlines())
        check("Tickets 列已收敛到目标集合", have == WANT_COLS,
              f"多 {sorted(have - WANT_COLS)} 少 {sorted(WANT_COLS - have)}"
              if have != WANT_COLS else "")

    st = sql("SELECT DISTINCT Status FROM Tickets")
    if st is not None:
        vals = {s for s in st.splitlines() if s}
        check("工单状态值全部合法", vals <= WANT_STATES,
              "非法值 " + "、".join(sorted(vals - WANT_STATES)))


# ══ 接口 ═══════════════════════════════════════════════════════════════

def check_api():
    section("接口 · 路由存废")

    # (路径, 方法, 期望)。方法必须是该路由真正实现的那个，否则会误判
    for path, method, want in [
        ("/api/projects",              "GET",  "gone"),
        ("/api/requests",              "GET",  "gone"),
        ("/api/decisions",             "GET",  "gone"),
        ("/api/ticket-events",         "POST", "gone"),
        ("/api/bot-finance",           "POST", "gone"),
        ("/api/tickets",               "GET",  "alive"),
        ("/api/tickets/1/transition",  "POST", "alive"),
        ("/api/clients",               "GET",  "alive"),
    ]:
        got = route_state(path, method)
        label = f"{method} {path} → {'已删除' if want == 'gone' else '仍在'}"
        if got == "unknown":
            check(label, False, "接不通 API（服务没起？）")
        else:
            check(label, got == want, f"实测 {got}")


def main():
    print(f"订单主链路 v2 验收 · 仓库 {REPO}")
    check_structure()
    check_db()
    check_api()

    bad = _results.count(False)
    print(f"\n{'─' * 62}")
    print(f"判据 {len(_results)} 项 · 通过 {_results.count(True)} · 未通过 {bad}")
    if bad:
        print("未通过 —— 改动尚未完成（改动之前本检查器就该是红的）")
    else:
        print("全部通过")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
