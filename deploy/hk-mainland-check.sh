#!/usr/bin/env bash
# 香港 → 大陆访问相关自检（可非 root 跑部分项）
# 用法：bash deploy/hk-mainland-check.sh

set -euo pipefail

ok=0
warn=0

pass() { echo "[ok]  $*"; ok=$((ok + 1)); }
fail() { echo "[!!] $*"; warn=$((warn + 1)); }
info() { echo "[..] $*"; }

echo "=== Spark 香港机房 · 回国体验自检 ==="

if sysctl net.ipv4.tcp_congestion_control 2>/dev/null | grep -q bbr; then
  pass "BBR: $(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)"
else
  fail "BBR 未启用 — 执行: sudo bash deploy/hk-mainland-tune.sh"
fi

if [[ -f /etc/sysctl.d/99-spark-hk-tune.conf ]]; then
  pass "已存在 sysctl 调优文件"
else
  fail "缺少 /etc/sysctl.d/99-spark-hk-tune.conf"
fi

if command -v nginx >/dev/null 2>&1; then
  if grep -Rqs 'nginx-hk-tuning.conf' /etc/nginx/ 2>/dev/null \
    || grep -Rqs 'location \^~ /api/' /etc/nginx/ 2>/dev/null; then
    pass "Nginx 已配置 ^~ /api/ 或 include hk-tuning"
  else
    fail "Nginx 未见 location ^~ /api/ — 图片与 API 可能异常"
  fi
  if nginx -t >/dev/null 2>&1 || sudo nginx -t >/dev/null 2>&1; then
    pass "nginx -t 通过"
  else
    fail "nginx -t 失败，请检查配置"
  fi
else
  info "本机无 nginx 命令，跳过 Nginx 检查"
fi

if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe xinghuo-api >/dev/null 2>&1; then
    pass "pm2 进程 xinghuo-api 存在"
  else
    fail "pm2 无 xinghuo-api — 后端可能未启动"
  fi
fi

if curl -fsS --max-time 5 http://127.0.0.1:3000/health >/dev/null 2>&1; then
  pass "本机 /health 可达"
else
  fail "本机 http://127.0.0.1:3000/health 不可达"
fi

echo
echo "DNS / 线路（需在大陆网络人工确认）："
info "dig +short sparksquad.club 应指向香港机 IP（如 101.32.221.4），勿橙云代理"
info "大陆测速：打开站点看 TTFB；晚高峰差属跨境公网常态"
info "若需真正优化回国路由：腾讯云 GAAP / 全球加速，或备案后迁大陆机房（见 README 第六节）"
echo
echo "结果: ${ok} 项通过, ${warn} 项需处理"
[[ "$warn" -eq 0 ]]
