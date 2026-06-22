export function matchTypeLabel(matchType) {
  const value = String(matchType || '').toLowerCase()
  if (value === 'competitive' || value === 'ranked') return '竞技四排'
  return '匹配四排'
}

export function mapTimelineRounds(rounds, players = []) {
  const nameById = new Map(players.map((p) => [Number(p.userId), p.displayName]))
  return [...(rounds || [])]
    .sort((a, b) => Number(b.roundNo || 0) - Number(a.roundNo || 0))
    .map((round) => {
      const summary = round.summary || {}
      const teamA = (summary.teamAUserIds || []).map((id) => nameById.get(Number(id)) || `#${id}`)
      const teamB = (summary.teamBUserIds || []).map((id) => nameById.get(Number(id)) || `#${id}`)
      const tails = (round.players || [])
        .map((p) => `${nameById.get(Number(p.userId)) || p.userId}:${p.tail ?? '-'}`)
        .join(' / ')
      const beanItems = (round.players || []).map((p) => ({
        name: nameById.get(Number(p.userId)) || `玩家${p.userId}`,
        netBeans: Number(p.netBeans || 0),
      }))
      return {
        id: round.id,
        roundNo: round.roundNo,
        matchId: round.matchId,
        matchCreatedAt: round.matchCreatedAt,
        mapName: round.mapName || '-',
        matchTypeLabel: matchTypeLabel(round.matchType),
        tails,
        grouping: `${teamA.join('+')} vs ${teamB.join('+')}`,
        killsA: Number(summary.killsA || 0),
        killsB: Number(summary.killsB || 0),
        beanDelta: summary.winner ? `${summary.winner}队 +${summary.beanTotal || 0}` : '0',
        note: summary.multiplied ? '吃鸡翻倍' : '常规结算',
        beanItems,
        isMock: Boolean(round.isMock),
      }
    })
}
