# -*- coding: utf-8 -*-
"""gooday-assets —— Gooday 的第一条真实业务闭环。

canary 证明「Harness 自己能转」；**本闭环证明「Harness 能改进真实系统」**。
两者都要在，缺一个都说明不了问题。

被改进的是运行中的 Gooday：真库、真文件、真用户会撞见的 404。
Evidence 来自 Gooday 自己的运行（巡检 assets 检查 + 库 + 磁盘），
不是为了演示闭环而虚构的指标。

复用关系（都不另造第二套）：
  · 引擎  packages/evolve/loop.py
  · 留痕  packages/trace（由引擎调用）
  · 门禁  本闭环的 Gate 之外，改动仍受 evolution/gates 的规范约束
"""
import os
import sys

def _repo_root(start):
    """向上找 AGENTS.md 认仓库根。

    别数 dirname 层数——文件一挪位置层数就变，而写死层数的代码会
    【静默算错根目录】然后 import 失败或扫了个空。check.py 早就是这么做的。
    """
    d = start
    while True:
        if os.path.exists(os.path.join(d, "AGENTS.md")):
            return d
        p = os.path.dirname(d)
        if p == d:
            return start
        d = p


HERE = os.path.dirname(os.path.abspath(__file__))
REPO = _repo_root(HERE)

for p in (os.path.join(REPO, "packages", "evolve"), HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

from loop import Loop                                      # noqa: E402
from subject import GoodayAssets                           # noqa: E402
import assets_phases as phases                             # noqa: E402
# ⚠️ 模块名带 `assets_` 前缀不是啰嗦：**loops 是共享一个 Python 进程的**。
# workflows/evolve/run.py 会把每条闭环依次 import 进同一个解释器，
# 各自的 `sys.path` 都加了自己的目录 —— 于是两条闭环里同名的模块会互相顶掉，
# 先加载的那个赢。2026-09-07 实测：canary 从 hello-harness 导入 `phases` 包，
# 本闭环的 `phases.py` 就再也拿不到，报 `has no attribute 'make_gate'`。
# 新增闭环时，模块名带上闭环名前缀。



def build():
    subject = GoodayAssets()
    baseline_results = subject.run(None)

    return Loop(
        "gooday-assets", subject,
        evaluator=phases.evaluate,
        # 【media 必须从 subject 取，不能让 learn 回落到环境变量】：
        # subject.media 一旦与 env 不同（测试、多实例），relpath 会算出
        # `../..` 垃圾路径，Gate 报「没有实质进展」把真因盖掉 ——
        # 和 OnlineUrl 前缀那个 bug 是同一个故障、同一种掩盖方式。
        learner=lambda ev, res: phases.learn(ev, res, media=subject.media,
                                             all_refs=subject.all_refs()),
        improver=phases.improve,
        gate=phases.make_gate(baseline_results),
        inputs=None,
    )
