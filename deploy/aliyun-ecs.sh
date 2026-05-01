#!/usr/bin/env bash
# 在 ECS 上于仓库根目录执行：bash deploy/aliyun-ecs.sh
# 可选环境变量：DEPLOY_BRANCH（默认 main）、WEB_ROOT（静态站点目录，默认 ~/www/xinghuo）

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT/xinghuo-backend"
FRONTEND_DIR="$ROOT/xinghuo"
BRANCH="${DEPLOY_BRANCH:-main}"
WEB_ROOT="${WEB_ROOT:-$HOME/www/xinghuo}"

log() { printf '[deploy] %s\n' "$*"; }

if [[ ! -f "$BACKEND_DIR/app.js" ]]; then
  log "未找到 $BACKEND_DIR/app.js，请确认在仓库根目录且包含 xinghuo-backend。"
  exit 1
fi
if [[ ! -f "$FRONTEND_DIR/package.json" ]]; then
  log "未找到 $FRONTEND_DIR/package.json，请确认包含 xinghuo 前端目录。"
  exit 1
fi

cd "$ROOT"

if [[ ! -d .git ]]; then
  log "当前目录不是 git 仓库，请先在 ECS 上 git clone 你的 GitHub 仓库后再执行本脚本。"
  exit 1
fi

log "拉取代码 origin/$BRANCH …"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

log "安装并构建后端 …"
cd "$BACKEND_DIR"
npm ci --omit=dev

log "安装并构建前端（需 devDependencies 以运行 vite build）…"
cd "$FRONTEND_DIR"
npm ci
npm run build

log "同步静态资源到 $WEB_ROOT …"
if [[ -w "$(dirname "$WEB_ROOT")" ]] 2>/dev/null || [[ -w "$WEB_ROOT" ]] 2>/dev/null; then
  mkdir -p "$WEB_ROOT"
  rsync -a --delete "$FRONTEND_DIR/dist/" "$WEB_ROOT/"
else
  sudo mkdir -p "$WEB_ROOT"
  sudo rsync -a --delete "$FRONTEND_DIR/dist/" "$WEB_ROOT/"
fi

log "启动 / 重载 PM2 …"
cd "$ROOT"
if pm2 describe xinghuo-api >/dev/null 2>&1; then
  pm2 reload deploy/ecosystem.config.cjs --only xinghuo-api
else
  pm2 start deploy/ecosystem.config.cjs --only xinghuo-api
fi
pm2 save

log "完成。请确认 Nginx 的 root 指向 $WEB_ROOT，且 /api 反代到 127.0.0.1:3000（或你设置的 PORT）。"
