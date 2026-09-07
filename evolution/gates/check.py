#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gooday 规范检查器 —— 单一入口。

设计立场（改之前先读 policies/00-index.md）：
    **一条规范如果不能被自动判定真假，它就不是规范，是愿望。**

结构：一条规范 = 一个 rules/*.py 文件，导出 RULE / TITLE / check(ctx)。
这样 policies/ 的条目和 evolution/gates/rules/ 的文件能一一对上，G05 才检查得动。

【本文件只写现成工具不可能知道的规则】——密钥交给 gitleaks，
静默吞错交给 Semgrep，大文件交给 pre-commit。别在这里造轮子，
理由见 policies/00-index.md「什么该外包」。

用法：
    python3 evolution/gates/check.py [仓库根]
    python3 evolution/gates/check.py . --json
退出码：0 = 无 ERROR；1 = 有 ERROR
"""
import importlib.util
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RULES_DIR = os.path.join(HERE, "rules")


def _find_root(start):
    """向上找 AGENTS.md 认仓库根。

    别用 dirname(dirname(...)) 数层数——本文件从 evolution/gates/ 移到 evolution/gates/ 时
    层数就变了，写死层数的代码会静默算错根目录，然后所有规则都扫了个空。
    """
    d = start
    while True:
        if os.path.exists(os.path.join(d, "AGENTS.md")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return start
        d = parent


ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("-") \
    else _find_root(HERE)
AS_JSON = "--json" in sys.argv


class Ctx:
    """规则拿到的上下文。所有规则共用，避免每条规则各写一套文件遍历。"""

    SKIP_DIRS = {".git", "node_modules", "__pycache__", "venv", ".venv",
                 "obj", "bin", "dist", "build", ".next"}

    def __init__(self, root):
        self.root = root

    def path(self, *parts):
        return os.path.join(self.root, *parts)

    def exists(self, *parts):
        return os.path.exists(self.path(*parts))

    def read(self, path):
        try:
            with open(path if os.path.isabs(path) else self.path(path),
                      encoding="utf-8", errors="ignore") as f:
                return f.read()
        except Exception:
            return ""

    def walk(self, *exts, under=None):
        base = self.path(under) if under else self.root
        if not os.path.isdir(base):
            return
        for dp, dns, fns in os.walk(base):
            dns[:] = [d for d in dns if d not in self.SKIP_DIRS]
            for fn in fns:
                if not exts or fn.endswith(exts):
                    yield os.path.join(dp, fn)

    def rel(self, p):
        try:
            return os.path.relpath(p, self.root)
        except ValueError:
            return p

    # git 是否可用。None=还没试过；True/False=试过的结果；字符串=失败原因
    _git_ok = None
    _git_err = ""

    def git(self, *args):
        try:
            r = subprocess.run(["git", "-C", self.root, *args],
                               capture_output=True, text=True, timeout=30)
            if r.returncode == 0:
                return r.stdout
            Ctx._git_err = (r.stderr or "").strip()[:200]
            return ""
        except Exception as e:
            Ctx._git_err = f"{type(e).__name__}: {e}"
            return ""

    def git_available(self):
        """git 能不能用——【不能把"用不了"和"没有东西"混为一谈】。

        2026-09-07 复核实测：以 root 跑本仓库时 git 报 dubious ownership，
        原来的实现把任何 git 失败都吞成空字符串，于是 G01/G03 打印
        「不是 git 仓库，跳过」然后放行——门禁全绿，实际一条都没查。
        而部署入口正是 `sudo bash install.sh`，这恰恰是最需要检查的时刻。

        这正是 policies G01/G05 自己写下的教训（对某种失败形态静默跳过，
        看起来一切正常）。门禁不能犯它自己记录的错。
        """
        if Ctx._git_ok is None:
            Ctx._git_ok = bool(self.git("rev-parse", "--git-dir").strip())
        return Ctx._git_ok

    def git_error(self):
        return Ctx._git_err

    def tracked(self):
        return [l for l in self.git("ls-files").splitlines() if l]

    def subdirs(self, under):
        base = self.path(under)
        if not os.path.isdir(base):
            return []
        return sorted(d for d in os.listdir(base)
                      if os.path.isdir(os.path.join(base, d))
                      and not d.startswith("."))


def load_rules():
    """递归加载 rules/**/*.py。

    目录分层（rules/H、rules/C、rules/G）对应 policies/ 的三层，
    但加载不关心在哪一层——【新增一条规范 = 丢一个文件进去，不改本文件】。
    这是 G06 扩展点契约对检查器自己的要求。
    """
    out = []
    if not os.path.isdir(RULES_DIR):
        return out
    found = []
    for dp, dns, fns in os.walk(RULES_DIR):
        dns[:] = [d for d in dns if d != "__pycache__"]
        for fn in fns:
            if fn.endswith(".py") and not fn.startswith("_"):
                found.append(os.path.join(dp, fn))
    for p in sorted(found, key=lambda x: os.path.basename(x)):
        fn = os.path.basename(p)
        spec = importlib.util.spec_from_file_location(fn[:-3], p)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
        except Exception as e:
            out.append(("__load__", fn, [("ERROR", f"规则加载失败 {fn}: {e}", "")]))
            continue
        if not hasattr(mod, "check") or not hasattr(mod, "RULE"):
            out.append(("__load__", fn,
                        [("ERROR", f"{fn} 缺 RULE 或 check()", "见本文件顶部的规则接口")]))
            continue
        out.append((mod.RULE, getattr(mod, "TITLE", ""), mod))
    return out


def check_rule_coverage(ctx, implemented):
    """G05 元规范：policies/ 的 [可检查] 条目 与 evolution/gates/rules/ 必须一一对应。

    这条是整套东西的保险丝——它红了说明规范和执行体已经脱钩，
    而脱钩的规范就是三个月没人发现没生效的那种（见 policies G05 的教训）。
    """
    doc = ctx.read("policies/00-index.md")
    if not doc:
        return [("ERROR", "policies/00-index.md 不存在", "规范总表是契约，不能没有")]

    documented = set()
    for line in doc.splitlines():
        if "[可检查]" not in line and "`[可检查]`" not in line:
            continue
        m = re.search(r"\b([HCG]\d{2})\b", line)
        if m:
            documented.add(m.group(1))

    missing = sorted(documented - implemented)
    extra = sorted(implemented - documented)
    out = []
    if missing:
        out.append(("ERROR", f"规范标了 [可检查] 但 evolution/gates/rules/ 没实现：{', '.join(missing)}",
                    "要么实现，要么把该条改成「人工」并在 ops/runbooks/ 给它验收动作"))
    if extra:
        out.append(("ERROR", f"实现了检查器但规范总表没登记：{', '.join(extra)}",
                    "补进 policies/00-index.md"))
    return out


def main():
    ctx = Ctx(ROOT)
    results = []
    implemented = set()

    for rule, title, mod in load_rules():
        if rule == "__load__":
            for lvl, msg, hint in mod:
                results.append((lvl, title, msg, hint))
            continue
        implemented.add(rule)
        try:
            for item in (mod.check(ctx) or []):
                lvl, msg, hint = (list(item) + ["", ""])[:3]
                results.append((lvl, rule, msg, hint))
        except Exception as e:
            results.append(("ERROR", rule, f"检查器自身异常: {e}", ""))

    implemented.add("G05")      # G05 由本文件的 check_rule_coverage 实现，不在 rules/ 下
    for lvl, msg, hint in check_rule_coverage(ctx, implemented):
        results.append((lvl, "G05", msg, hint))

    if AS_JSON:
        print(json.dumps([{"level": l, "rule": r, "msg": m, "hint": h}
                          for l, r, m, h in results], ensure_ascii=False, indent=2))
    else:
        icons = {"ERROR": "❌", "WARN": "⚠️ ", "SKIP": "⏭️ ", "OK": "✅"}
        print(f"\nGooday 规范检查 · {ROOT}")
        print("─" * 64)
        if not results:
            print("✅ 全部通过")
        for lvl, rule, msg, hint in results:
            print(f"{icons.get(lvl, '  ')} [{rule}] {msg}")
            if hint:
                print(f"        ↳ {hint}")
        e = sum(1 for r in results if r[0] == "ERROR")
        w = sum(1 for r in results if r[0] == "WARN")
        print("─" * 64)
        print(f"规则 {len(implemented)} 条 · 错误 {e} · 警告 {w}")
        if e:
            print("\n有 ERROR，CI 应当红。每一条都对应一次真实事故——"
                  "别改检查器，先看 policies/ 里那条规范下面的教训。")

    sys.exit(1 if any(r[0] == "ERROR" for r in results) else 0)


if __name__ == "__main__":
    main()
