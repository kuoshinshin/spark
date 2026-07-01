/** 与 api.js 保持一致：API 根路径（含 /api 后缀） */
export function resolveApiBaseUrl() {
  const explicit = import.meta.env.VITE_API_BASE_URL
  if (explicit) return String(explicit).replace(/\/$/, '')
  if (import.meta.env.DEV) return 'http://127.0.0.1:3000/api'
  return '/api'
}

/**
 * 将数据库中的 /uploads/... 转为可请求的地址。
 * 统一走 /api/uploads，避免生产环境 Nginx 静态图片规则抢走 /uploads 导致 404。
 */
export function resolveMediaUrl(path) {
  if (typeof path !== 'string') return path
  const trimmed = path.trim()
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) return trimmed
  if (trimmed.startsWith('/uploads/')) {
    return `${resolveApiBaseUrl()}${trimmed}`
  }
  return trimmed
}
