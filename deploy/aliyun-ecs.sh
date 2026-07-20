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

reload_nginx_if_present() {
  if ! command -v nginx >/dev/null 2>&1; then
    log "未检测到 nginx，跳过 reload。"
    return 0
  fi

  log "检测 Nginx 配置 …"
  local config_ok=0
  if nginx -t >/dev/null 2>&1; then
    config_ok=1
  elif sudo nginx -t >/dev/null 2>&1; then
    config_ok=1
  fi

  if [[ "$config_ok" -ne 1 ]]; then
    log "警告：nginx -t 失败，已跳过 reload。请 SSH 检查 /etc/nginx 配置。"
    return 0
  fi

  log "重载 Nginx …"
  if nginx -s reload >/dev/null 2>&1 \
    || systemctl reload nginx >/dev/null 2>&1 \
    || sudo systemctl reload nginx >/dev/null 2>&1 \
    || sudo nginx -s reload >/dev/null 2>&1; then
    log "Nginx reload 完成。"
  else
    log "警告：Nginx reload 失败，请手动执行 sudo systemctl reload nginx"
  fi
}

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

# 核对磁盘上的路由文件是否已包含新接口（避免拉错目录 / 未更新）
if ! grep -q "public/:id" "$BACKEND_DIR/routes/user.js" \
  || ! grep -q "pubg/clan" "$BACKEND_DIR/routes/user.js" \
  || ! grep -q "pubg/mastery" "$BACKEND_DIR/routes/user.js"; then
  log "错误：$BACKEND_DIR/routes/user.js 缺少 public/clan/mastery 路由，请确认 DEPLOY_PATH 与 git 版本。"
  exit 1
fi
log "路由文件校验通过: $BACKEND_DIR/routes/user.js"

# 查出占用 PORT 的进程，避免 root/ubuntu 两套 PM2 抢端口导致「重启了仍是旧进程」
PORT_NUM="$(node -e "require('dotenv').config({path:'$BACKEND_DIR/.env'}); process.stdout.write(String(process.env.PORT||3000))" 2>/dev/null || echo 3000)"
if command -v ss >/dev/null 2>&1; then
  log "当前监听 ${PORT_NUM} 的进程："
  ss -lntp "sport = :${PORT_NUM}" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  lsof -iTCP:"${PORT_NUM}" -sTCP:LISTEN 2>/dev/null || true
fi

# 强制按本仓库 ecosystem 重建进程（reload 不会纠正错误的 cwd/script）
pm2 delete xinghuo-api >/dev/null 2>&1 || true
pm2 start deploy/ecosystem.config.cjs --only xinghuo-api
pm2 save

# 确认新路由已挂载（避免前端已更新、后端仍是旧进程）
log "冒烟检查后端新接口 …"
sleep 2
if curl -fsS --max-time 8 "http://127.0.0.1:${PORT_NUM}/health" >/dev/null 2>&1; then
  log "health ok (port ${PORT_NUM})"
else
  log "警告：health 检查失败，请手动 pm2 logs xinghuo-api"
fi
# 未带 token 时期望 401，而非 404「接口不存在」
code_public="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${PORT_NUM}/api/user/public/1" || true)"
code_clan="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${PORT_NUM}/api/user/pubg/clan" || true)"
code_mastery="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${PORT_NUM}/api/user/pubg/mastery" || true)"
log "路由探测 HTTP: public=${code_public} clan=${code_clan} mastery=${code_mastery}（期望 401，若为 404 说明后端未加载新路由）"
if [[ "$code_public" == "404" || "$code_clan" == "404" || "$code_mastery" == "404" ]]; then
  log "错误：新接口仍 404。常见原因：root 与 ubuntu 各跑一套 PM2，3000 端口被旧进程占用。"
  log "请执行: sudo ss -lntp 'sport = :${PORT_NUM}' ; sudo pm2 list ; pm2 list"
  log "然后杀掉占用端口的旧 node，再在正确用户下: cd $ROOT && pm2 start deploy/ecosystem.config.cjs --only xinghuo-api"
  exit 1
fi

reload_nginx_if_present

if command -v nginx >/dev/null 2>&1; then
  if grep -rq 'location \^~ /api/' /etc/nginx/ 2>/dev/null; then
    log "Nginx 已配置 location ^~ /api/（图片/API 反代正常）。"
  else
    log "警告：未检测到 location ^~ /api/。请合并 deploy/nginx-hk-tuning.conf 后执行 sudo nginx -t && sudo systemctl reload nginx，否则头像/圈子图片会 404。"
  fi
fi

log "完成。请确认 Nginx 的 root 指向 $WEB_ROOT，且 location ^~ /api/ 反代到 127.0.0.1:3000（或你设置的 PORT）。"
