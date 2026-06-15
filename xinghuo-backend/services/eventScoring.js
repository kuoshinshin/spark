/** V2 默认积分规则 */
const DEFAULT_PLACEMENT_POINTS = {
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
};

function getDefaultScoringConfig() {
  return {
    placementPoints: { ...DEFAULT_PLACEMENT_POINTS },
    pointsPerKill: 1,
  };
}

function calculateTeamPoints(placement, kills, scoringConfig) {
  const config = scoringConfig || getDefaultScoringConfig();
  const placementPoints = Number(config.placementPoints?.[placement] ?? 0);
  const killPoints = Number(kills || 0) * Number(config.pointsPerKill ?? 1);
  return {
    placementPoints,
    killPoints,
    totalPoints: placementPoints + killPoints,
  };
}

function validateRoundResults(results, teamCount = 16) {
  if (!Array.isArray(results) || results.length !== teamCount) {
    return { ok: false, message: `须录入 ${teamCount} 支队伍成绩` };
  }
  const placements = new Set();
  for (const row of results) {
    const placement = Number(row.placement);
    const kills = Number(row.kills);
    if (!Number.isInteger(placement) || placement < 1 || placement > teamCount) {
      return { ok: false, message: `名次须在 1–${teamCount} 之间` };
    }
    if (!Number.isInteger(kills) || kills < 0) {
      return { ok: false, message: '击杀数须为非负整数' };
    }
    if (placements.has(placement)) {
      return { ok: false, message: '名次不能重复' };
    }
    placements.add(placement);
  }
  return { ok: true };
}

function buildStandings(teams, rounds, resultsByRound) {
  const teamMap = new Map(
    teams.map((t) => [
      t.id,
      {
        teamId: t.id,
        teamNumber: t.team_number,
        teamName: t.team_name,
        totalPoints: 0,
        totalKills: 0,
        rounds: [],
      },
    ])
  );

  const sortedRounds = [...rounds].sort((a, b) => a.round_no - b.round_no);
  sortedRounds.forEach((round) => {
    if (round.status !== 'completed') return;
    const rows = resultsByRound.get(round.id) || [];
    rows.forEach((row) => {
      const entry = teamMap.get(row.event_team_id);
      if (!entry) return;
      entry.totalPoints += Number(row.total_points || 0);
      entry.totalKills += Number(row.kills || 0);
      entry.rounds.push({
        roundId: round.id,
        roundNo: round.round_no,
        mapName: round.map_name,
        placement: row.placement,
        kills: row.kills,
        totalPoints: row.total_points,
      });
    });
  });

  const standings = [...teamMap.values()].sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    return b.totalKills - a.totalKills;
  });

  standings.forEach((row, index) => {
    row.rank = index + 1;
  });

  return standings;
}

module.exports = {
  DEFAULT_PLACEMENT_POINTS,
  getDefaultScoringConfig,
  calculateTeamPoints,
  validateRoundResults,
  buildStandings,
};
