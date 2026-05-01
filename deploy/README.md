# 阿里云 ECS + GitHub 部署说明

本目录提供 **ECS 上一键更新** 脚本，以及 **GitHub Actions 经 SSH 自动部署** 工作流。

## 前置条件

- ECS 已安装：**Git、Node.js 20+（建议 LTS）、npm、PM2**（`npm i -g pm2`）、**Nginx**（托管静态页并反代 `/api`）。
- 已在 `xinghuo-backend` 目录创建 **`.env`**（生产密钥、数据库、JWT 等），可参考仓库内 `xinghuo-backend/.env.example`。
- 仓库在服务器上的路径与 GitHub Actions 里配置的 **`DEPLOY_PATH`** 一致（默认 `/opt/newPUBG`）。

## 首次在 ECS 上克隆

```bash
sudo mkdir -p /opt/newPUBG
sudo chown -R "$USER:$USER" /opt/newPUBG
cd /opt/newPUBG
git clone https://github.com/<你的组织或用户名>/<仓库名>.git .
# 或使用 SSH clone；保证根目录下即有 xinghuo/ 与 xinghuo-backend/
```

配置后端环境变量：

```bash
cp xinghuo-backend/.env.example xinghuo-backend/.env
nano xinghuo-backend/.env   # 填写生产库、JWT_SECRET、CORS_ORIGIN 等
```

配置 Nginx（示例见 `nginx-xinghuo.conf.example`），`root` 与下面 **`WEB_ROOT`** 一致。

## 一键更新（在 ECS 上执行）

在仓库根目录：

```bash
chmod +x deploy/aliyun-ecs.sh   # 仅需一次
bash deploy/aliyun-ecs.sh
```

可选环境变量：

| 变量 | 含义 | 默认 |
|------|------|------|
| `DEPLOY_BRANCH` | 拉取的分支 | `main` |
| `WEB_ROOT` | 前端 `dist` 同步目标目录 | `$HOME/www/xinghuo` |

若 `WEB_ROOT` 在系统目录（如 `/var/www/xinghuo`），脚本会尝试 `sudo rsync`，请为部署用户配置相应权限或改用家目录并在 Nginx 里指向该路径。

## GitHub Actions 自动部署

1. 将本仓库推送到 GitHub，**默认分支名为 `main`**（若不同请改 `.github/workflows/deploy-ecs.yml` 里的 `branches`）。
2. 在 GitHub：**Settings → Secrets and variables → Actions → New repository secret** 添加：

| Secret | 必填 | 说明 |
|--------|------|------|
| `DEPLOY_HOST` | 是 | ECS 公网 IP 或域名 |
| `DEPLOY_USER` | 是 | SSH 登录用户名 |
| `DEPLOY_SSH_KEY` | 是 | 该用户私钥全文（`-----BEGIN ... PRIVATE KEY-----` 至结尾） |
| `DEPLOY_PATH` | 否 | 服务器上仓库根目录绝对路径，未设置时脚本内默认 `/opt/newPUBG` |

3. 对 `main` 的 **push** 会触发部署；也可在 **Actions** 里手动 **Run workflow**。

**安全建议**：为 GitHub 单独生成一对仅用于拉代码/执行部署的 SSH 密钥，在 ECS 的 `~/.ssh/authorized_keys` 中只授权公钥；不要使用个人主密钥。

## 生产前端 API 地址

未设置 `VITE_API_BASE_URL` 时，生产构建会使用 **同源 `/api`**，与示例 Nginx 一致。若前后端分域，请在构建前导出：

```bash
export VITE_API_BASE_URL=https://api.example.com/api
```

并在 `aliyun-ecs.sh` 中于 `npm run build` 前加入该变量（可自行改脚本）。

## PM2

进程名：`xinghuo-api`。常用命令：`pm2 logs xinghuo-api`、`pm2 status`。
