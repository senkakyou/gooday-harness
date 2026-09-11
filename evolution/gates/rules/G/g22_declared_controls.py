# -*- coding: utf-8 -*-
"""G22 声明了的控制必须有活的代码路径。

═══ 换来这条的三次事故，形状完全一样 ═══════════════════════════════════

  1. **如意的 `client_context` 是个空函数**（2026-09-09）。
     函数名和 docstring 都写着「查客户已有的记录」，prompt.md 更承诺
     「系统会在每次对话里附上该客户的需求订单、客户档案、工单进度」——
     而函数体里一句查询都没有。结果是接待时反复问客户已经说过的事。

  2. **出口白名单只放行了收，没放行发**（2026-09-07）。
     config 注释写着「运行时按发送者动态放行」，代码只实现了一半，
     于是如意每条回复都被自己的白名单拦下，站长发两句 hello 一条没收到。

  3. **`allowed_tools` / `extra_dirs` 从来没生效**（2026-09-11）。
     `_model_args()` 定义在 bot-lingxi/main.py 里拼 `--allowedTools`/`--add-dir`，
     而 runner 调 `mdl.call()` 时从不传 `extra_args` —— **那个方法没有任何调用方**。
     后果是如意的「一个工具都不给」根本不存在：她有 Read+Bash、cwd 是仓库根、
     而 .env 就在仓库根。详见 docs/specs/002-known-gaps.md 缺口二十。

  共同点不是粗心，是**声明与实现之间没有任何东西在对账**。
  注释、docstring、config 注释都是人写给人看的，没人检查它们是否成立。
  而「谎称有一道闸」比「没有这道闸」更危险——它让人停止找别的防线。

本规则查两件机械可判的事：

  A. config.json 里声明的键，代码里必须真有人读。
  B. services/ 与 packages/ 里定义的函数，全仓必须真有人引用（死方法 = 死控制）。

**查不了的要说出来**：本规则管不了「函数被调用了但函数体是空的」（事故 1 的形状）。
那需要语义判断。能做的是 A+B 把「根本没接上」这一类挡住。
"""
import ast
import json
import os
import re

RULE = "G22"
TITLE = "声明了的控制必须有活的代码路径"

# 这些名字由框架/插件机制动态调用，不在代码里出现显式引用是正常的
DYNAMIC_ENTRYPOINTS = {
    "main", "run", "check", "build",          # workflows / rules / loops 的入口
    "setUp", "tearDown",
}

# _template 是模板不是成员；__pycache__ 是产物
SKIP_PARTS = ("_template", "__pycache__", "node_modules", ".git")

# config 里这些键是给人看的说明，不是给代码读的
DOC_KEY = re.compile(r"^_")


def _skip(rel):
    return any(p in rel.split(os.sep) for p in SKIP_PARTS)


def _all_code(ctx):
    """全仓的 py + cs 源码，合成一个大字符串用于引用查找。

    【用字符串查而不是只看 AST 引用】：配置键会经由 cfg["x"]、cfg.get("x")、
    甚至 f-string 拼接被读到，只认 AST 的 Subscript 会漏。
    宁可宽松——本规则的目的是抓「完全没接上」，不是抓「用法不优雅」。
    """
    buf = []
    for f in ctx.walk(".py", ".cs", under=None):
        rel = ctx.rel(f)
        if _skip(rel) or rel.startswith(("docs/", "policies/")):
            continue
        buf.append(ctx.read(f))
    return "\n".join(buf)


def _check_config_keys(ctx, code):
    """A. config.json 声明的键必须有人读。"""
    for point in ("services", "workflows"):
        base = ctx.path(point)
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            if name.startswith("_"):
                continue
            cfg_path = os.path.join(base, name, "config.json")
            if not os.path.isfile(cfg_path):
                continue
            try:
                with open(cfg_path, encoding="utf-8") as fh:
                    cfg = json.load(fh)
            except Exception as e:
                yield ("ERROR", f"{point}/{name}/config.json 解析失败：{type(e).__name__}",
                       "配置读不出来，服务启动即失败——先修 JSON")
                continue
            if not isinstance(cfg, dict):
                continue
            for key in cfg:
                if DOC_KEY.match(key):
                    continue
                # 键名在代码里出现过就算有读取方（宽松判定，见 _all_code 注释）
                if f'"{key}"' in code or f"'{key}'" in code:
                    continue
                yield ("ERROR",
                       f"{point}/{name}/config.json 的 `{key}` 没有任何读取方",
                       "要么代码里真的去读它，要么从配置里删掉。"
                       "【声明一个没人读的配置，就是谎称有一个开关】——"
                       "改它的人会以为自己改变了行为")


def _base_names(cls):
    """取一个 ClassDef 的基类名（`x.Y` 取 Y）。"""
    out = []
    for b in cls.bases:
        if isinstance(b, ast.Name):
            out.append(b.id)
        elif isinstance(b, ast.Attribute):
            out.append(b.attr)
    return out


def _defs_and_refs(ctx):
    """收集 services/ 与 packages/ 下的函数定义，以及全仓的名字引用。

    ⚠️ 【继承自仓库外基类的方法一律跳过】。这一条不是为了少报，是因为
    静态判不了：`Handler(BaseHTTPRequestHandler)` 的 do_GET / do_POST /
    log_message 由 stdlib 的框架回调调用，代码里永远不会出现显式引用。
    第一版没这条，它们三个全被报成死方法 —— 误报会让人开始无视门禁，
    那比漏报更贵。

    基类在【本仓库】里的（比如 `LingxiBot(Bot)`）仍然要查：
    那种情况下「谁会调它」是可以静态回答的，而 2026-09-11 那个
    `_model_args` 恰恰是这一类——它看着像覆盖基类方法，基类里却根本没有。
    """
    defs = {}        # name -> 第一次定义的位置
    refs = set()
    in_repo_classes = set()
    files = []

    # 第一遍：收集本仓库定义的类名（判断基类是内是外要用）
    for f in ctx.walk(".py", under=None):
        rel = ctx.rel(f)
        if _skip(rel):
            continue
        src = ctx.read(f)
        try:
            tree = ast.parse(src)
        except SyntaxError:
            continue
        files.append((rel, tree))
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                in_repo_classes.add(node.name)

    for rel, tree in files:
        own = rel.startswith(("services" + os.sep, "packages" + os.sep))

        # 哪些函数是「继承自外部基类的类」的方法 —— 这些跳过
        framework_methods = set()
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            bases = _base_names(node)
            if bases and any(b not in in_repo_classes for b in bases):
                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        framework_methods.add(item.name)

        for node in ast.walk(tree):
            if (own and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                    and node.name not in framework_methods):
                defs.setdefault(node.name, f"{rel}:{node.lineno}")
            # 引用：普通名字、属性名、以及字符串字面量（覆盖 getattr/插件派发）
            if isinstance(node, ast.Name):
                refs.add(node.id)
            elif isinstance(node, ast.Attribute):
                refs.add(node.attr)
            elif isinstance(node, ast.Constant) and isinstance(node.value, str):
                refs.add(node.value)
    return defs, refs


def _check_dead_functions(ctx):
    """B. 定义了但全仓无人引用的函数 —— 死方法就是死控制。"""
    defs, refs = _defs_and_refs(ctx)
    for name, where in sorted(defs.items()):
        if name.startswith("__") or name.startswith("test_"):
            continue
        if name in DYNAMIC_ENTRYPOINTS:
            continue
        if name in refs:
            continue
        yield ("ERROR", f"{where} 定义了 `{name}` 但全仓没有任何引用",
               "死方法就是死控制：2026-09-11 的 `_model_args` 就是这样——"
               "它拼的 --allowedTools/--add-dir 从没传给模型，"
               "而 config 注释写着那是一道权限闸。"
               "要么接上调用方，要么删掉它和它对应的那段注释")


def check(ctx):
    code = _all_code(ctx)
    yield from _check_config_keys(ctx, code)
    yield from _check_dead_functions(ctx)
