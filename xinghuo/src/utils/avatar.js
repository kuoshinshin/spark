import { resolveMediaUrl } from './mediaUrl'

export const DEFAULT_AVATAR = '/default-avatar.svg'

const failedAvatarUrls = new Set()

export function normalizeAvatar(avatar) {
  if (typeof avatar !== 'string') return DEFAULT_AVATAR
  const trimmed = avatar.trim()
  if (!trimmed) return DEFAULT_AVATAR
  if (trimmed === '/default-avatar.png') return DEFAULT_AVATAR
  return trimmed
}

function resolveAvatarUrl(path) {
  return resolveMediaUrl(path)
}

/** 用于 <img> / el-avatar：用户上传资源统一经 /api/uploads 访问 */
export function avatarDisplayUrl(avatar, cacheBust) {
  const a = normalizeAvatar(avatar)
  if (a.startsWith('http://') || a.startsWith('https://') || a.startsWith('data:')) {
    const withBust = cacheBust ? appendCacheBust(a, cacheBust) : a
    if (failedAvatarUrls.has(withBust)) return DEFAULT_AVATAR
    return withBust
  }
  let resolved = resolveAvatarUrl(a)
  if (cacheBust) resolved = appendCacheBust(resolved, cacheBust)
  if (failedAvatarUrls.has(resolved)) return DEFAULT_AVATAR
  return resolved
}

function appendCacheBust(url, token) {
  if (!token || url.startsWith('data:')) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}v=${encodeURIComponent(String(token))}`
}

/** 上传新头像后清除该路径的失败标记，避免会话内一直显示默认图 */
export function clearFailedAvatar(avatar) {
  const a = normalizeAvatar(avatar)
  if (!a || a === DEFAULT_AVATAR) return
  failedAvatarUrls.delete(a)
  const resolved = resolveMediaUrl(a)
  failedAvatarUrls.delete(resolved)
  if (typeof window !== 'undefined') {
    failedAvatarUrls.delete(`${window.location.origin}${a}`)
    if (resolved.startsWith('/')) {
      failedAvatarUrls.delete(`${window.location.origin}${resolved}`)
    }
  }
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
