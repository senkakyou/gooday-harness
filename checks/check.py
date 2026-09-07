#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gooday 规范检查器 —— 单一入口。

设计立场（改之前先读 norms/00-index.md）：
    **一条规范如果不能被自动判定真假，它就不是规范，是愿望。**

结构：一条规范 = 一个 rules/*.py 文件，导出 RULE / TITLE / check(ctx)。
这样 norms/ 的条目和 checks/rules/ 的文件能一一对上，G05 才检查得动。

【本文件只写现成工具不可能知道的规则】——密钥交给 gitleaks，
静默吞错交给 Semgrep，大文件交给 pre-commit。别在这里造轮子，
理由见 norms/00-index.md「什么该外包」。

用法：
    python3 checks/check.py [仓库根]
    python3 checks/check.py . --json
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
ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("-") \
    else os.path.dirname(HERE)
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

    def git(self, *args):
        try:
            r = subprocess.run(["git", "-C", self.root, *args],
                               capture_output=True, text=True, timeout=30)
            return r.stdout if r.returncode == 0 else ""
        except Exception:
            return ""

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

    目录分层（rules/H、rules/C、rules/G）对应 norms/ 的三层，
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
    """G05 元规范：norms/ 的 [可检查] 条目 与 checks/rules/ 必须一一对应。

    这条是整套东西的保险丝——它红了说明规范和执行体已经脱钩，
    而脱钩的规范就是三个月没人发现没生效的那种（见 norms G05 的教训）。
    """
    doc = ctx.read("norms/00-index.md")
    if not doc:
        return [("ERROR", "norms/00-index.md 不存在", "规范总表是契约，不能没有")]

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
        out.append(("ERROR", f"规范标了 [可检查] 但 checks/rules/ 没实现：{', '.join(missing)}",
                    "要么实现，要么把该条改成「人工」并在 ops/runbooks/ 给它验收动作"))
    if extra:
        out.append(("ERROR", f"实现了检查器但规范总表没登记：{', '.join(extra)}",
                    "补进 norms/00-index.md"))
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
                  "别改检查器，先看 norms/ 里那条规范下面的教训。")

    sys.exit(1 if any(r[0] == "ERROR" for r in results) else 0)


if __name__ == "__main__":
    main()
