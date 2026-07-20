/**
 * PM2 进程描述（与 deploy/aliyun-ecs.sh 配套）
 * 用法：在仓库根目录执行 pm2 start deploy/ecosystem.config.cjs
 */
const path = require('path')

const backendDir = path.join(__dirname, '..', 'xinghuo-backend')
const dotenv = require(path.join(backendDir, 'node_modules', 'dotenv'))

dotenv.config({ path: path.join(backendDir, '.env') })

const rawEnv = {
  NODE_ENV: 'production',
  PORT: process.env.PORT,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  DB_HOST: process.env.DB_HOST,
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_NAME: process.env.DB_NAME,
  CORS_ORIGIN: process.env.CORS_ORIGIN,
  TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS,
  INIT_DEFAULT_INVITE_CODE: process.env.INIT_DEFAULT_INVITE_CODE,
  PUBG_API_KEY: process.env.PUBG_API_KEY,
}

const productionEnv = Object.fromEntries(
  Object.entries(rawEnv).filter(([, value]) => value != null && String(value).trim() !== '')
)

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
      env: productionEnv,
    },
  ],
}
