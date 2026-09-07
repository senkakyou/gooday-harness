# -*- coding: utf-8 -*-
"""<闭环名>。复制本目录改名即可新增一条闭环，不改任何公共文件（G06）。

必须导出 build() -> Loop。引擎复用 packages/evolve/loop.py，
留痕复用 packages/trace，**都不要另造第二套**。
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

from loop import Loop, Subject                             # noqa: E402


def build():
    raise NotImplementedError("照 gooday-assets/ 实现 Subject 与四个环节")
