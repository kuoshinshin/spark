const PUBG_API_BASE = 'https://api.pubg.com/shards';

function getHeaders() {
  const apiKey = process.env.PUBG_API_KEY;
  if (!apiKey) {
    const error = new Error('缺少 PUBG_API_KEY 环境变量');
    error.code = 'PUBG_API_KEY_MISSING';
    error.statusCode = 500;
    throw error;
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/vnd.api+json'
  };
}

async function requestPubg(pathname) {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.PUBG_REQUEST_TIMEOUT_MS || 20000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${PUBG_API_BASE}${pathname}`, {
      method: 'GET',
      headers: getHeaders(),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('PUBG API 请求超时');
      timeoutError.code = 'PUBG_API_TIMEOUT';
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const contentType = response.headers.get('content-type') || '';
  const mayBeJson = contentType.includes('json');
  let data = null;

  if (mayBeJson) {
    data = await response.json();
  } else {
    const text = await response.text();
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = text;
    }
  }

  if (!response.ok) {
    const message = typeof data === 'object' && data !== null
      ? data.errors?.[0]?.detail || data.errors?.[0]?.title
      : data;
    const error = new Error(message || 'PUBG API 请求失败');
    error.code = 'PUBG_API_ERROR';
    error.statusCode = response.status;
    throw error;
  }

  return data;
}

async function mapWithConcurrency(items, worker, concurrency = 4) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const size = Math.max(1, Number(concurrency || 1));
  const results = new Array(list.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < list.length) {
      const current = nextIndex++;
      try {
        results[current] = await worker(list[current], current);
      } catch (error) {
        results[current] = null;
      }
    }
  };

  const workers = Array.from({ length: Math.min(size, list.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

async function getPlayerByName(platform, playerName) {
  const encodedName = encodeURIComponent(playerName);
  const data = await requestPubg(`/${platform}/players?filter[playerNames]=${encodedName}`);
  const player = data?.data?.[0];
  if (!player) {
    throw new Error('未查询到该 PUBG 玩家，请确认平台与昵称');
  }
  return {
    id: player.id,
    name: player.attributes?.name || playerName
  };
}

async function getLifetimeStats(platform, playerId) {
  const [lifetimeData, seasons] = await Promise.all([
    requestPubg(`/${platform}/players/${playerId}/seasons/lifetime`),
    getSeasons(platform).catch(() => [])
  ]);
  const gameModeStats = lifetimeData?.data?.attributes?.gameModeStats || {};
  const modeEntries = Object.entries(gameModeStats);

  const aggregateOverview = (entries = []) => {
    const roundsPlayed = entries.reduce((sum, [, stats]) => sum + Number(stats?.roundsPlayed || 0), 0);
    const wins = entries.reduce((sum, [, stats]) => sum + Number(stats?.wins || 0), 0);
    const kills = entries.reduce((sum, [, stats]) => sum + Number(stats?.kills || 0), 0);
    const losses = entries.reduce((sum, [, stats]) => sum + Number(stats?.losses || 0), 0);
    const normalizedLosses = losses > 0 ? losses : Math.max(roundsPlayed - wins, 0);
    const kdRatio = normalizedLosses > 0
      ? Number((kills / normalizedLosses).toFixed(2))
      : Number(kills.toFixed(2));
    const winRate = roundsPlayed > 0 ? Number(((wins / roundsPlayed) * 100).toFixed(2)) : 0;

    return { roundsPlayed, wins, kills, kdRatio, winRate };
  };

  const normalOverview = aggregateOverview(modeEntries);

  const currentSeason = Array.isArray(seasons)
    ? seasons.find((item) => item?.isCurrentSeason)
    : null;
  let rankedOverview = { roundsPlayed: 0, wins: 0, kills: 0, kdRatio: 0, winRate: 0 };
  if (currentSeason?.id) {
    try {
      const rankedData = await getPlayerRankedSeason(platform, playerId, currentSeason.id);
      const rankedGameModeStats = rankedData?.attributes?.rankedGameModeStats || {};
      rankedOverview = aggregateOverview(Object.entries(rankedGameModeStats));
    } catch (error) {
      if (Number(error?.statusCode || 0) !== 404) throw error;
    }
  }

  return {
    // 兼容旧前端字段：默认返回匹配总览
    roundsPlayed: normalOverview.roundsPlayed,
    wins: normalOverview.wins,
    kills: normalOverview.kills,
    kdRatio: normalOverview.kdRatio,
    winRate: normalOverview.winRate,
    normalOverview,
    rankedOverview
  };
}

async function getPlayerWithRelationships(platform, playerId) {
  const data = await requestPubg(`/${platform}/players/${playerId}`);
  return data?.data || null;
}

async function getMatchById(platform, matchId) {
  const data = await requestPubg(`/${platform}/matches/${matchId}`);
  return data;
}

async function getSeasons(platform) {
  const data = await requestPubg(`/${platform}/seasons`);
  const seasons = Array.isArray(data?.data) ? data.data : [];
  const shardToSeasonPrefixMap = {
    steam: 'pc',
    kakao: 'pc',
    tournament: 'pc',
    psn: 'playstation',
    xbox: 'xbox',
    stadia: 'console'
  };
  const expectedPrefix = shardToSeasonPrefixMap[String(platform || '').toLowerCase()] || '';

  return seasons
    .map((item) => ({
    id: item?.id || '',
    isCurrentSeason: Boolean(item?.attributes?.isCurrentSeason),
    isOffseason: Boolean(item?.attributes?.isOffseason)
    }))
    .filter((item) => {
      if (!item.id || !expectedPrefix) return true;
      const id = String(item.id).toLowerCase();
      if (id === 'lifetime') return true;
      return id.includes(`.${expectedPrefix}-`) || id.startsWith(`${expectedPrefix}-`);
    });
}

async function getPlayerSeason(platform, playerId, seasonId) {
  const data = await requestPubg(`/${platform}/players/${playerId}/seasons/${seasonId}`);
  return data?.data || null;
}

async function getPlayerRankedSeason(platform, playerId, seasonId) {
  const data = await requestPubg(`/${platform}/players/${playerId}/seasons/${seasonId}/ranked`);
  return data?.data || null;
}

function parsePlayerStatsFromMatch(matchData, playerId) {
  const included = Array.isArray(matchData?.included) ? matchData.included : [];
  const participant = included.find((item) => {
    if (item?.type !== 'participant') return false;
    const statsPlayerId = item?.attributes?.stats?.playerId;
    return String(statsPlayerId || '') === String(playerId);
  });
  if (!participant) return null;

  const stats = participant.attributes?.stats || {};
  return {
    matchId: matchData?.data?.id,
    gameMode: matchData?.data?.attributes?.gameMode || '',
    seasonState: matchData?.data?.attributes?.seasonState || '',
    matchType: matchData?.data?.attributes?.matchType || '',
    isCustomMatch: Boolean(matchData?.data?.attributes?.isCustomMatch),
    mapName: matchData?.data?.attributes?.mapName || '',
    createdAt: matchData?.data?.attributes?.createdAt || '',
    duration: Number(matchData?.data?.attributes?.duration || 0),
    rank: Number(stats.winPlace || 0),
    kills: Number(stats.kills || 0),
    assists: Number(stats.assists || 0),
    damageDealt: Number(stats.damageDealt || 0),
    timeSurvived: Number(stats.timeSurvived || 0),
    win: Number(stats.winPlace || 0) === 1
  };
}

function parseMatchDetailWithTeam(matchData, playerId) {
  const included = Array.isArray(matchData?.included) ? matchData.included : [];
  const participants = included.filter((item) => item?.type === 'participant');
  const rosters = included.filter((item) => item?.type === 'roster');
  const participantById = new Map(participants.map((item) => [item.id, item]));

  const selfParticipant = participants.find((item) => {
    const statsPlayerId = item?.attributes?.stats?.playerId;
    return String(statsPlayerId || '') === String(playerId);
  });
  if (!selfParticipant) return null;

  const base = parsePlayerStatsFromMatch(matchData, playerId);
  if (!base) return null;

  const selfParticipantId = selfParticipant.id;
  const selfRoster = rosters.find((roster) => {
    const refs = roster?.relationships?.participants?.data || [];
    return refs.some((ref) => ref?.id === selfParticipantId);
  });

  const teamMembers = (selfRoster?.relationships?.participants?.data || [])
    .map((ref) => participantById.get(ref.id))
    .filter(Boolean)
    .map((item) => {
      const stats = item?.attributes?.stats || {};
      return {
        name: stats.name || '未知玩家',
        playerId: stats.playerId || '',
        kills: Number(stats.kills || 0),
        assists: Number(stats.assists || 0),
        damageDealt: Number(stats.damageDealt || 0),
        rank: Number(stats.winPlace || 0),
        timeSurvived: Number(stats.timeSurvived || 0),
        isSelf: String(stats.playerId || '') === String(playerId)
      };
    });

  return {
    ...base,
    teamSize: teamMembers.length,
    teamMembers
  };
}

function normalizeMode(value) {
  return String(value || '').trim().toLowerCase();
}

function matchGameMode(modeValue, targetMode) {
  const gm = normalizeMode(modeValue);
  if (!gm) return false;
  if (targetMode === 'solo') return gm === 'solo' || gm.startsWith('solo-');
  if (targetMode === 'duo') return gm === 'duo' || gm.startsWith('duo-');
  if (targetMode === 'squad') return gm === 'squad' || gm.startsWith('squad-');
  return true;
}

async function getRecentMatches(platform, playerId, page = 1, pageSize = 10, mode = '') {
  const player = await getPlayerWithRelationships(platform, playerId);
  const matchRefs = player?.relationships?.matches?.data || [];

  const parsedList = await mapWithConcurrency(matchRefs, async (ref) => {
    const matchData = await getMatchById(platform, ref.id);
    return parsePlayerStatsFromMatch(matchData, playerId);
  }, 4);
  let list = parsedList.filter(Boolean);

  const normalizedMode = normalizeMode(mode);
  if (['solo', 'duo', 'squad'].includes(normalizedMode)) {
    list = list.filter((item) => matchGameMode(item?.gameMode, normalizedMode));
  }

  const total = list.length;
  const start = Math.max(0, (page - 1) * pageSize);
  const end = Math.min(total, start + pageSize);
  list = list.slice(start, end);

  return {
    total,
    page,
    pageSize,
    list
  };
}

function collectSeasonMatchIds(playerSeason, mode = '') {
  const rel = playerSeason?.relationships || {};
  const pickIds = (key) => (rel?.[key]?.data || []).map((item) => item.id);
  const normalizedMode = String(mode || '').toLowerCase();

  if (normalizedMode === 'solo') {
    return [...pickIds('matchesSolo'), ...pickIds('matchesSoloFPP')];
  }
  if (normalizedMode === 'duo') {
    return [...pickIds('matchesDuo'), ...pickIds('matchesDuoFPP')];
  }
  if (normalizedMode === 'squad') {
    return [...pickIds('matchesSquad'), ...pickIds('matchesSquadFPP')];
  }

  return [
    ...pickIds('matchesSolo'),
    ...pickIds('matchesSoloFPP'),
    ...pickIds('matchesDuo'),
    ...pickIds('matchesDuoFPP'),
    ...pickIds('matchesSquad'),
    ...pickIds('matchesSquadFPP')
  ];
}

async function getMatchesBySeason(platform, playerId, seasonId, mode = '', page = 1, pageSize = 10) {
  const playerSeason = await getPlayerSeason(platform, playerId, seasonId);
  const matchIds = collectSeasonMatchIds(playerSeason, mode);
  const uniqueMatchIds = [...new Set(matchIds)];
  const start = Math.max(0, (page - 1) * pageSize);
  const end = Math.min(uniqueMatchIds.length, start + pageSize);
  const selected = uniqueMatchIds.slice(start, end);

  const parsedList = await mapWithConcurrency(selected, async (matchId) => {
    const matchData = await getMatchById(platform, matchId);
    return parsePlayerStatsFromMatch(matchData, playerId);
  }, 4);
  const list = parsedList.filter(Boolean);

  return {
    total: uniqueMatchIds.length,
    page,
    pageSize,
    list
  };
}

function calculatePowerLevel(score) {
  if (score >= 920) return '魔王S';
  if (score >= 780) return 'S';
  if (score >= 620) return 'A';
  if (score >= 520) return 'B';
  if (score >= 430) return 'C';
  if (score >= 350) return 'D';
  return 'E';
}

function buildEmptyPowerScore(seasonId = '') {
  return {
    score: 0,
    level: '暂无评级',
    kd: 0,
    avgDamage: 0,
    avgRank: 0,
    matchesAnalyzed: 0,
    seasonId,
    factors: {
      kdFactor: 0,
      damageFactor: 0
    }
  };
}

/** 合并当前赛季各排位模式（solo/duo/squad 及 FPP）的官方聚合统计 */
function aggregateRankedSeasonStats(rankedGameModeStats = {}) {
  const entries = Object.values(rankedGameModeStats).filter(Boolean);
  if (!entries.length) return null;

  let roundsPlayed = 0;
  let kills = 0;
  let deaths = 0;
  let damageDealt = 0;
  let rankWeightedSum = 0;

  entries.forEach((stats) => {
    const rounds = Number(stats?.roundsPlayed || 0);
    if (rounds <= 0) return;
    roundsPlayed += rounds;
    kills += Number(stats?.kills || 0);
    deaths += Number(stats?.deaths || 0);
    damageDealt += Number(stats?.damageDealt || 0);
    rankWeightedSum += Number(stats?.avgRank || 0) * rounds;
  });

  if (roundsPlayed <= 0) return null;

  const kd = deaths > 0 ? kills / deaths : kills;
  return {
    roundsPlayed,
    kd,
    avgDamage: damageDealt / roundsPlayed,
    avgRank: rankWeightedSum / roundsPlayed
  };
}

async function getCompetitivePowerScore(platform, playerId) {
  let seasons = [];
  try {
    seasons = await getSeasons(platform);
  } catch (_) {
    return buildEmptyPowerScore();
  }

  const currentSeason = seasons.find((item) => item?.isCurrentSeason);
  const seasonId = currentSeason?.id || '';
  if (!seasonId) return buildEmptyPowerScore();

  let rankedData = null;
  try {
    rankedData = await getPlayerRankedSeason(platform, playerId, seasonId);
  } catch (error) {
    if (Number(error?.statusCode || 0) === 404) return buildEmptyPowerScore(seasonId);
    throw error;
  }

  const aggregated = aggregateRankedSeasonStats(rankedData?.attributes?.rankedGameModeStats || {});
  if (!aggregated) return buildEmptyPowerScore(seasonId);

  const kdFactor = Math.min(aggregated.kd, 5) / 5;
  const damageFactor = Math.min(aggregated.avgDamage, 600) / 600;
  const score = Math.round((kdFactor * 0.85 + damageFactor * 0.15) * 1000);

  return {
    score,
    level: calculatePowerLevel(score),
    kd: Number(aggregated.kd.toFixed(2)),
    avgDamage: Number(aggregated.avgDamage.toFixed(1)),
    avgRank: Number(aggregated.avgRank.toFixed(1)),
    matchesAnalyzed: aggregated.roundsPlayed,
    seasonId,
    factors: {
      kdFactor: Number(kdFactor.toFixed(4)),
      damageFactor: Number(damageFactor.toFixed(4))
    }
  };
}

module.exports = {
  getPlayerByName,
  getLifetimeStats,
  getRecentMatches,
  getMatchesBySeason,
  getCompetitivePowerScore,
  getMatchById,
  getSeasons,
  getPlayerSeason,
  getPlayerWithRelationships,
  parsePlayerStatsFromMatch,
  parseMatchDetailWithTeam,
  matchGameMode,
};
