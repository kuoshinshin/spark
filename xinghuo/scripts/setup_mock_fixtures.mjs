import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(new URL('../', import.meta.url)))
const mockDir = path.join(root, 'src', 'mock')

const copies = [
  ['beanTimeline.fixture.example.js', 'beanTimeline.fixture.js'],
]

let created = 0
for (const [from, to] of copies) {
  const src = path.join(mockDir, from)
  const dest = path.join(mockDir, to)
  if (fs.existsSync(dest)) {
    console.log(`[mock:setup] 已存在，跳过: ${to}`)
    continue
  }
  if (!fs.existsSync(src)) {
    console.warn(`[mock:setup] 模板不存在: ${from}`)
    continue
  }
  fs.copyFileSync(src, dest)
  created += 1
  console.log(`[mock:setup] 已创建: ${to}`)
}

if (created === 0) {
  console.log('[mock:setup] 无需新建文件。请在 .env 中设置 VITE_USE_MOCK_DATA=true 后重启前端。')
} else {
  console.log('[mock:setup] 完成。请在 .env 中设置 VITE_USE_MOCK_DATA=true 并重启 npm run dev。')
}
