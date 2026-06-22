const BeanLobbyModel = require('../models/beanLobbyModel');
const { getRecentMatches, getMatchById, parsePlayerStatsFromMatch } = require('./pubgApi');
const { buildSettlement } = require('./beanRuleEngine');

function normalizeDate(value) {
  if (!value) return '';
  return String(value);
}

function isAfterSessionStart(matchCreatedAt, sessionStartedAt) {
  const matchTime = new Date(matchCreatedAt).getTime();
  const startTime = new Date(sessionStartedAt).getTime();
  if (!Number.isFinite(matchTime) || !Number.isFinite(startTime)) return true;
  return matchTime >= startTime;
}

function pickNewCommonMatchIds(recentByUser, { afterTime = '', excludeMatchIds = new Set() } = {}) {
  const counter = new Map();
  const meta = new Map();
  for (const [, matches] of recentByUser.entries()) {
    const seen = new Set();
    for (const item of matches) {
      if (!item?.matchId || item.isCustomMatch) continue;
      const matchId = String(item.matchId);
      if (seen.has(matchId) || excludeMatchIds.has(matchId)) continue;
      if (afterTime && !isAfterSessionStart(item.createdAt, afterTime)) continue;
      seen.add(matchId);
      counter.set(matchId, (counter.get(matchId) || 0) + 1);
      const old = meta.get(matchId);
      const createdAt = normalizeDate(item.createdAt);
      if (!old || createdAt > old.createdAt) {
        meta.set(matchId, {
          createdAt,
          gameMode: item.gameMode || '',
          matchType: item.matchType || '',
          mapName: item.mapName || '',
        });
      }
    }
  }
  return [...counter.entries()]
    .filter(([, count]) => count === 4)
    .map(([matchId]) => ({
      matchId,
      createdAt: meta.get(matchId)?.createdAt || '',
      gameMode: meta.get(matchId)?.gameMode || '',
      matchType: meta.get(matchId)?.matchType || '',
      mapName: meta.get(matchId)?.mapName || '',
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

async function fetchRecentSquadMatchesForPlayer(player, pageSize = 20) {
  const raw = await getRecentMatches(player.pubgPlatform, player.pubgPlayerId, 1, pageSize, 'squad');
  return (raw.list || []).filter((item) => !item.isCustomMatch);
}

async function settleSingleMatch(session, players, matchId, { operatorUserId = null, source = 'auto' } = {}) {
  const platform = players[0].pubgPlatform;
  const matchData = await getMatchById(platform, matchId);
  const firstParsed = parsePlayerStatsFromMatch(matchData, players[0].pubgPlayerId);
  const matchedPlayers = players.map((p) => {
    const parsed = parsePlayerStatsFromMatch(matchData, p.pubgPlayerId);
    return {
      ...p,
      damage: parsed?.damageDealt ?? null,
      kills: parsed?.kills ?? null,
      winPlace: parsed?.rank ?? null,
    };
  });

  const missingMatchData = matchedPlayers.find((p) => p.damage == null || p.kills == null || p.winPlace == null);
  if (missingMatchData) {
    await BeanLobbyModel.appendLog({
      sessionId: session.id,
      action: 'auto_match_failed',
      operatorUserId,
      detail: { reason: 'PLAYER_NOT_IN_MATCH', matchId, userId: missingMatchData.userId },
    });
    return { ok: false, code: 'MATCH_DATA_INCOMPLETE', message: '匹配到对局但玩家数据不完整，请手动修正' };
  }

  const settlement = buildSettlement(
    matchedPlayers.map((p) => ({
      userId: p.userId,
      seatNo: p.seatNo,
      displayName: p.displayName,
      damage: p.damage,
      kills: p.kills,
      winPlace: p.winPlace,
    })),
    session.random_seed || Date.now()
  );

  if (!settlement.ok) {
    return { ok: false, code: settlement.code || 'SETTLE_FAILED', message: settlement.message || '结算失败' };
  }

  const playersToSave = settlement.players.map((p) => ({
    userId: p.userId,
    damage: p.damage,
    kills: p.kills,
    winPlace: p.winPlace,
    tail: p.tail,
    teamNo: p.teamNo,
    netBeans: p.netBeans,
    sourceConfidence: settlement.needsRandom ? 0.8 : 1,
    manualOverride: source === 'manual',
  }));

  const summary = {
    strategy: settlement.strategy,
    needsRandom: settlement.needsRandom,
    rollPoints: settlement.rollPoints || [],
    winner: settlement.beanResult.winner,
    killsA: settlement.beanResult.killsA,
    killsB: settlement.beanResult.killsB,
    beanBase: settlement.beanResult.beanBase,
    beanTotal: settlement.beanResult.beanTotal,
    multiplied: settlement.beanResult.multiplied,
    teamAUserIds: settlement.teamA.map((p) => p.userId),
    teamBUserIds: settlement.teamB.map((p) => p.userId),
  };

  const appendResult = await BeanLobbyModel.appendSessionRound({
    sessionId: session.id,
    matchId,
    matchCreatedAt: firstParsed?.createdAt || null,
    gameMode: firstParsed?.gameMode || '',
    matchType: firstParsed?.matchType || '',
    mapName: firstParsed?.mapName || '',
    summary,
    players: playersToSave,
    source,
    operatorUserId,
  });

  if (!appendResult.ok) {
    return appendResult;
  }

  return {
    ok: true,
    sessionId: session.id,
    resolvedMatchId: matchId,
    roundNo: appendResult.roundNo,
    summary,
    players: playersToSave,
  };
}

async function autoSettleSession(sessionId, { operatorUserId = null, matchId = '' } = {}) {
  const { pollSession } = require('./beanPollService');
  if (String(matchId || '').trim()) {
    const session = await BeanLobbyModel.getSessionById(sessionId);
    if (!session) {
      return { ok: false, code: 'SESSION_NOT_FOUND', message: '豆子局会话不存在' };
    }
    const players = await BeanLobbyModel.getSessionPlayers(sessionId);
    if (players.length !== 4) {
      return { ok: false, code: 'PLAYER_COUNT_INVALID', message: '会话玩家必须是 4 人' };
    }
    const processed = await BeanLobbyModel.listProcessedMatchIds(sessionId);
    if (processed.has(String(matchId).trim())) {
      return { ok: false, code: 'MATCH_ALREADY_SETTLED', message: '该对局已结算' };
    }
    return settleSingleMatch(session, players, String(matchId).trim(), { operatorUserId });
  }
  return pollSession(sessionId, { operatorUserId });
}

module.exports = {
  fetchRecentSquadMatchesForPlayer,
  pickNewCommonMatchIds,
  settleSingleMatch,
  autoSettleSession,
};
