export const DEFAULT_AVATAR = '/default-avatar.svg'

export function normalizeAvatar(avatar) {
  if (typeof avatar !== 'string') return DEFAULT_AVATAR
  const trimmed = avatar.trim()
  if (!trimmed) return DEFAULT_AVATAR
  if (trimmed === '/default-avatar.png') return DEFAULT_AVATAR
  return trimmed
}

/** 用于 <img> / el-avatar：相对路径在「前端与 API 不同源」时补全为可请求的绝对地址 */
export function avatarDisplayUrl(avatar) {
  const a = normalizeAvatar(avatar)
  if (a.startsWith('http://') || a.startsWith('https://') || a.startsWith('data:')) return a
  const explicit = import.meta.env.VITE_API_BASE_URL
  if (explicit && /^https?:\/\//i.test(String(explicit).trim()) && a.startsWith('/')) {
    try {
      const base = String(explicit).replace(/\/$/, '')
      return new URL(a, base).href
    } catch {
      /* ignore */
    }
  }
  return a
}

export function handleAvatarImgError(event) {
  const img = event?.target
  if (!img || img.dataset?.avatarFallback === '1') return
  img.dataset.avatarFallback = '1'
  img.src = DEFAULT_AVATAR
}
