#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""威震天 · AI 开发。按已付款工单生成交付物。

主循环走 packages/botkit/runner.py。本文件只剩威震天独有的部分：
**它处理的是工单，不是私信** ——所以覆盖 unread() 换成取待开发工单。

⚠️ 需求文本来自客户，是【注入的主要入口】。
prompt.md 的开发专属铁则里写死了：生成的代码绝不包含外发数据、
读取凭据、下载执行远程内容的逻辑。
"""
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "packages", "botkit"))

from runner import Bot                                    # noqa: E402

NAME = "bot-weizhentian"


class DevBot(Bot):
    """开发 bot 的输入是工单，不是私信。"""

    def history(self, sender_id, exclude_ids=()):
        """【不要会话历史】。

        runner 默认会把"和发信人之前聊过的话"附进上下文——那是给对话式角色用的
        （如意接客户、灵犀答站长）。而这里的"发信人"是调度中心：
        unread() 把工单伪装成来自它的消息，真去拉历史只会把不相干的调度往来
        塞进开发上下文，既费 token 又干扰判断。

        写成覆盖方法而不是改 config，是因为 config.json 归 root 所有、
        本身也不该为了一个只对本角色成立的事实去动公共配置。
        """
        return ""

    def unread(self):
        """取待开发工单。

        【必须已付款才开工】——这是闸门，不是建议。
        金额判定用 CAST(x AS REAL)：SQLite 的 TEXT 列直接比较是字典序，
        "9" > "10"。旧系统在闸门与巡检口径不一致上真栽过。
        """
        conn = sqlite3.connect(self.cfg["db"], timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT t.Id, t.TicketNo, t.Title, t.Description, t.Status "
                "FROM Tickets t "
                "WHERE t.Status='in_progress' "
                "  AND EXISTS (SELECT 1 FROM FinanceRecords f "
                "              WHERE f.TicketId=t.Id AND f.Type='income' "
                "                AND f.PaymentStatus='received' "
                "                AND CAST(f.Amount AS REAL) > 0) "
                "ORDER BY t.Id LIMIT ?", (self.cfg.get("batch", 3),)).fetchall()
            # 复用 runner 的分组：把工单伪装成「来自调度中心的消息」
            return [{"Id": r["Id"], "SenderId": self.cfg["driven_by"],
                     "SenderUsername": "dispatcher",
                     "Content": f"工单 {r['TicketNo']}：{r['Title']}\n\n"
                                f"需求：{r['Description']}",
                     "CreatedAt": ""} for r in rows]
        finally:
            conn.close()


def dev_context(cfg):
    return ("【交付纪律】编译不过就说编译不过，不要交「看起来对」的半成品。"
            "同一个错误连续修 3 次仍不过，停下来报人工——继续试只是在烧钱。")


if __name__ == "__main__":
    try:
        DevBot(NAME, HERE, context=dev_context).run()
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        print(f"[{NAME}] 致命错误: {e}", file=sys.stderr)
        sys.exit(1)
