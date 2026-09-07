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

    # git 状态：四态严格区分。塌缩成布尔值时，规则只能一律报「git 不可用」，
    # 而这四种情况的处理方式完全不同——尤其 ③ 是危险的那种：
    # 检查【本该跑却没跑成】，而不是「这里本来就没东西可查」。
    _git_state = None          # None=未探测 | ok | no_repo | no_git | failed
    _git_err = ""

    GIT_OK, GIT_NO_REPO, GIT_NO_BIN, GIT_FAILED = "ok", "no_repo", "no_git", "failed"

    def git(self, *args):
        try:
            r = subprocess.run(["git", "-C", self.root, *args],
                               capture_output=True, text=True, timeout=30)
            if r.returncode == 0:
                return r.stdout
            Ctx._git_err = (r.stderr or "").strip()[:200]
            return ""
        except FileNotFoundError as e:
            Ctx._git_err = f"git 命令不存在: {e}"
            Ctx._git_state = Ctx.GIT_NO_BIN
            return ""
        except Exception as e:
            Ctx._git_err = f"{type(e).__name__}: {e}"
            Ctx._git_state = Ctx.GIT_FAILED
            return ""

    def git_state(self):
        """返回四态之一。规则据此决定报 SKIP 还是 ERROR——
        「这里没东西查」和「查不成」必须分开。"""
        if Ctx._git_state is not None and Ctx._git_state != Ctx.GIT_OK:
            return Ctx._git_state
        if Ctx._git_state == Ctx.GIT_OK:
            return Ctx._git_state

        out = self.git("rev-parse", "--git-dir")
        if out.strip():
            Ctx._git_state = Ctx.GIT_OK
        elif Ctx._git_state in (Ctx.GIT_NO_BIN, Ctx.GIT_FAILED):
            pass                       # git() 已经判定了
        elif "not a git repository" in Ctx._git_err.lower():
            Ctx._git_state = Ctx.GIT_NO_REPO
        else:
            # 【危险的那一类】：dubious ownership、权限不足、超时……
            # 检查本该跑却没跑成，绝不能当成「没问题」
            Ctx._git_state = Ctx.GIT_FAILED
        return Ctx._git_state

    def git_available(self):
        return self.git_state() == Ctx.GIT_OK

    def git_error(self):
        return Ctx._git_err

    def git_verdict(self):
        """给规则用的统一裁决：(要不要继续, level, 说明)。

        no_repo → SKIP：这里本来就没有版本库，没东西可查，是合理状态。
        no_git / failed → ERROR：检查【本该跑却没跑成】。
        把后两者也当 SKIP，就是「检查失败却放行」——本项目最痛恨的形态。
        """
        st = self.git_state()
        if st == Ctx.GIT_OK:
            return True, None, ""
        if st == Ctx.GIT_NO_REPO:
            return False, "SKIP", "不是 git 仓库，本规则无从检查（这里本来就没有版本库）"
        if st == Ctx.GIT_NO_BIN:
            return False, "ERROR", f"git 命令不存在，检查【没跑成】：{self.git_error()}"
        return False, "ERROR", (f"git 执行失败，检查【本该跑却没跑成】：{self.git_error()}。"
                                f"若是 dubious ownership，跑 "
                                f"git config --global --add safe.directory {self.root}")

    def tracked(self):
        """git 跟踪的文件列表。

        ⚠️ 必须 `-c core.quotepath=false`。默认情况下 git 会把非 ASCII 文件名
        转义成 `"docs/\\345\\267\\245..."`——**转义后的字符串本身是纯 ASCII**，
        于是「检查文件名是不是 ASCII」这条规则会被它要防的现象打败，
        中文文件名全部漏检。2026-09-07 实测踩到，两次：
        第一次是拿它和 find 输出做 comm 比对，差点判定「整个 docs 目录丢了」。
        """
        return [l for l in self.git("-c", "core.quotepath=false",
                                    "ls-files").splitlines() if l]

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
        if rule in implemented:
            # 编号是引用锚点：两条规则共用一个 ID 时，报告里会出现两条同号
            # 且看不出是谁，规范总表也无从对应。2026-09-07 真撞过一次
            # （新写的门禁规则误用了已被占用的 G11）。
            results.append(("ERROR", rule,
                            f"编号重复：{rule} 被多个规则文件使用",
                            "编号只增不复用（旧号是引用锚点），改用下一个空号"))
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
