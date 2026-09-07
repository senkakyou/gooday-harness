#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""招财 · AI 财务。轮询私信，回答站长的财务提问、确认收款。

从旧 zhaocai_bot.py（665 行）重新设计。结构上的四点不同：

1. **prompt 提到 `prompt.md`**——原来硬编码在 .py 里，改一句话要动代码，
   也没法单独 review 或做 A/B 对比。
   顺带补上旧版**完全没有**的注入防御条款与「资金判定永不自愈」铁则。
2. **底层设施走 `packages/botkit`**——并发闸门、白名单、重试、幂等认领
   不再各 bot 抄一份。
3. **每轮 ＋ 每次处理都留 Task/Event**（G07）。
4. **默认只读模式**：迁移期不写数据库、不发消息，只算不做。
   旧 bot 仍在跑，两个财务同时对同一笔款入账是灾难。

⚠️ 本 bot 涉及钱。`prompt.md` 里那条「资金相关判定永不自愈」是硬规矩：
金额对不上就停下来问人，任何"聪明"的自动处理在钱上都是负资产。
"""
import json
import os
import re
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages", "trace"))
sys.path.insert(0, os.path.join(REPO, "packages", "botkit"))

from trace import Task                                    # noqa: E402
import model as mdl                                       # noqa: E402
import outbound                                           # noqa: E402
import inbox                                              # noqa: E402

NAME = "bot-zhaocai"
STATE_DIR = f"/var/lib/gooday-harness/state/{NAME}"
HEARTBEAT = os.path.join(STATE_DIR, "heartbeat")
CONFIG = os.path.join(HERE, "config.json")
PROMPT = os.path.join(HERE, "prompt.md")


def log(msg):
    print(f"[{NAME}] {time.strftime('%F %T')} {msg}", flush=True)


def load_cfg():
    with open(CONFIG, encoding="utf-8") as f:
        return {k: v for k, v in json.load(f).items() if not k.startswith("_")}


def system_prompt():
    """从 prompt.md 读。HTML 注释是给人看的，剥掉再送模型。"""
    with open(PROMPT, encoding="utf-8") as f:
        return re.sub(r"<!--.*?-->", "", f.read(), flags=re.S).strip()


def heartbeat():
    """铁律：每轮都写。systemd 只知道进程在不在，不知道它有没有在干活。"""
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(HEARTBEAT, "w") as f:
            f.write(str(int(time.time())))
    except Exception as e:
        log(f"心跳写入失败: {e}")


def db(cfg):
    return sqlite3.connect(cfg["db"], timeout=10)


def unread(cfg):
    """取未读私信。只读——迁移期绝不标已读，否则会把旧 bot 的活抢了。"""
    conn = db(cfg)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT Id, SenderId, SenderUsername, Content, CreatedAt "
            "FROM PrivateMessages WHERE ReceiverId=? AND IsRead=0 ORDER BY Id",
            (cfg["bot_id"],)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def finance_context(cfg):
    """把财务事实先查好注入 prompt，而不是让模型自己去查。

    理由（旧系统的教训）：让模型在沙箱里自己跑 sqlite3 时，
    命令可能不可用，它会跳过查询【靠记忆编造】——数字型的幻觉最危险。
    """
    conn = db(cfg)
    try:
        parts = []
        for label, sql in (
            ("本月收入", "SELECT COALESCE(SUM(CAST(Amount AS REAL)),0) FROM FinanceRecords "
                       "WHERE Type='income' AND PaymentStatus='received' "
                       "AND CreatedAt >= date('now','start of month')"),
            ("待收款", "SELECT COALESCE(SUM(CAST(Amount AS REAL)),0) FROM FinanceRecords "
                     "WHERE Type='income' AND PaymentStatus='pending'"),
            ("待收笔数", "SELECT COUNT(*) FROM FinanceRecords "
                      "WHERE Type='income' AND PaymentStatus='pending'"),
        ):
            try:
                parts.append(f"{label}: {conn.execute(sql).fetchone()[0]}")
            except Exception as e:
                # 查不到要说清楚，不能留空让模型自己脑补
                parts.append(f"{label}: 查询失败（{type(e).__name__}）")
        return "【当前财务事实（系统查得，可直接引用）】\n" + "\n".join(parts)
    finally:
        conn.close()


def main():
    if not os.path.exists(CONFIG):
        log(f"缺 {CONFIG}，从 config.example.json 拷一份改")
        return 2
    cfg = load_cfg()
    readonly = cfg.get("mode", "readonly") != "active"

    outbound.configure({cfg["bot_id"]: set(cfg.get("may_send_to", []))},
                       api_base=cfg.get("api_base"))

    log(f"启动，bot_id={cfg['bot_id']}，模式={'只读' if readonly else '生产'}")
    sysp = system_prompt()

    while True:
        heartbeat()
        try:
            msgs = unread(cfg)
            if msgs:
                with Task("zhaocai-poll", subject=str(len(msgs)), actor=NAME) as task:
                    groups = inbox.group_by_sender(msgs)
                    task.event("inbox", "P3",
                               {"messages": len(msgs), "senders": list(groups)})

                    def handle(sender_id, batch):
                        if sender_id not in cfg.get("serves", []):
                            task.event("ignored_sender", "P3", {"sender": sender_id})
                            return
                        merged = "\n".join(m["Content"] for m in batch)
                        prompt = (f"{finance_context(cfg)}\n\n"
                                  f"---\n站长的消息：\n{merged}")
                        text, ok, err = mdl.call(prompt, sysp, tag=NAME,
                                                 model=cfg.get("model"),
                                                 timeout=cfg.get("timeout_sec", 300))
                        if not ok:
                            if mdl.is_infra_error(err):
                                # 基础设施问题必须给明确回执并上报，
                                # 否则会表现成「AI 今天有点笨」，没人去查凭据
                                task.event("infra_error", "P0", {"error": err})
                                raise RuntimeError(mdl.INFRA_REPLY)
                            raise RuntimeError(f"模型调用失败: {err}")

                        if readonly:
                            # 只读模式：算出来但不发。旧 bot 仍在跑，
                            # 两个财务同时对同一笔款入账是灾难。
                            task.event("reply_suppressed", "P3",
                                       {"sender": sender_id, "preview": text[:200]})
                            log(f"[只读] 对 {sender_id} 本应回复：{text[:80]}")
                        else:
                            outbound.send(cfg["bot_id"], sender_id, text.strip(),
                                          token_provider=cfg["_token_provider"],
                                          tag=NAME)

                    def on_error(sender_id, exc):
                        """失败必给回执——绝不静默吞掉。"""
                        msg = str(exc) if str(exc).startswith("⚠️") else \
                            "⚠️ 处理异常，已记录，请稍后重试"
                        if readonly:
                            log(f"[只读] 对 {sender_id} 本应回执：{msg}")
                        else:
                            outbound.send(cfg["bot_id"], sender_id, msg,
                                          token_provider=cfg["_token_provider"],
                                          tag=NAME)

                    ok_n, fail_n = inbox.process(NAME, groups, handle, on_error,
                                                 task=task)
                    task.event("poll_done", "P3", {"ok": ok_n, "failed": fail_n})
        except Exception as e:
            log(f"主循环异常: {e}")          # 主循环永不退出
        time.sleep(cfg.get("poll_sec", 5))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        log(f"致命错误: {e}")
        sys.exit(1)          # 必须 exit(1)，否则 Restart=always 也不会拉起
