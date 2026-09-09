#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bot 的共同主循环。

抽出来的时机是刻意的：迁到第 2 个 bot 时才抽，不是一开始就抽。
`packages/` 的判据是「被 ≥2 处用到才建」——过早抽公共库会制造无谓的耦合，
而且改一处要验 N 处。

各 bot 的差异只剩三处，用回调注入：
  · `context(cfg)`      要先查好什么事实注入 prompt
  · `serves`            服务谁（其他人的消息根本不处理）
  · `on_reply(...)`     拿到模型输出之后干什么（多数就是回复）

共同部分（每个 bot 都必须有、且都容易写错的）：
  心跳 · 只读模式 · 按发送者合并 · 失败必回执 · 基础设施错误单独报 P0 · 留痕
"""
import json
import os
import re
import sqlite3
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "trace"))

from trace import Task                                    # noqa: E402
import model as mdl                                       # noqa: E402
import auth                                               # noqa: E402
import outbound                                           # noqa: E402
import inbox                                              # noqa: E402


class Bot:
    def __init__(self, name, here, *, context=None, on_reply=None):
        self.name = name
        self.here = here
        self.state_dir = f"/var/lib/gooday-harness/state/{name}"
        self.heartbeat_path = os.path.join(self.state_dir, "heartbeat")
        self.cfg = self._load_cfg()
        self.context = context or (lambda cfg: "")
        # context 有两种签名：老的 (cfg)，新的 (cfg, sender_id)——
        # 后者才能查"这个客户自己的记录"。这里探一次，两种都兼容，
        # 免得为了加个参数去改所有 bot（改不全的那个会当场起不来）
        try:
            import inspect
            self._ctx_takes_sender = len(inspect.signature(self.context).parameters) >= 2
        except (TypeError, ValueError):
            self._ctx_takes_sender = False
        self.on_reply = on_reply
        self.readonly = self.cfg.get("mode", "readonly") != "active"

        outbound.configure({self.cfg["bot_id"]: set(self.cfg.get("may_send_to", []))},
                           api_base=self.cfg.get("api_base"))

        # token_provider 只在真要发消息时才需要。只读模式下不构造——
        # 那样即使 .env 缺失也能跑起来观察，不会因为一个用不到的依赖而起不来。
        self._token = None
        if not self.readonly:
            self._token = auth.provider(self.cfg["bot_id"],
                                        self.cfg.get("username", str(self.cfg["bot_id"])),
                                        self.cfg.get("role", "staff"),
                                        self.cfg["db"])

    # ── 基础 ──────────────────────────────────────────────
    def log(self, msg):
        print(f"[{self.name}] {time.strftime('%F %T')} {msg}", flush=True)

    def _load_cfg(self):
        p = os.path.join(self.here, "config.json")
        if not os.path.exists(p):
            print(f"[{self.name}] 缺 {p}，从 config.example.json 拷一份改",
                  file=sys.stderr)
            sys.exit(2)
        with open(p, encoding="utf-8") as f:
            return {k: v for k, v in json.load(f).items() if not k.startswith("_")}

    def system_prompt(self):
        """从 prompt.md 读。HTML 注释是给人看的说明，剥掉再送模型。"""
        with open(os.path.join(self.here, "prompt.md"), encoding="utf-8") as f:
            return re.sub(r"<!--.*?-->", "", f.read(), flags=re.S).strip()

    def heartbeat(self):
        """铁律：每轮都写。systemd 只知道进程在不在，不知道它在不在干活。"""
        try:
            os.makedirs(self.state_dir, exist_ok=True)
            with open(self.heartbeat_path, "w") as f:
                f.write(str(int(time.time())))
        except Exception as e:
            self.log(f"心跳写入失败: {e}")

    # ── 收件 ──────────────────────────────────────────────
    def unread(self):
        """取未读。"""
        conn = sqlite3.connect(self.cfg["db"], timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT Id, SenderId, SenderUsername, Content, CreatedAt "
                "FROM PrivateMessages WHERE ReceiverId=? AND IsRead=0 ORDER BY Id",
                (self.cfg["bot_id"],)).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def history(self, sender_id, exclude_ids=()):
        """取和这个人之前聊过的话，按时间正序。

        ═══ 这里出过一次真事故（2026-09-09）═══════════════════════

        原来【没有这个方法】：每轮轮询只把"本轮未读"喂给模型，
        于是每一轮都是失忆重来。表现在客户那边是这样的——

            客户：我想做一个行程规划软件，输入大连到昆明和出发日期……
            如意：（问了三个问题）
            客户：最优肯定是又快又便宜
            如意：您手上这个想做点什么？大概说说思路
            客户：我刚才不是说了吗，你不看我需求吗
            如意：我这会儿手头没看到你之前发的需求内容

        她说的是实话——她真的看不到。更糟的是 prompt 里写着
        「系统会在每次对话里附上该客户的需求订单、客户档案、工单进度，
        开口前先看，别把客户已经说过的再问一遍」：
        **提示词承诺了一份资料，代码从来没附过。**
        模型被要求去看一份不存在的东西，只好当作客户什么都没说。

        所以历史必须由这一层统一给，而不是指望每个 bot 自己记得查。
        ═══════════════════════════════════════════════════════
        """
        n = int(self.cfg.get("history_n", 20) or 0)
        if n <= 0:
            return ""
        me = self.cfg["bot_id"]
        conn = sqlite3.connect(self.cfg["db"], timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT Id, SenderId, Content FROM PrivateMessages "
                "WHERE (SenderId=? AND ReceiverId=?) OR (SenderId=? AND ReceiverId=?) "
                "ORDER BY Id DESC LIMIT ?",
                (sender_id, me, me, sender_id, n + len(exclude_ids) + 5)).fetchall()
        except Exception as e:
            self.log(f"取会话历史失败（不阻断本轮）: {e}")
            return ""
        finally:
            conn.close()

        keep = [r for r in rows if r["Id"] not in set(exclude_ids)][:n]
        keep.reverse()
        lines = []
        for r in keep:
            who = "我" if r["SenderId"] == me else "对方"
            c = " ".join((r["Content"] or "").split())
            if len(c) > 400:            # 单条截断，防一条长文把上下文吃光
                c = c[:400] + "…"
            if c:
                lines.append(f"{who}：{c}")
        return "\n".join(lines)

    def mark_read(self, ids):
        """把这批消息标已读。

        ═══ 这里出过一次真事故（2026-09-07）═══════════════════════

        原来这个方法【不存在】，`unread()` 的注释写着
        「只读——迁移期绝不标已读，否则会把旧 bot 的活抢了」。
        那在影子模式下是对的：两套 bot 并存时抢标已读会把旧 bot 的活截胡。

        但**迁移结束后没人关掉它**。旧 bot 早停了、这边已是生产模式，
        于是每轮轮询（5 秒）都把同一条消息当新消息重答一次——
        站长发一句「你好」，灵犀连回了 14 条。

        而这段时间里：心跳绿的、服务 active、patrol 全绿、日志无异常。
        **结构在、但没在起作用，且没有任何东西会说。**
        区别只在于这次是「防护措施活过了它该在的时期，自己变成了故障」。

        ═══ 时序：处理完之后才标 ═══════════════════════════════

        处理【前】标 → 中途崩溃 = 消息静默丢失，用户永远等不到回复。
        处理【后】标 → 中途崩溃 = 最多重复回一条（看得见、能补救）。
        选后者：宁可重复一次，不可静默丢失。

        只读模式仍然绝不标——那是影子模式的全部意义。
        """
        if self.readonly:
            return                    # 影子模式：看得见，但不认领
        if not ids:
            return
        try:
            conn = sqlite3.connect(self.cfg["db"], timeout=10)
            try:
                conn.execute(
                    "UPDATE PrivateMessages SET IsRead=1 WHERE Id IN "
                    f"({','.join('?' * len(ids))})", list(ids))
                conn.commit()
            finally:
                conn.close()
        except Exception as e:
            # 【必须喊出来】：标不上就会重复应答同一条，正是上面那次事故。
            # 静默失败在这里等于把故障重新装回去。
            self.log(f"⚠️ 标已读失败（会导致重复回复！）ids={list(ids)[:5]}: {e}")

    def send(self, to, text):
        if self.readonly:
            self.log(f"[只读] 对 {to} 本应发送：{text[:80]}")
            return False
        if self._token is None:
            self.log(f"⚠️ 无 token_provider，发送中止（→{to}）")
            return False
        # 超长分段由 outbound.send 自己兜（服务端 content 上限 4000 字，
        # 超了直接 400、整条消失，2026-09-08 真丢过一份长评审）。
        # 【保证放在 send 里，不放在这里】——第一版修在这里，等于要求
        # 每个调用方都记得，而 `send_segments` 早就存在、没人调用，
        # 恰恰证明了「要求人记得」这个结构不成立。
        return outbound.send(self.cfg["bot_id"], to, text,
                             token_provider=self._token, tag=self.name)[0]

    # ── 主循环 ────────────────────────────────────────────
    def run(self):
        self.log(f"启动，bot_id={self.cfg['bot_id']}，"
                 f"模式={'只读' if self.readonly else '生产'}")
        sysp = self.system_prompt()

        while True:
            self.heartbeat()
            try:
                msgs = self.unread()
                if msgs:
                    self._handle_batch(msgs, sysp)
            except Exception as e:
                self.log(f"主循环异常: {e}")      # 主循环永不退出
            time.sleep(self.cfg.get("poll_sec", 5))

    def _handle_batch(self, msgs, sysp):
        with Task(f"{self.name}-poll", subject=str(len(msgs)),
                  actor=self.name) as task:
            groups = inbox.group_by_sender(msgs)
            task.event("inbox", "P3",
                       {"messages": len(msgs), "senders": list(groups)})

            def handle(sender_id, batch):
                if sender_id not in self.cfg.get("serves", []):
                    # 不服务的人：根本不处理，也不回复。
                    # 「不是不回，是不处理」——这是角色边界，不是礼貌问题。
                    task.event("ignored_sender", "P3", {"sender": sender_id})
                    return
                merged = "\n".join(m["Content"] for m in batch)
                ctx = self.context(self.cfg, sender_id) if self._ctx_takes_sender \
                    else self.context(self.cfg)
                # 会话历史：本轮未读单独作为"新消息"给出，不重复塞进历史里
                hist = self.history(sender_id, exclude_ids=[m["Id"] for m in batch])
                parts = []
                if ctx:
                    parts.append(ctx)
                if hist:
                    parts.append("【你和这个人之前聊过的（越往下越近）】\n" + hist +
                                 "\n\n上面是已经发生过的对话。**客户说过的不要再问一遍**，"
                                 "打过招呼就别再自我介绍。")
                parts.append(f"---\n新消息：\n{merged}")
                prompt = "\n\n".join(parts)

                text, ok, err = mdl.call(prompt, sysp, tag=self.name,
                                         model=self.cfg.get("model"),
                                         timeout=self.cfg.get("timeout_sec", 300))
                if not ok:
                    if mdl.is_infra_error(err):
                        # 基础设施问题单独报 P0：不这样分的话，
                        # 凭据失效会表现成「AI 今天有点笨」，没人去查凭据
                        task.event("infra_error", "P0", {"error": err})
                        raise RuntimeError(mdl.INFRA_REPLY)
                    raise RuntimeError(f"模型调用失败: {err}")

                if self.on_reply:
                    self.on_reply(self, sender_id, batch, text, task)
                elif self.readonly:
                    task.event("reply_suppressed", "P3",
                               {"sender": sender_id, "preview": text[:200]})
                    self.log(f"[只读] 对 {sender_id} 本应回复：{text[:80]}")
                else:
                    self.send(sender_id, text.strip())

            def on_error(sender_id, exc):
                """失败必给回执——绝不静默吞掉。"""
                msg = str(exc) if str(exc).startswith("⚠️") else \
                    "⚠️ 处理异常，已记录，请稍后重试"
                self.send(sender_id, msg)

            ok_n, fail_n = inbox.process(self.name, groups, handle, on_error,
                                         task=task, mark_read=self.mark_read)
            task.event("poll_done", "P3", {"ok": ok_n, "failed": fail_n})
