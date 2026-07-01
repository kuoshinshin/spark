/** 与 api.js 保持一致：API 根路径（含 /api 后缀） */
export function resolveApiBaseUrl() {
  const explicit = import.meta.env.VITE_API_BASE_URL
  if (explicit) return String(explicit).replace(/\/$/, '')
  if (import.meta.env.DEV) return 'http://127.0.0.1:3000/api'
  return '/api'
}

/** 将 /uploads/...、/api/uploads/... 等统一为 avatars/foo.png */
export function extractUploadStoragePath(raw) {
  if (typeof raw !== 'string') return null
  let value = raw.trim()
  if (!value) return null

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      if (url.pathname === '/api/media' || url.pathname.endsWith('/api/media')) {
        const nested = url.searchParams.get('path')
        if (nested) value = decodeURIComponent(nested)
        else return null
      } else {
        value = url.pathname
      }
    } catch {
      return null
    }
  }

  value = value.split('?')[0].replace(/^\/+/, '')
  value = value.replace(/^api\/uploads\//, '').replace(/^uploads\//, '')

  if (value.includes('..') || value.includes('\\')) return null
  if (!/^(avatars|posts)\/[^/]+$/i.test(value)) return null
  return value
}

/**
 * 将数据库中的 /uploads/... 转为可请求的地址。
 * 使用 /api/media?path=...（路径不以 .png 结尾），避免 Nginx 静态图片正则抢走请求。
 */
export function resolveMediaUrl(path) {
  if (typeof path !== 'string') return path
  const trimmed = path.trim()
  if (!trimmed) return trimmed
  if (trimmed.startsWith('data:')) return trimmed

  const storagePath = extractUploadStoragePath(trimmed)
  if (!storagePath) {
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    return trimmed
  }

  const qs = `path=${encodeURIComponent(storagePath)}`
  const apiBase = resolveApiBaseUrl()
  if (/^https?:\/\//i.test(apiBase)) {
    return `${apiBase}/media?${qs}`
  }
  return `${apiBase}/media?${qs}`
}
