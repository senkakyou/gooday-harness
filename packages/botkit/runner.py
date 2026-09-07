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
        self.on_reply = on_reply
        self.readonly = self.cfg.get("mode", "readonly") != "active"

        outbound.configure({self.cfg["bot_id"]: set(self.cfg.get("may_send_to", []))},
                           api_base=self.cfg.get("api_base"))

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
        """取未读。只读——迁移期绝不标已读，否则会把旧 bot 的活抢了。"""
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

    def send(self, to, text):
        if self.readonly:
            self.log(f"[只读] 对 {to} 本应发送：{text[:80]}")
            return False
        return outbound.send(self.cfg["bot_id"], to, text,
                             token_provider=self.cfg.get("_token_provider",
                                                         lambda _f: ""),
                             tag=self.name)[0]

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
                ctx = self.context(self.cfg)
                prompt = (f"{ctx}\n\n---\n消息：\n{merged}" if ctx else merged)

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
                                         task=task)
            task.event("poll_done", "P3", {"ok": ok_n, "failed": fail_n})
