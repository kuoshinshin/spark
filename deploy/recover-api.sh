#!/usr/bin/env bash
# 紧急恢复 API（不做前端构建）。在仓库根目录执行：
#   bash deploy/recover-api.sh
# 若仍失败：
#   FORCE_KILL_PORT=1 bash deploy/recover-api.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT/xinghuo-backend"
cd "$ROOT"

PORT_NUM="$(grep -E '^[[:space:]]*PORT=' "$BACKEND_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '[:space:]\"' || true)"
PORT_NUM="${PORT_NUM:-3000}"

echo "[recover] ROOT=$ROOT PORT=$PORT_NUM"

pm2 delete xinghuo-api >/dev/null 2>&1 || true

if [[ "${FORCE_KILL_PORT:-}" == "1" ]]; then
  echo "[recover] FORCE_KILL_PORT=1"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${PORT_NUM}/tcp" 2>/dev/null || true
  fi
  pids="$(ss -lntp "sport = :${PORT_NUM}" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u | tr '\n' ' ' || true)"
  for pid in $pids; do
    echo "[recover] kill $pid"
    kill -9 "$pid" 2>/dev/null || true
  done
  sleep 1
fi

pm2 start deploy/ecosystem.config.cjs --only xinghuo-api
pm2 save
sleep 2

echo "[recover] listeners:"
ss -lntp "sport = :${PORT_NUM}" 2>/dev/null || true

echo "[recover] health:"
curl -fsS --max-time 8 "http://127.0.0.1:${PORT_NUM}/health" || true
echo
code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${PORT_NUM}/api/user/pubg/clan" || true)"
echo "[recover] clan HTTP=$code (expect 401)"
if [[ "$code" != "401" ]]; then
  echo "[recover] FAILED — try: FORCE_KILL_PORT=1 bash deploy/recover-api.sh"
  pm2 logs xinghuo-api --lines 50 --nostream || true
  exit 1
fi
echo "[recover] OK"
