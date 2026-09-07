# -*- coding: utf-8 -*-
"""配置漂移：各 workflow 的 config.json 缺了 config.example.json 里的配置段。

2026-09-07 真栽过：patrol 的 config.example.json 加了 certs 与 databases 两段，
但部署副本的 config.json 是更早拷的、没有这两段。
config.json 被 gitignore（各机器不同，这是对的），所以 `git pull` 不会更新它。

后果：db_health 那一项【静默什么都不查】——因为它遍历的列表是空的，
遍历空列表不报错、不算失败，于是 patrol_summary 的 failed_checks 是空的，
输出「一切正常」。**巡检项少跑了一整项，而一切看起来正常。**

这是本项目反复出现的同一个病：结构在、但没在起作用，且没有任何东西会说。

判据只看【缺不缺段】，不看值——值本来就该各机器不同。
"""
import json
import os

NAME = "config_drift"


def _load(p):
    try:
        with open(p, encoding="utf-8") as f:
            return {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    except Exception:
        return None


def run(cfg):
    repo = cfg.get("repo", "/opt/gooday-harness")
    wf = os.path.join(repo, "workflows")
    if not os.path.isdir(wf):
        yield {"level": "P2", "what": "配置漂移查不了",
               "why": f"{wf} 不存在", "fix": "确认 repo 路径", "action": None}
        return

    for name in sorted(os.listdir(wf)):
        if name.startswith("_"):
            continue
        d = os.path.join(wf, name)
        ex_p, cur_p = os.path.join(d, "config.example.json"), os.path.join(d, "config.json")
        if not os.path.isfile(ex_p):
            continue

        ex = _load(ex_p)
        if ex is None:
            yield {"level": "P1", "what": f"{name} 的 config.example.json 解析失败",
                   "why": f"{ex_p} 不是合法 JSON", "fix": "修 JSON 语法", "action": None}
            continue

        if not os.path.isfile(cur_p):
            yield {"level": "P0", "what": f"{name} 缺 config.json",
                   "why": f"{cur_p} 不存在——该 workflow 一跑就退出",
                   "fix": f"cp {ex_p} {cur_p} 后按本机改", "action": None}
            continue

        cur = _load(cur_p)
        if cur is None:
            yield {"level": "P0", "what": f"{name} 的 config.json 解析失败",
                   "why": f"{cur_p} 不是合法 JSON——该 workflow 跑不起来",
                   "fix": "修 JSON 语法", "action": None}
            continue

        missing = [k for k in ex if k not in cur]
        if missing:
            yield {"level": "P1",
                   "what": f"{name} 的 config.json 缺 {len(missing)} 个配置段",
                   "why": f"缺：{'、'.join(missing)}。config.json 被 gitignore，"
                          f"git pull 不会更新它——对应的巡检项会【静默什么都不查】，"
                          f"而 failed_checks 是空的、输出「一切正常」",
                   "fix": f"照 {ex_p} 补齐缺的段", "action": None}
