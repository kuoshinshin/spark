/** 与后端 pubgApi.calculatePowerLevel 评级区间一致（战力 v2） */
export function sparkLevelFromScore(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return '—'
  if (n >= 820) return '魔王S'
  if (n >= 720) return 'S'
  if (n >= 620) return 'A'
  if (n >= 520) return 'B'
  if (n >= 420) return 'C'
  if (n >= 320) return 'D'
  return 'E'
}

export const POWER_SCORE_V2 = {
  CONFIDENCE_ROUNDS: 25,
}
