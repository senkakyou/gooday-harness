#!/usr/bin/env bash
# 前端构建。web 是【构建期成员】——没有进程，产物打进 api 的静态目录。
#
# 单独成脚本而不是让人记 npm 命令，是因为构建有两个容易忘的前提：
#   1. 产物落到 services/api/src/wwwroot/，改完还要 rebuild api 镜像才上线
#   2. build 会先删 wwwroot/assets/，但【不能删 uploads/avatars/chat-media】
#      ——那些是运行期数据（G01），删了就是丢用户文件
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WWWROOT="$(cd "$HERE/../api/src" && pwd)/wwwroot"

cd "$HERE"
[[ -d node_modules ]] || { echo "→ npm ci"; npm ci; }

echo "→ vite build（产物 → $WWWROOT）"
npm run build

# 【核对运行期数据还在】。vite 的 emptyOutDir=false + build 脚本只删 assets/，
# 本该安全；但这是「删错了就没得救」的操作，验一次比信一次强。
for d in uploads avatars chat-media; do
    if [[ -d "$WWWROOT/$d" ]]; then
        echo "   ✅ $d/ 保留（$(find "$WWWROOT/$d" -type f 2>/dev/null | wc -l) 个文件）"
    fi
done

echo
echo "构建完成。产物只是落盘，【还没上线】——要生效还得："
echo "  cd ops/docker && docker compose build api && docker compose up -d api"
echo "然后 Playwright 实访页面确认没有 JS 报错（build 过 ≠ 页面能用）"
