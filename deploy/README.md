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

腾讯云香港轻量对大陆无「回国专线」保证，无法做到与备案大陆机房同等稳定，但可按下面步骤减轻弱网影响。

### 1. DNS（阿里云解析）

- `@`、`www` 使用 **A 记录** 直连服务器 IP（`101.32.221.4`），**不要** 走 Cloudflare 橙云代理。
- TTL 设为 **10 分钟**，便于以后换 IP。
- 暂不要用 URL 转发、境内 CDN（未备案域名通常无法完整使用）。

### 2. 服务器网络调优（BBR）

```bash
cd /opt/spark
sudo bash deploy/hk-mainland-tune.sh
```

### 3. Nginx 压缩与静态缓存

在 `/etc/nginx/conf.d/spark.conf` 的 **443 server** 块内（`server_name sparksquad.club` 那段）加入：

```nginx
include /opt/spark/deploy/nginx-hk-tuning.conf;
```

若已有 `location /api/`、`location /uploads/`，请**删除重复块**，只保留 tuning 文件里的一份，或把 tuning 文件中的 location 合并进现有配置。

**头像 / 圈子图片 404 或 FAILED 排查**（上传成功但页面不显示）：

1. **`location ^~ /api/` 必须存在**（注意 `^~`）。若只有 `location /api/`，会被同文件里 `~* \.(jpg|png|...)$` 抢走 `/api/uploads/*.png`，nginx 在前端 dist 里找文件而 404。
2. **`location ^~ /uploads/`** 同样必须带 `^~`（兼容旧链接）。
3. 前端图片地址已改为 **`/api/media?path=avatars/xxx.png`**（路径不以 `.png` 结尾，可绕过静态正则）。
4. 后端对 `/api/media` 已排除全局限流（否则约 100 张图后全部 429）。

`deploy/aliyun-ecs.sh` 部署结束时会检测是否配置了 `location ^~ /api/` 并尝试 `nginx -t` + reload。

若需手动重载：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 4. 前端

- 构建产物已拆分 `element-plus` / `vue` 等 chunk，减轻首屏体积。
- `sw.js` 会缓存 `/assets/` 等静态文件，二次打开更快。

更新代码后照常 `bash deploy/aliyun-ecs.sh` 即可。

### 5. 用户侧建议

- 联通/移动用户通常比电信晚高峰更稳定；可提示用户换网络或避开 20:00–23:00。
- 长期要以大陆用户为主且要求稳定，仍需 **ICP 备案 + 大陆机房**。
