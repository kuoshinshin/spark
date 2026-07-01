/** 与后端 pubgApi.calculatePowerLevel 评级区间一致 */
export function sparkLevelFromScore(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return '—'
  if (n >= 840) return '魔王S'
  if (n >= 700) return 'S'
  if (n >= 560) return 'A'
  if (n >= 460) return 'B'
  if (n >= 380) return 'C'
  if (n >= 300) return 'D'
  return 'E'
}
