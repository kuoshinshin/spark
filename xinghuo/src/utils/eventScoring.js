export const DEFAULT_PLACEMENT_POINTS = {
  1: 10,
  2: 6,
  3: 5,
  4: 5,
  5: 4,
  6: 4,
  7: 4,
  8: 4,
  9: 3,
  10: 3,
  11: 3,
  12: 3,
  13: 2,
  14: 2,
  15: 2,
  16: 1,
}

export const DEFAULT_BASIC_INFO_CONTENT = `【赛制】16 支队伍，每队 5 人（1 队长 + 4 队员），四排模式。

【计分】单局总分 = 排名分 + 击杀分；赛事总分 = 各局之和，同分比较总击杀。

【报名】开放期间可自由选队、离队；锁名单后不可变更。`

export const createDefaultPlacementRows = () => (
  Array.from({ length: 16 }, (_, index) => ({
    rank: index + 1,
    points: DEFAULT_PLACEMENT_POINTS[index + 1],
  }))
)

export const placementRowsToMap = (rows) => (
  Object.fromEntries((rows || []).map((row) => [Number(row.rank), Number(row.points) || 0]))
)

export const placementMapToRows = (map) => (
  Array.from({ length: 16 }, (_, index) => {
    const rank = index + 1
    return {
      rank,
      points: Number(map?.[rank] ?? map?.[String(rank)] ?? DEFAULT_PLACEMENT_POINTS[rank]),
    }
  })
)
