#!/usr/bin/env bash
# 腾讯云香港等跨境机房：启用 BBR、基础网络参数（需 root）
# 用法：sudo bash deploy/hk-mainland-tune.sh

set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "请使用 root 或 sudo 执行本脚本"
  exit 1
fi

SYSCTL_DROPIN="/etc/sysctl.d/99-spark-hk-tune.conf"

cat > "$SYSCTL_DROPIN" <<'EOF'
# Spark Squad — 跨境弱网优化（香港机房）
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# 适度扩大缓冲，减轻高延迟抖动
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_fastopen = 3
EOF

sysctl --system

if sysctl net.ipv4.tcp_congestion_control | grep -q bbr; then
  echo "[ok] BBR 已启用"
else
  echo "[warn] BBR 未生效，内核可能不支持，可忽略"
fi

echo "完成。建议同时按 deploy/README.md「香港机房大陆访问优化」调整 Nginx 与 DNS。"
