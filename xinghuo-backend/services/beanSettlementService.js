const BeanLobbyModel = require('../models/beanLobbyModel');
const { getRecentMatches, getMatchById, parsePlayerStatsFromMatch } = require('./pubgApi');
const { buildSettlement } = require('./beanRuleEngine');

const DEFAULT_MATCH_LOOKBACK_MS = 3 * 60 * 60 * 1000;

function normalizeDate(value) {
  if (!value) return '';
  return String(value);
}

function getMatchLookbackMs() {
  const raw = Number(process.env.BEAN_MATCH_LOOKBACK_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MATCH_LOOKBACK_MS;
}

function isWithinMatchWindow(matchCreatedAt, sessionStartedAt) {
  const matchTime = new Date(matchCreatedAt).getTime();
  const startTime = new Date(sessionStartedAt).getTime();
  if (!Number.isFinite(matchTime) || !Number.isFinite(startTime)) return true;
  return matchTime >= startTime - getMatchLookbackMs();
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

function allPlayersPresentInMatch(matchData, players) {
  return players.every((player) => {
    const parsed = parsePlayerStatsFromMatch(matchData, player.pubgPlayerId);
    return parsed && parsed.damageDealt != null && parsed.kills != null && parsed.rank != null;
  });
}

async function fetchRecentSquadMatchesForPlayer(player, pageSize = 20) {
  const raw = await getRecentMatches(player.pubgPlatform, player.pubgPlayerId, 1, pageSize, 'squad');
  return (raw.list || []).filter((item) => !item.isCustomMatch);
}

async function findSettleableMatches(session, players, excludeMatchIds = new Set()) {
  const candidateMap = new Map();
  for (const player of players) {
    const list = await fetchRecentSquadMatchesForPlayer(player, 20);
    for (const item of list) {
      if (!item?.matchId || item.isCustomMatch) continue;
      const matchId = String(item.matchId);
      if (excludeMatchIds.has(matchId)) continue;
      if (!isWithinMatchWindow(item.createdAt, session.started_at)) continue;
      const createdAt = normalizeDate(item.createdAt);
      const existing = candidateMap.get(matchId);
      if (!existing || createdAt > existing.createdAt) {
        candidateMap.set(matchId, {
          matchId,
          createdAt,
          gameMode: item.gameMode || '',
          matchType: item.matchType || '',
          mapName: item.mapName || '',
        });
      }
    }
  }

  const platform = players[0].pubgPlatform;
  const verified = [];
  const sortedCandidates = [...candidateMap.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  for (const candidate of sortedCandidates) {
    try {
      const matchData = await getMatchById(platform, candidate.matchId);
      if (allPlayersPresentInMatch(matchData, players)) {
        verified.push(candidate);
      }
    } catch (error) {
      console.warn(`[bean-settle] skip match ${candidate.matchId}:`, error?.message || error);
    }
  }

  return verified;
}

function mapPubgPollError(error) {
  if (error?.code === 'PUBG_API_KEY_MISSING') {
    return { ok: false, code: 'PUBG_API_KEY_MISSING', message: '服务器未配置 PUBG API Key，请联系管理员' };
  }
  if (error?.statusCode === 429) {
    return { ok: false, code: 'PUBG_RATE_LIMIT', message: 'PUBG API 请求过于频繁，请稍后重试' };
  }
  if (error?.statusCode === 401 || error?.statusCode === 403) {
    return { ok: false, code: 'PUBG_API_KEY_INVALID', message: 'PUBG API Key 无效或已过期，请联系管理员' };
  }
  return { ok: false, code: 'PUBG_API_ERROR', message: error?.message || 'PUBG 服务暂时不可用，请稍后重试' };
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
  findSettleableMatches,
  mapPubgPollError,
  settleSingleMatch,
  autoSettleSession,
};
