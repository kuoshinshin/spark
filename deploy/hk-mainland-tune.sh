#!/usr/bin/env bash
# 腾讯云香港等跨境机房：BBR + 高 RTT 弱网参数（需 root）
# 用法：sudo bash deploy/hk-mainland-tune.sh

set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "请使用 root 或 sudo 执行本脚本"
  exit 1
fi

SYSCTL_DROPIN="/etc/sysctl.d/99-spark-hk-tune.conf"

cat > "$SYSCTL_DROPIN" <<'EOF'
# Spark Squad — 香港机房 → 大陆高延迟弱网
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# 大窗口：跨境 RTT 高时提高吞吐
net.core.rmem_max = 33554432
net.core.wmem_max = 33554432
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576
net.ipv4.tcp_rmem = 4096 131072 33554432
net.ipv4.tcp_wmem = 4096 131072 33554432
net.core.netdev_max_backlog = 16384
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.tcp_fastopen = 3

# 慢启动与空闲后窗口回收：弱网下少「每次重开慢慢爬」
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_mtu_probing = 1

# 保活：移动网络 NAT 常见空闲断连
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 5

# 适度加快回收，避免大量 TIME_WAIT 占满
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
EOF

sysctl --system >/dev/null

if sysctl net.ipv4.tcp_congestion_control 2>/dev/null | grep -q bbr; then
  echo "[ok] BBR 已启用: $(sysctl -n net.ipv4.tcp_congestion_control)"
else
  echo "[warn] BBR 未生效，内核可能不支持"
fi

echo "[ok] 已写入 $SYSCTL_DROPIN"
echo "下一步："
echo "  1) Nginx 443 server 内 include deploy/nginx-hk-tuning.conf"
echo "  2) 按 deploy/README.md「六、香港机房」确认 DNS 直连、可选回国加速"
echo "  3) sudo bash deploy/hk-mainland-check.sh 做自检"
