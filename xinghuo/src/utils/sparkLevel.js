/** 与后端 pubgApi.calculatePowerLevel 评级区间一致（战力 v2） */
export function sparkLevelFromScore(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return '—'
  if (n >= 720) return '魔王S'
  if (n >= 620) return 'S'
  if (n >= 520) return 'A'
  if (n >= 430) return 'B'
  if (n >= 350) return 'C'
  if (n >= 280) return 'D'
  return 'E'
}

export const POWER_SCORE_V2 = {
  CONFIDENCE_ROUNDS: 25,
}
