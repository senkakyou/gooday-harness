# -*- coding: utf-8 -*-
"""G15 上传新文件类型必须给扩展名注册 MIME。

app.UseStaticFiles() 默认只服务【内置 MIME 列表里的已知扩展名】，
未知扩展名一律 404。mp3/mp4/jpg 能服务是因为本就在内置列表里。

栽过：加 EPUB 文字版时文件传上去了、epub.js 一拉就 404，整页白屏。
只测外链或已知类型测不出这坑——必须真传一个该类型文件、浏览器实拉一次。

根治用 FileExtensionContentTypeProvider 只加需要的扩展名，
【别用 ServeUnknownFileTypes=true 全放开】，那会引入任意类型风险。
"""
import re

RULE = "G15"
TITLE = "静态文件 MIME 注册"

# .NET 内置已覆盖的常见类型，不需要手动注册
BUILTIN = {"html", "htm", "css", "js", "json", "png", "jpg", "jpeg", "gif",
           "svg", "ico", "txt", "pdf", "mp3", "mp4", "webm", "woff", "woff2",
           "zip", "xml", "wav", "ogg", "webp", "ttf", "otf", "csv", "md"}

# 代码里出现的「上传/服务某扩展名」意图
EXT_HINT = re.compile(r"['\"]\.([a-z0-9]{2,5})['\"]")
MAPPING = re.compile(r"Mappings\s*\[\s*['\"]\.([a-z0-9]{2,5})['\"]\s*\]")


def check(ctx):
    program = None
    for f in ctx.walk(".cs", under="services/api"):
        if f.endswith("Program.cs"):
            program = f
            break
    if not program:
        yield ("SKIP", "未找到 services/api/Program.cs", "")
        return

    src = ctx.read(program)
    registered = set(MAPPING.findall(src)) | BUILTIN

    if "ServeUnknownFileTypes" in src and "true" in src:
        yield ("ERROR", "Program.cs 用了 ServeUnknownFileTypes=true",
               "全放开会引入任意类型风险。改用 FileExtensionContentTypeProvider 逐个注册")

    # 扫代码里出现、但既不内置也没注册的扩展名
    seen = {}
    for f in ctx.walk(".cs", ".py", ".jsx", ".tsx", under=None):
        rel = ctx.rel(f)
        if rel.startswith(("checks/", "policies/", "docs/")):
            continue
        body = ctx.read(f)
        if "upload" not in body.lower() and "wwwroot" not in body:
            continue
        for ext in EXT_HINT.findall(body):
            if ext not in registered:
                seen.setdefault(ext, rel)

    for ext, where in sorted(seen.items()):
        yield ("WARN", f"扩展名 .{ext} 疑似被上传/服务但未注册 MIME（见 {where}）",
               "在 Program.cs 加 ctp.Mappings[\".%s\"]=...；"
               "并真传一个该类型文件、浏览器实拉一次验证" % ext)
