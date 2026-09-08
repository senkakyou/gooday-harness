# -*- coding: utf-8 -*-
"""G04 部署可重建：install.sh 必须对扩展点做通配扫描，不得逐个列出成员。

真实事故（2026-09-07）：claudecred.conf 已在服务器上生效，但安装脚本里
只写死装 memorymax.conf。一旦重装机器或重建服务，bot 会退回读一份早已失效的
凭据——表现是「活着但答不出话」，心跳、systemd 状态、服务列表全绿，没人会发现。

根因不是「忘了改脚本」，是【脚本要求你记得改】。
所以本规则查的是：**安装脚本有没有做到"新增成员时它不需要被改"**。

与 G06 的分工：G06 查成员符不符合模板；G04 查安装脚本认不认得新成员。
"""
import os
import re
import sys

RULE = "G04"
TITLE = "部署可重建"

INSTALL = "ops/install.sh"

# 扩展点 -> 安装脚本里必须出现的通配扫描形态（正则任一命中即算过）
# `["']?` 是必须的：`for dir in "$REPO/services"/*/` 是完全合法的写法，
# 引号恰好闭在目录名和 glob 之间。写死 `services/\*` 会把它判成「没有扫描」——
# **那是靠写法运气过的规则，不是靠语义**（2026-09-08 灵犀实测的假红）。
MUST_GLOB = {
    "services": [r"services[\"']?/\*", r"services/\$\{?\w+\}?/deploy"],
    "workflows": [r"workflows[\"']?/\*", r"workflows/\$\{?\w+\}?/deploy"],
    # conf.d 变体：nginx 的配置在 ops/nginx/conf.d/ 下，ops/nginx/ 根上放的是
    # 主配置 nginx.conf——扫 ops/nginx/*.conf 会抓错文件、漏掉真正的站点配置。
    "ops/nginx": [r"ops/nginx[\"']?/\*", r"ops/nginx/conf\.d[\"']?/\*"],
}


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _srclib import code_only                                        # noqa: E402


def check(ctx):
    if not ctx.exists(INSTALL):
        yield ("ERROR", f"{INSTALL} 不存在",
               "没有可重复执行的安装入口，机器重建时配置必丢")
        return

    # shell：注释 ＋ echo/printf 的提示语都不算「脚本真的在做的事」。
    # 但别的字符串要留着——`for dir in "$REPO/services"/*/` 是合法写法，
    # 无差别剥引号会把它判成「没有扫描 services/」（2026-09-08 灵犀实测的假红）。
    src = code_only(ctx.read(INSTALL), strip_echo=True, strip_heredoc=True)

    for point, pats in MUST_GLOB.items():
        if not ctx.exists(point):
            continue
        if any(re.search(p, src) for p in pats):
            continue

        # 没做通配扫描。是不是把成员逐个写死了？
        members = [d for d in ctx.subdirs(point) if not d.startswith("_")] \
            if os.path.isdir(ctx.path(point)) else []
        hardcoded = [m for m in members if m and m in src]
        if hardcoded:
            yield ("ERROR",
                   f"{point}/ 被逐个写死安装（{len(hardcoded)}/{len(members)} 个成员）",
                   f"改成对 {point}/*/deploy 通配扫描——"
                   "写死就要求人在新增成员时记得回来改，而人不会记得")
        else:
            yield ("ERROR", f"{INSTALL} 没有扫描 {point}/",
                   f"该扩展点下的部署配置不会被安装，机器重建后静默丢失")

    if "set -e" not in src:
        yield ("WARN", f"{INSTALL} 没有 set -e",
               "中途失败会继续跑下去，装出半套配置——比装失败更难发现")

    # 仓库外的四个位置必须由安装脚本【创建】，否则首次部署时服务无处写状态/日志。
    #
    # 【判据要求同一行上有建目录的命令，不是裸子串命中】。
    # 2026-09-08 灵犀第三轮：原来写的是 `if d not in src`，
    # 于是脚本末尾那段 `cat <<'EOF' … EOF` 收尾提示里的
    # `/var/lib/gooday-harness/state` 就能满足它 ——
    # 把真正的 `install -d` 整行删掉，规则照样绿。
    # heredoc 已由 code_only(strip_heredoc=True) 剥掉，这条同行判据是第二道。
    # 先把反斜杠续行接起来 —— install.sh 真实写法就是一条 install -d 跨两行：
    #     install -d -m 755 /var/lib/gooday-harness/{...} \
    #                       /var/log/gooday-harness /srv/gooday-harness/media
    # 不接的话「同一行」这个判据会把后半行判成没人建，那是自己造的假红。
    joined = re.sub(r"\\\n\s*", " ", src)
    for d in ("/var/lib/gooday", "/var/log/gooday", "/srv/gooday"):
        if not re.search(r"(install\s+-d|mkdir\s+-p)[^\n]*" + re.escape(d), joined):
            yield ("WARN", f"{INSTALL} 没有创建 {d}",
                   "G01 规定状态/日志/产物在仓库外，但没人建目录，首次部署会失败。"
                   "判据是同一行上要有 install -d / mkdir -p —— "
                   "光在提示文本里提到这个路径不算数")
