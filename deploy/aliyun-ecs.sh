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

# 从 .env 读 PORT（不依赖 cwd 下的 dotenv）
PORT_NUM="$(grep -E '^[[:space:]]*PORT=' "$BACKEND_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '[:space:]\"' || true)"
PORT_NUM="${PORT_NUM:-3000}"
log "目标 PORT=${PORT_NUM} cwd=$BACKEND_DIR"

list_port_holders() {
  if command -v ss >/dev/null 2>&1; then
    ss -lntp "sport = :${PORT_NUM}" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${PORT_NUM}" -sTCP:LISTEN 2>/dev/null || true
  fi
}

kill_port_holders() {
  local pids=""
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${PORT_NUM}/tcp" 2>/dev/null || sudo fuser -k "${PORT_NUM}/tcp" 2>/dev/null || true
  fi
  if command -v ss >/dev/null 2>&1; then
    pids="$(ss -lntp "sport = :${PORT_NUM}" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u | tr '\n' ' ')"
  elif command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -t -iTCP:"${PORT_NUM}" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ')"
  fi
  for pid in $pids; do
    [[ -n "$pid" ]] || continue
    log "终止占用 ${PORT_NUM} 的进程 pid=${pid}"
    kill "$pid" 2>/dev/null || sudo kill "$pid" 2>/dev/null || true
    sleep 1
    kill -9 "$pid" 2>/dev/null || sudo kill -9 "$pid" 2>/dev/null || true
  done
}

log "释放端口前监听者："
list_port_holders

# 两边 PM2 都删掉，避免 root/ubuntu 双实例
pm2 delete xinghuo-api >/dev/null 2>&1 || true
sudo pm2 delete xinghuo-api >/dev/null 2>&1 || true
kill_port_holders
sleep 1

log "释放端口后监听者："
list_port_holders

# 强制按本仓库 ecosystem 重建进程
pm2 start deploy/ecosystem.config.cjs --only xinghuo-api
pm2 save
pm2 describe xinghuo-api | sed -n '1,40p' || true

# 确认新路由已挂载（未带 token 必须是 401；000/404 一律失败）
log "冒烟检查后端新接口 …"
sleep 2
health_body="$(curl -fsS --max-time 8 "http://127.0.0.1:${PORT_NUM}/health" 2>/dev/null || true)"
log "health body: ${health_body:-<empty>}"
if ! printf '%s' "$health_body" | grep -q '"pubgClan":true'; then
  log "错误：health 缺少 routes.pubgClan（仍是旧进程，或未监听 ${PORT_NUM}）"
  list_port_holders
  pm2 logs xinghuo-api --lines 40 --nostream || true
  exit 1
fi

code_public="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${PORT_NUM}/api/user/public/1" || true)"
code_clan="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${PORT_NUM}/api/user/pubg/clan" || true)"
code_mastery="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${PORT_NUM}/api/user/pubg/mastery" || true)"
log "路由探测 HTTP: public=${code_public} clan=${code_clan} mastery=${code_mastery}（必须全部为 401）"
if [[ "$code_public" != "401" || "$code_clan" != "401" || "$code_mastery" != "401" ]]; then
  log "错误：新接口未就绪。请检查是否 root/ubuntu 双 PM2，或 Nginx upstream 端口不是 ${PORT_NUM}。"
  list_port_holders
  pm2 logs xinghuo-api --lines 40 --nostream || true
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
