const BeanLobbyModel = require('../models/beanLobbyModel');
const {
  fetchRecentSquadMatchesForPlayer,
  pickNewCommonMatchIds,
  settleSingleMatch,
} = require('./beanSettlementService');

const ACTIVE_SESSION_STATUSES = new Set(['started', 'matching', 'preview', 'matched', 'failed']);

async function pollSession(sessionId, { operatorUserId = null } = {}) {
  const session = await BeanLobbyModel.getSessionById(sessionId);
  if (!session) {
    return { ok: false, code: 'SESSION_NOT_FOUND', message: '豆子局会话不存在' };
  }
  if (!ACTIVE_SESSION_STATUSES.has(session.status)) {
    return { ok: false, code: 'INVALID_STATUS', message: '当前状态不允许同步战绩' };
  }

  const players = await BeanLobbyModel.getSessionPlayers(sessionId);
  if (players.length !== 4) {
    return { ok: false, code: 'PLAYER_COUNT_INVALID', message: '会话玩家必须是 4 人' };
  }
  const missingBind = players.find((p) => !p.pubgPlatform || !p.pubgPlayerId);
  if (missingBind) {
    return { ok: false, code: 'PUBG_BIND_REQUIRED', message: '存在玩家未绑定 PUBG' };
  }
  const platforms = [...new Set(players.map((p) => p.pubgPlatform))];
  if (platforms.length > 1) {
    return { ok: false, code: 'PLATFORM_MISMATCH', message: '4 位玩家 PUBG 平台不一致' };
  }

  const processed = await BeanLobbyModel.listProcessedMatchIds(sessionId);
  const recentByUser = new Map();
  for (const p of players) {
    const list = await fetchRecentSquadMatchesForPlayer(p, 20);
    recentByUser.set(p.userId, list);
  }
  const candidates = pickNewCommonMatchIds(recentByUser, {
    afterTime: session.started_at,
    excludeMatchIds: processed,
  });

  if (!candidates.length) {
    await BeanLobbyModel.touchSessionPoll(sessionId);
    return { ok: true, sessionId, newRounds: 0, message: '暂无新的四排共同对局' };
  }

  const settledRounds = [];
  for (const candidate of candidates) {
    const latestSession = await BeanLobbyModel.getSessionById(sessionId);
    const result = await settleSingleMatch(latestSession, players, candidate.matchId, { operatorUserId });
    if (!result.ok) {
      if (settledRounds.length) break;
      return result;
    }
    settledRounds.push(result);
  }

  return {
    ok: true,
    sessionId,
    newRounds: settledRounds.length,
    rounds: settledRounds,
    message: settledRounds.length ? `已同步 ${settledRounds.length} 局新对局` : '暂无新的四排共同对局',
  };
}

async function pollAllActiveSessions() {
  const sessionIds = await BeanLobbyModel.listActiveSessionIds();
  const results = [];
  for (const sessionId of sessionIds) {
    try {
      const result = await pollSession(sessionId);
      results.push({ sessionId, ...result });
    } catch (error) {
      console.error(`[bean-poll] session ${sessionId} failed:`, error?.message || error);
      results.push({ sessionId, ok: false, error: error?.message || 'poll failed' });
    }
  }
  return results;
}

function startBeanPollScheduler() {
  const enabled = String(process.env.BEAN_POLL_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) {
    console.log('[bean-poll] scheduler disabled');
    return null;
  }
  const intervalMs = Number(process.env.BEAN_POLL_INTERVAL_MS || 10 * 60 * 1000);
  const timer = setInterval(() => {
    pollAllActiveSessions().catch((error) => {
      console.error('[bean-poll] scheduler run failed:', error?.message || error);
    });
  }, intervalMs);
  console.log(`[bean-poll] scheduler started, interval=${intervalMs}ms`);
  return timer;
}

module.exports = {
  pollSession,
  pollAllActiveSessions,
  startBeanPollScheduler,
};
