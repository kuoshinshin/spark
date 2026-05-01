#!/usr/bin/env bash
# 在全新 ECS 上执行一次：创建目录、克隆 spark 仓库、复制 .env 模板、安装 PM2、跑首次构建与 PM2 启动。
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/kuoshinshin/spark/main/deploy/ecs-first-run.sh | bash
# 或已手动 clone 后：bash deploy/ecs-first-run.sh
#
# 可选环境变量：INSTALL_DIR（默认 /opt/spark）、REPO_URL（默认本仓库 HTTPS）

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/spark}"
REPO_URL="${REPO_URL:-https://github.com/kuoshinshin/spark.git}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[ecs-first-run] 缺少命令: $1，请先安装后重试。"
    exit 1
  }
}

need_cmd git
need_cmd node
need_cmd npm

if ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)" 2>/dev/null; then
  echo "[ecs-first-run] 需要 Node.js 18+（建议 20 LTS），当前: $(node -v)"
  exit 1
fi

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  echo "[ecs-first-run] 克隆到 $INSTALL_DIR …"
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown -R "$USER:$USER" "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

if [[ ! -f xinghuo-backend/.env ]]; then
  cp xinghuo-backend/.env.example xinghuo-backend/.env
  echo "[ecs-first-run] 已从 .env.example 创建 xinghuo-backend/.env ，请务必编辑填写生产配置后再对外服务："
  echo "    nano $INSTALL_DIR/xinghuo-backend/.env"
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[ecs-first-run] 安装 PM2 …"
  sudo npm i -g pm2
fi

chmod +x deploy/aliyun-ecs.sh
echo "[ecs-first-run] 执行 deploy/aliyun-ecs.sh …"
bash deploy/aliyun-ecs.sh

echo "[ecs-first-run] 完成。接下来："
echo "  1) 编辑 Nginx，参考 deploy/nginx-xinghuo.conf.example ，root 指向 WEB_ROOT（默认 ~/www/xinghuo）"
echo "  2) sudo nginx -t && sudo systemctl reload nginx"
echo "  3) 配置 GitHub Actions Secrets（见 deploy/README.md）以便 push 自动部署"
