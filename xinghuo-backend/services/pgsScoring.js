const PGS_PLACEMENT_POINTS = Object.freeze({
  1: 10,
  2: 6,
  3: 5,
  4: 4,
  5: 3,
  6: 2,
  7: 1,
  8: 1,
  9: 1,
  10: 1,
  11: 0,
  12: 0,
  13: 0,
  14: 0,
  15: 0,
  16: 0,
});

const PGS_KILL_POINT = 1;

function normalizePlacement(value) {
  const placement = Number(value);
  if (!Number.isInteger(placement) || placement < 1 || placement > 16) {
    throw new Error('队伍排名 placement 必须是 1-16 的整数');
  }
  return placement;
}

function normalizeKills(value) {
  const kills = Number(value);
  if (!Number.isFinite(kills) || kills < 0) {
    throw new Error('队伍淘汰数 kills 必须是大于等于 0 的数字');
  }
  return Math.floor(kills);
}

function calculateTeamScore({ placement, kills }) {
  const normalizedPlacement = normalizePlacement(placement);
  const normalizedKills = normalizeKills(kills);
  const placementPoints = PGS_PLACEMENT_POINTS[normalizedPlacement] ?? 0;
  const killPoints = normalizedKills * PGS_KILL_POINT;

  return {
    placement: normalizedPlacement,
    kills: normalizedKills,
    placementPoints,
    killPoints,
    totalPoints: placementPoints + killPoints,
  };
}

function calculateStageScores(teams = []) {
  if (!Array.isArray(teams)) {
    throw new Error('teams 必须是数组');
  }

  const rows = teams.map((team, index) => {
    const result = calculateTeamScore({
      placement: team?.placement,
      kills: team?.kills,
    });

    return {
      teamId: team?.teamId ?? null,
      teamName: team?.teamName || `Team-${index + 1}`,
      ...result,
    };
  });

  rows.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.killPoints !== a.killPoints) return b.killPoints - a.killPoints;
    return a.placement - b.placement;
  });

  return rows.map((item, index) => ({
    rank: index + 1,
    ...item,
  }));
}

function getRuleSummary() {
  return {
    ruleName: 'PGS 当前积分规则',
    killPoint: PGS_KILL_POINT,
    placementPoints: PGS_PLACEMENT_POINTS,
    formula: '总分 = 名次分 + 淘汰分(淘汰数 * 1)',
  };
}

module.exports = {
  PGS_PLACEMENT_POINTS,
  PGS_KILL_POINT,
  calculateTeamScore,
  calculateStageScores,
  getRuleSummary,
};
