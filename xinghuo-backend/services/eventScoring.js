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

const DEFAULT_BASIC_INFO_CONTENT = `【赛制】16 支队伍，每队 5 人（1 队长 + 4 队员），四排模式。

【计分】单局总分 = 排名分 + 击杀分；赛事总分 = 各局之和，同分比较总击杀。

【报名】开放期间可自由选队、离队；锁名单后不可变更。`;

function getDefaultBasicInfoContent() {
  return DEFAULT_BASIC_INFO_CONTENT;
}

function getDefaultScoringConfig() {
  return {
    placementPoints: { ...DEFAULT_PLACEMENT_POINTS },
    pointsPerKill: 1,
  };
}

function normalizePlacementPoints(raw) {
  const defaults = DEFAULT_PLACEMENT_POINTS;
  const source = raw && typeof raw === 'object' ? raw : defaults;
  const result = {};
  for (let i = 1; i <= 16; i += 1) {
    const val = Number(source[i] ?? source[String(i)] ?? defaults[i]);
    result[i] = Number.isFinite(val) && val >= 0 ? Math.round(val) : defaults[i];
  }
  return result;
}

function scoringConfigFromBasicInfo(basicInfo) {
  if (!basicInfo) return getDefaultScoringConfig();
  let placementRaw = basicInfo.placement_points;
  if (typeof placementRaw === 'string') {
    try {
      placementRaw = JSON.parse(placementRaw);
    } catch {
      placementRaw = null;
    }
  }
  return {
    placementPoints: normalizePlacementPoints(placementRaw),
    pointsPerKill: Number(basicInfo.points_per_kill ?? 1),
  };
}

function buildPlacementTable(placementPoints) {
  const points = normalizePlacementPoints(placementPoints);
  const rows = [];
  let start = 1;
  for (let rank = 1; rank <= 16; rank += 1) {
    const current = points[rank];
    const next = rank < 16 ? points[rank + 1] : null;
    if (rank === 16 || current !== next) {
      rows.push({
        rankLabel: start === rank ? `第 ${rank} 名` : `第 ${start}–${rank} 名`,
        points: current,
      });
      start = rank + 1;
    }
  }
  return rows;
}

function validateBasicInfoPayload({ content, placementPoints, pointsPerKill }) {
  if (content != null && String(content).length > 8000) {
    return { ok: false, message: '基础信息正文不能超过 8000 字' };
  }
  if (placementPoints) {
    const normalized = normalizePlacementPoints(placementPoints);
    for (let i = 1; i <= 16; i += 1) {
      if (!Number.isInteger(normalized[i]) || normalized[i] < 0) {
        return { ok: false, message: `第 ${i} 名排名分须为非负整数` };
      }
    }
  }
  if (pointsPerKill != null) {
    const ppk = Number(pointsPerKill);
    if (!Number.isFinite(ppk) || ppk < 0 || ppk > 100) {
      return { ok: false, message: '每击杀得分须在 0–100 之间' };
    }
  }
  return { ok: true };
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

function sumMemberKills(members) {
  if (!Array.isArray(members) || !members.length) return null;
  return members.reduce((sum, member) => {
    const kills = Number(member?.kills ?? 0);
    return sum + (Number.isFinite(kills) && kills >= 0 ? kills : 0);
  }, 0);
}

function normalizeRoundInput(row) {
  const members = Array.isArray(row.members) ? row.members : [];
  const memberKillSum = sumMemberKills(members);
  const kills = memberKillSum != null ? memberKillSum : Number(row.kills || 0);
  return {
    ...row,
    members,
    kills,
  };
}

function validateMemberResults(members, occupiedSlotIndexes) {
  if (!Array.isArray(members) || !members.length) return { ok: true };
  const allowed = new Set(occupiedSlotIndexes);
  for (const member of members) {
    const slotIndex = Number(member.slotIndex ?? member.slot_index);
    const kills = Number(member.kills ?? 0);
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 4) {
      return { ok: false, message: '成员槽位无效' };
    }
    if (!allowed.has(slotIndex)) {
      return { ok: false, message: '成员槽位与当前名单不一致' };
    }
    if (!Number.isInteger(kills) || kills < 0) {
      return { ok: false, message: '成员击杀须为非负整数' };
    }
  }
  return { ok: true };
}

function validateRoundResults(results, teamCount = 16) {
  if (!Array.isArray(results) || results.length !== teamCount) {
    return { ok: false, message: `须录入 ${teamCount} 支队伍成绩` };
  }
  const placements = new Set();
  for (const rawRow of results) {
    const row = normalizeRoundInput(rawRow);
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

function memberKillSumKey(roundId, teamId) {
  return `${roundId}:${teamId}`;
}

function resolveStoredRoundScores(row, scoringConfig, memberKillSum = null) {
  const config = scoringConfig || getDefaultScoringConfig();
  const placement = Number(row.placement || 0);
  let kills = Number(row.kills || 0);
  if (memberKillSum != null && memberKillSum > kills) {
    kills = memberKillSum;
  }
  const calculated = calculateTeamPoints(placement, kills, config);
  const placementPoints = Number(row.placement_points ?? calculated.placementPoints);
  let killPoints = Number(row.kill_points ?? 0);
  if (killPoints === 0 && kills > 0) {
    killPoints = calculated.killPoints;
  }
  let totalPoints = Number(row.total_points ?? 0);
  if (totalPoints === 0 && (placementPoints > 0 || killPoints > 0)) {
    totalPoints = placementPoints + killPoints;
  } else if (kills > 0 && totalPoints < placementPoints + killPoints) {
    totalPoints = placementPoints + killPoints;
  }
  return {
    placement,
    kills,
    placementPoints,
    killPoints,
    totalPoints,
  };
}

function buildStandings(teams, rounds, resultsByRound, scoringConfig = null, memberKillSumMap = null) {
  const teamMap = new Map(
    teams.map((t) => [
      t.id,
      {
        teamId: t.id,
        teamNumber: t.team_number,
        teamName: t.team_name,
        totalPoints: 0,
        totalPlacementPoints: 0,
        totalKillPoints: 0,
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
      const memberKillSum = memberKillSumMap?.get(
        memberKillSumKey(row.round_id, row.event_team_id)
      ) ?? null;
      const resolved = resolveStoredRoundScores(row, scoringConfig, memberKillSum);
      entry.totalPoints += resolved.totalPoints;
      entry.totalPlacementPoints += resolved.placementPoints;
      entry.totalKillPoints += resolved.killPoints;
      entry.totalKills += resolved.kills;
      entry.rounds.push({
        roundId: round.id,
        roundNo: round.round_no,
        mapName: round.map_name,
        placement: resolved.placement,
        kills: resolved.kills,
        placementPoints: resolved.placementPoints,
        killPoints: resolved.killPoints,
        totalPoints: resolved.totalPoints,
        hasMemberDetails: Boolean(row.has_member_details),
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
  DEFAULT_BASIC_INFO_CONTENT,
  getDefaultBasicInfoContent,
  getDefaultScoringConfig,
  normalizePlacementPoints,
  scoringConfigFromBasicInfo,
  buildPlacementTable,
  validateBasicInfoPayload,
  sumMemberKills,
  normalizeRoundInput,
  validateMemberResults,
  calculateTeamPoints,
  validateRoundResults,
  resolveStoredRoundScores,
  memberKillSumKey,
  buildStandings,
};
