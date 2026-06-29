export const DEFAULT_AVATAR = '/default-avatar.svg'

const failedAvatarUrls = new Set()

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
  if (a.startsWith('http://') || a.startsWith('https://') || a.startsWith('data:')) {
    if (failedAvatarUrls.has(a)) return DEFAULT_AVATAR
    return a
  }
  const explicit = import.meta.env.VITE_API_BASE_URL
  let resolved = a
  if (explicit && /^https?:\/\//i.test(String(explicit).trim()) && a.startsWith('/')) {
    try {
      const base = String(explicit).replace(/\/$/, '')
      resolved = new URL(a, base).href
    } catch {
      resolved = a
    }
  }
  if (failedAvatarUrls.has(resolved)) return DEFAULT_AVATAR
  return resolved
}

export function handleAvatarImgError(event) {
  const img = event?.target
  if (!img || img.dataset?.avatarFallback === '1') return
  if (img.src && !img.src.includes('default-avatar')) {
    failedAvatarUrls.add(img.src)
  }
  img.dataset.avatarFallback = '1'
  img.src = DEFAULT_AVATAR
}
