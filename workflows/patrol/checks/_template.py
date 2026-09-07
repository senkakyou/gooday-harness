# -*- coding: utf-8 -*-
"""巡检项模板。一个文件一项，run.py 递归发现，新增不用改 run.py（G06）。

接口：
    NAME  : str                 —— 巡检项名字，出现在 Event 里
    run(cfg) -> Iterable[Finding]

Finding 是一个 dict：
    {
      "level":  "P0" | "P1" | "P2" | "P3",   # 见 policies 的四级分级
      "what":   "一句话说清发生了什么",
      "why":    "凭什么这么判（Evidence，必填）",
      "fix":    "建议怎么处置",
      "action": None 或 ["systemctl", "restart", "x"],   # active 模式下才执行
    }

⚠️ 两条铁律：

1. **`why` 必填**——没有证据的判定是拍脑袋。巡检最大的失败不是漏报，
   是报了一堆没人信的东西，然后所有人开始无视它。

2. **区分「查不了」和「没问题」**。目标不存在、命令不可用、权限不足时，
   必须报 P2 说「这项没查成」，绝不能返回空当作通过——
   旧 patrol 就栽在这：凭据文件不存在时静默跳过，
   连续三周报「一切正常」而凭据其实早就失效了。
"""

NAME = "template"


def run(cfg):
    raise NotImplementedError
    yield  # noqa: 让它是个生成器
