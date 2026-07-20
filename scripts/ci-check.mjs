# 轻量质量门禁：前端 build + 后端语法检查
# 用法：在仓库根目录执行  node scripts/ci-check.mjs

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(label, command, args, cwd) {
  console.log(`\n==> ${label}`)
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  })
  if (result.status !== 0) {
    console.error(`\n[ci-check] 失败: ${label} (exit ${result.status})`)
    process.exit(result.status || 1)
  }
}

const frontend = path.join(root, 'xinghuo')
const backend = path.join(root, 'xinghuo-backend')

run('frontend install', 'npm', ['ci'], frontend)
run('frontend build', 'npm', ['run', 'build'], frontend)

run('backend install', 'npm', ['ci'], backend)

const backendFiles = [
  'app.js',
  'services/pubgApi.js',
  'controllers/userController.js',
  'routes/user.js',
  'models/chatModel.js',
]

for (const file of backendFiles) {
  run(`backend syntax ${file}`, 'node', ['--check', file], backend)
}

console.log('\n[ci-check] 全部通过')
