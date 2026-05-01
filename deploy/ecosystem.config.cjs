/**
 * PM2 进程描述（与 deploy/aliyun-ecs.sh 配套）
 * 用法：在仓库根目录执行 pm2 start deploy/ecosystem.config.cjs
 */
const path = require('path')

const backendDir = path.join(__dirname, '..', 'xinghuo-backend')

module.exports = {
  apps: [
    {
      name: 'xinghuo-api',
      cwd: backendDir,
      script: 'app.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '5s',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
