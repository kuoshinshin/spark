/** 与后端 pubgApi.calculatePowerLevel 评级区间一致 */
export function sparkLevelFromScore(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return '—'
  if (n >= 920) return '魔王S'
  if (n >= 780) return 'S'
  if (n >= 620) return 'A'
  if (n >= 520) return 'B'
  if (n >= 430) return 'C'
  if (n >= 350) return 'D'
  return 'E'
}
