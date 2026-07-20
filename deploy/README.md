# 阿里云 ECS + GitHub 部署（spark 仓库）

本目录提供：**ECS 首次初始化**、**一键更新**、**Nginx 示例**、**GitHub Actions SSH 自动部署**。

仓库：**https://github.com/kuoshinshin/spark**  
建议服务器目录：**`/opt/spark`**（与 Actions 默认 `DEPLOY_PATH` 一致）。

---

## 一、ECS 上继续部署（你当前要做的）

### 1. 安装依赖（Alibaba Cloud Linux / CentOS 示例）

```bash
sudo yum install -y git nginx || sudo apt-get update && sudo apt-get install -y git nginx
# Node.js 20：用发行版文档或 https://github.com/nodesource/distributions 安装
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -   # EL 系示例
sudo yum install -y nodejs
sudo npm i -g pm2
```

### 2. 首次拉代码并构建（二选一）

**方式 A：一键脚本（推荐）**

```bash
curl -fsSL https://raw.githubusercontent.com/kuoshinshin/spark/main/deploy/ecs-first-run.sh -o /tmp/ecs-first-run.sh
bash /tmp/ecs-first-run.sh
```

**方式 B：手动**

```bash
sudo mkdir -p /opt/spark && sudo chown -R "$USER:$USER" /opt/spark
cd /opt/spark
git clone https://github.com/kuoshinshin/spark.git .
cp xinghuo-backend/.env.example xinghuo-backend/.env
nano xinghuo-backend/.env   # 必填：数据库、JWT_SECRET、生产 CORS 等
npm i -g pm2
chmod +x deploy/aliyun-ecs.sh
bash deploy/aliyun-ecs.sh
```

### 3. 配置生产 `.env`

参考 `xinghuo-backend/.env.example`，至少保证生产有 **`JWT_SECRET`**、数据库连接、**`CORS_ORIGIN`**（你的前端 `https://域名`）。

### 4. Nginx

```bash
sudo cp /opt/spark/deploy/nginx-xinghuo.conf.example /etc/nginx/conf.d/spark.conf
sudo nano /etc/nginx/conf.d/spark.conf   # 修改 server_name、root（与 WEB_ROOT 一致，默认用户下 ~/www/xinghuo）
sudo nginx -t && sudo systemctl enable nginx && sudo systemctl reload nginx
```

### 5. 安全组与防火墙

- 阿里云安全组放行 **80 / 443**（及 SSH 22）。  
- 本机 `firewalld`/`ufw` 若开启，同样放行 HTTP/HTTPS。

### 6. 以后每次更新代码

在 **`/opt/spark`** 下：

```bash
cd /opt/spark && bash deploy/aliyun-ecs.sh
```

或由下面 GitHub Actions 在 **push `main`** 时自动执行。

---

## 二、GitHub Actions 自动部署

在仓库 **Settings → Secrets and variables → Actions** 添加：

| Secret | 必填 | 说明 |
|--------|------|------|
| `DEPLOY_HOST` | 是 | ECS 公网 IP 或域名 |
| `DEPLOY_USER` | 是 | SSH 用户名 |
| `DEPLOY_SSH_KEY` | 是 | 私钥全文（用于 GitHub 连 ECS，**不是** GitHub 账号密码） |
| `DEPLOY_PATH` | 否 | 默认 **`/opt/spark`** |

**注意**：ECS 上需把该私钥对应的**公钥**写入 `~/.ssh/authorized_keys`（部署用户），否则 Actions 无法 SSH。

配置完成后：**再 push 一次 `main`**，或到 **Actions** 里手动 **Run workflow**。

---

## 三、脚本环境变量（`aliyun-ecs.sh`）

| 变量 | 含义 | 默认 |
|------|------|------|
| `DEPLOY_BRANCH` | 拉取分支 | `main` |
| `WEB_ROOT` | 前端 `dist` 同步目录 | `$HOME/www/xinghuo` |

---

## 四、生产前端 API

未设置 `VITE_API_BASE_URL` 时，构建产物使用**同源 `/api`**，与示例 Nginx 一致。

## 五、PM2

进程名：`xinghuo-api`。常用：`pm2 logs xinghuo-api`、`pm2 status`。

---

## 六、香港机房 · 大陆访问优化

腾讯云香港轻量对大陆**没有回国专线保证**。软件调优只能减轻弱网影响；要明显改善晚高峰路由，需要 **云加速产品** 或 **备案后迁大陆机房**。

### 1. DNS（阿里云解析）

- `@`、`www` 使用 **A 记录** 直连服务器 IP（`101.32.221.4`），**不要** 走 Cloudflare 橙云代理（跨境更不稳定）。
- TTL 设为 **10 分钟**，便于换 IP 或接入加速。
- 未备案域名通常无法完整使用境内 CDN；勿指望「随便套个国内 CDN」解决跨境。

### 2. 服务器网络调优（BBR + 弱网参数）

```bash
cd /opt/spark
sudo bash deploy/hk-mainland-tune.sh
bash deploy/hk-mainland-check.sh
```

### 3. Nginx 压缩与静态缓存

在 `/etc/nginx/conf.d/spark.conf` 的 **443 server** 块内加入：

```nginx
include /opt/spark/deploy/nginx-hk-tuning.conf;
```

若已有 `location /api/`、`location /uploads/`、`location /`，请**删除重复块**，只保留 tuning 文件里的一份。

`upstream xinghuo_backend` 建议保留 `keepalive 32`（见 `nginx-xinghuo.conf.example`）。

**头像 / 圈子图片 404：**

1. **`location ^~ /api/` 必须存在**（注意 `^~`）。
2. **`location ^~ /uploads/`** 同样带 `^~`。
3. 前端图片走 **`/api/media?path=...`**。
4. 后端对 `/api/media` 已排除全局限流。

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 4. 真正「优化回国路线」（可选，需花钱）

仅靠本仓库脚本**不能**把公网跨境变成专线。可选：

| 方案 | 效果 | 说明 |
|------|------|------|
| **腾讯云 GAAP / 全球应用加速** | 较好 | 大陆入口 IP → 加速到香港源站；控制台创建通道后把域名 A 记录改到加速 IP |
| **阿里云 GA 等竞品** | 较好 | 若 DNS/账号在阿里云，按产品文档接入香港源站 |
| **ICP 备案 + 大陆机房** | 最好（长期） | 用户主要在大陆时的正解；香港机可作备用 |

接入加速后：

1. 安全组放行加速回源 IP / 端口（按产品文档）。  
2. 源站 Nginx 仍用本仓库 tuning；证书可继续挂源站或挂加速侧。  
3. 用大陆电信/联通/移动各测一次首页 TTFB 与圈子图片。

### 5. 前端

- 构建产物已拆分 `element-plus` / `vue` 等 chunk。  
- `sw.js` 缓存 `/assets/`，二次打开更快。

更新代码后：`bash deploy/aliyun-ecs.sh`。

### 6. 用户侧预期

- 联通/移动往往比电信晚高峰更稳；20:00–23:00 跨境公网抖动属常见。  
- 调优后仍卡顿 → 优先评估 GAAP/加速，而不是继续拧 sysctl。

---

## 七、发版前优化自检

本地可先跑：`node scripts/ci-check.mjs`（前端 build + 后端语法检查）。

1. `xinghuo`：`npm run build` 通过  
2. 后端：`pm2 status` 中 `xinghuo-api` 为 online，`curl` 本机 `/health` 正常  
3. `.env` 含有效 `PUBG_API_KEY`；同步战绩后个人页战力/段位有数据  
4. 圈子评论连点只产生一条；无短时重复入库  
5. 头像/圈子图经 `/api/media` 可显示；Nginx 含 `location ^~ /api/`  
6. 战力榜点击他人行进入对方主页（非自己）  
7. 历史赛季切换战力不覆盖当前赛季排行榜缓存  
8. 部署后浏览器强刷一次，确认前端已是新 hash 资源  

Agent 巡检：对话中说「优化巡检」即可按 `.cursor/skills/optimize-pass` 跑一轮。
