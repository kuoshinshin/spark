export const DEFAULT_AVATAR = '/default-avatar.png'

export function normalizeAvatar(avatar) {
  if (typeof avatar !== 'string') return DEFAULT_AVATAR
  const trimmed = avatar.trim()
  return trimmed ? trimmed : DEFAULT_AVATAR
}
