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
  const normalBreakdown = buildModeBreakdown(gameModeStats, 'normal');

  const currentSeason = Array.isArray(seasons)
    ? seasons.find((item) => item?.isCurrentSeason)
    : null;
  let rankedOverview = { roundsPlayed: 0, wins: 0, kills: 0, kdRatio: 0, winRate: 0 };
  let rankedGameModeStats = {};
  let rankedDetails = null;
  if (currentSeason?.id) {
    try {
      const rankedData = await getPlayerRankedSeason(platform, playerId, currentSeason.id);
      rankedGameModeStats = rankedData?.attributes?.rankedGameModeStats || {};
      rankedOverview = aggregateOverview(Object.entries(rankedGameModeStats));
      rankedDetails = extractSquadRankedDetails(rankedGameModeStats);
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
    rankedOverview,
    modeBreakdown: {
      normal: normalBreakdown,
      ranked: buildModeBreakdown(rankedGameModeStats, 'ranked'),
    },
    rankedDetails,
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

const POWER_SCORE_V2 = {
  KD_CAP: 4,
  DAMAGE_CAP: 450,
  KD_WEIGHT: 0.7,
  DAMAGE_WEIGHT: 0.3,
  CONFIDENCE_ROUNDS: 25,
  PRIOR_SCORE: 350,
};

function isSquadRankedModeKey(key) {
  const mode = String(key || '').toLowerCase();
  return mode === 'squad' || mode === 'squad-fpp';
}

function formatTier(tier) {
  if (!tier) return null;
  const t = tier.tier || '';
  const s = tier.subTier || '';
  return { tier: t, subTier: s, label: [t, s].filter(Boolean).join(' ') };
}

function formatWeaponName(key) {
  return String(key || '')
    .replace(/^Item_Weapon_/, '')
    .replace(/_C$/, '');
}

function summarizeModeStats(stats, kind = 'normal') {
  if (!stats) return null;
  const roundsPlayed = Number(stats.roundsPlayed || 0);
  const wins = Number(stats.wins || 0);
  const kills = Number(stats.kills || 0);
  const deaths = Number(stats.deaths || 0);
  const losses = Number(stats.losses || 0);
  const assists = Number(stats.assists || 0);
  const damageDealt = Number(stats.damageDealt || 0);
  const top10s = Number(stats.top10s || 0);
  const dBNOs = Number(stats.dBNOs || 0);

  let kd;
  if (kind === 'ranked') {
    kd = deaths > 0 ? Number((kills / deaths).toFixed(2)) : Number(kills.toFixed(2));
  } else {
    const normalizedLosses = losses > 0 ? losses : Math.max(roundsPlayed - wins, 0);
    kd = normalizedLosses > 0
      ? Number((kills / normalizedLosses).toFixed(2))
      : Number(kills.toFixed(2));
  }

  const winRate = roundsPlayed > 0 ? Number(((wins / roundsPlayed) * 100).toFixed(2)) : 0;
  const top10Ratio = stats.top10Ratio != null
    ? Number(Number(stats.top10Ratio).toFixed(4))
    : (roundsPlayed > 0 ? Number((top10s / roundsPlayed).toFixed(4)) : 0);
  const winRatio = stats.winRatio != null
    ? Number(Number(stats.winRatio).toFixed(4))
    : (roundsPlayed > 0 ? Number((wins / roundsPlayed).toFixed(4)) : 0);
  const avgRank = Number(Number(stats.avgRank || 0).toFixed(1));
  const avgDamage = roundsPlayed > 0 ? Number((damageDealt / roundsPlayed).toFixed(1)) : 0;
  const kda = deaths > 0
    ? Number(((kills + assists) / deaths).toFixed(2))
    : Number((kills + assists).toFixed(2));

  const result = {
    roundsPlayed,
    wins,
    kills,
    deaths,
    assists,
    dBNOs,
    damageDealt,
    kd,
    winRate,
    top10Ratio,
    winRatio,
    avgRank,
    avgDamage,
  };

  if (kind === 'ranked') {
    result.kda = kda;
    if (stats.currentRankPoint != null) result.currentRankPoint = Number(stats.currentRankPoint);
    if (stats.bestRankPoint != null) result.bestRankPoint = Number(stats.bestRankPoint);
    if (stats.currentTier) result.currentTier = formatTier(stats.currentTier);
    if (stats.bestTier) result.bestTier = formatTier(stats.bestTier);
  }

  return result;
}

function buildModeBreakdown(gameModeStats, kind = 'normal') {
  const stats = gameModeStats || {};
  const groups = {
    solo: ['solo', 'solo-fpp'],
    duo: ['duo', 'duo-fpp'],
    squad: ['squad', 'squad-fpp'],
  };

  const mergeEntries = (keys) => {
    const entries = keys.map((key) => stats[key]).filter(Boolean);
    if (!entries.length) return null;

    const merged = {
      roundsPlayed: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      losses: 0,
      assists: 0,
      damageDealt: 0,
      top10s: 0,
      dBNOs: 0,
      rankWeightedSum: 0,
      top10RatioSum: 0,
      winRatioSum: 0,
      ratioWeight: 0,
      currentRankPoint: null,
      bestRankPoint: null,
      currentTier: null,
      bestTier: null,
    };

    entries.forEach((s) => {
      const rounds = Number(s.roundsPlayed || 0);
      merged.roundsPlayed += rounds;
      merged.wins += Number(s.wins || 0);
      merged.kills += Number(s.kills || 0);
      merged.deaths += Number(s.deaths || 0);
      merged.losses += Number(s.losses || 0);
      merged.assists += Number(s.assists || 0);
      merged.damageDealt += Number(s.damageDealt || 0);
      merged.top10s += Number(s.top10s || 0);
      merged.dBNOs += Number(s.dBNOs || 0);
      if (rounds > 0) {
        merged.rankWeightedSum += Number(s.avgRank || 0) * rounds;
        const entryTop10 = s.top10Ratio != null ? Number(s.top10Ratio) : (Number(s.top10s || 0) / rounds);
        const entryWin = s.winRatio != null ? Number(s.winRatio) : (Number(s.wins || 0) / rounds);
        merged.top10RatioSum += entryTop10 * rounds;
        merged.winRatioSum += entryWin * rounds;
        merged.ratioWeight += rounds;
      }
      if (kind === 'ranked') {
        const brp = Number(s.bestRankPoint || 0);
        if (merged.bestRankPoint == null || brp > merged.bestRankPoint) {
          merged.bestRankPoint = brp;
          if (s.bestTier) merged.bestTier = s.bestTier;
        }
        const crp = Number(s.currentRankPoint || 0);
        if (merged.currentRankPoint == null || crp >= merged.currentRankPoint) {
          merged.currentRankPoint = crp;
          if (s.currentTier) merged.currentTier = s.currentTier;
        }
      }
    });

    const synthesized = {
      roundsPlayed: merged.roundsPlayed,
      wins: merged.wins,
      kills: merged.kills,
      deaths: merged.deaths,
      losses: merged.losses,
      assists: merged.assists,
      damageDealt: merged.damageDealt,
      top10s: merged.top10s,
      dBNOs: merged.dBNOs,
      avgRank: merged.roundsPlayed > 0 ? merged.rankWeightedSum / merged.roundsPlayed : 0,
      top10Ratio: merged.ratioWeight > 0 ? merged.top10RatioSum / merged.ratioWeight : 0,
      winRatio: merged.ratioWeight > 0 ? merged.winRatioSum / merged.ratioWeight : 0,
    };
    if (kind === 'ranked') {
      synthesized.currentRankPoint = merged.currentRankPoint;
      synthesized.bestRankPoint = merged.bestRankPoint;
      synthesized.currentTier = merged.currentTier;
      synthesized.bestTier = merged.bestTier;
    }
    return summarizeModeStats(synthesized, kind);
  };

  return {
    solo: mergeEntries(groups.solo),
    duo: mergeEntries(groups.duo),
    squad: mergeEntries(groups.squad),
    all: mergeEntries([...groups.solo, ...groups.duo, ...groups.squad]),
  };
}

function extractSquadRankedDetails(rankedGameModeStats = {}) {
  const entries = Object.entries(rankedGameModeStats || {}).filter(
    ([key, stats]) => isSquadRankedModeKey(key) && stats
  );
  if (!entries.length) return null;

  let roundsPlayed = 0;
  let kills = 0;
  let deaths = 0;
  let damageDealt = 0;
  let rankWeightedSum = 0;
  let assists = 0;
  let dBNOs = 0;
  let wins = 0;
  let top10s = 0;
  let bestRankPoint = 0;
  let bestTier = null;
  let currentRankPoint = -1;
  let currentTier = null;

  entries.forEach(([, stats]) => {
    const rounds = Number(stats?.roundsPlayed || 0);
    if (rounds > 0) {
      roundsPlayed += rounds;
      kills += Number(stats?.kills || 0);
      deaths += Number(stats?.deaths || 0);
      damageDealt += Number(stats?.damageDealt || 0);
      rankWeightedSum += Number(stats?.avgRank || 0) * rounds;
      assists += Number(stats?.assists || 0);
      dBNOs += Number(stats?.dBNOs || 0);
      wins += Number(stats?.wins || 0);
      top10s += Number(stats?.top10s || 0);
    }

    const brp = Number(stats?.bestRankPoint || 0);
    if (brp >= bestRankPoint) {
      bestRankPoint = brp;
      if (stats?.bestTier) bestTier = stats.bestTier;
    }
    const crp = Number(stats?.currentRankPoint || 0);
    if (crp >= currentRankPoint) {
      currentRankPoint = crp;
      if (stats?.currentTier) currentTier = stats.currentTier;
    }
  });

  if (roundsPlayed <= 0 && currentRankPoint < 0 && bestRankPoint <= 0) return null;

  const kd = deaths > 0 ? kills / deaths : kills;
  const kda = deaths > 0 ? (kills + assists) / deaths : (kills + assists);
  const avgDamage = roundsPlayed > 0 ? damageDealt / roundsPlayed : 0;
  const avgRank = roundsPlayed > 0 ? rankWeightedSum / roundsPlayed : 0;
  const top10Ratio = roundsPlayed > 0 ? top10s / roundsPlayed : 0;
  const winRatio = roundsPlayed > 0 ? wins / roundsPlayed : 0;

  return {
    roundsPlayed,
    kd: Number(kd.toFixed(2)),
    avgDamage: Number(avgDamage.toFixed(1)),
    avgRank: Number(avgRank.toFixed(1)),
    kills,
    deaths,
    assists,
    dBNOs,
    wins,
    damageDealt,
    currentTier: formatTier(currentTier),
    bestTier: formatTier(bestTier),
    currentRankPoint: currentRankPoint >= 0 ? currentRankPoint : 0,
    bestRankPoint,
    kda: Number(kda.toFixed(2)),
    top10Ratio: Number(top10Ratio.toFixed(4)),
    winRatio: Number(winRatio.toFixed(4)),
  };
}

function calculatePowerLevel(score) {
  if (score >= 720) return '魔王S';
  if (score >= 620) return 'S';
  if (score >= 520) return 'A';
  if (score >= 430) return 'B';
  if (score >= 350) return 'C';
  if (score >= 280) return 'D';
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
    formulaVersion: 'v2',
    baseScore: 0,
    confidence: 0,
    sampleLimited: false,
    factors: {
      kdFactor: 0,
      damageFactor: 0,
    },
  };
}

/** 合并当前赛季四排排位（squad / squad-fpp）官方聚合统计 */
function aggregateSquadRankedSeasonStats(rankedGameModeStats = {}) {
  const entries = Object.entries(rankedGameModeStats).filter(
    ([key, stats]) => isSquadRankedModeKey(key) && stats
  );
  if (!entries.length) return null;

  let roundsPlayed = 0;
  let kills = 0;
  let deaths = 0;
  let damageDealt = 0;
  let rankWeightedSum = 0;

  entries.forEach(([, stats]) => {
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
    avgRank: rankWeightedSum / roundsPlayed,
  };
}

function computePowerScoreV2(aggregated) {
  const { roundsPlayed, kd, avgDamage } = aggregated;
  const kdFactor = Math.min(kd, POWER_SCORE_V2.KD_CAP) / POWER_SCORE_V2.KD_CAP;
  const damageFactor = Math.min(avgDamage, POWER_SCORE_V2.DAMAGE_CAP) / POWER_SCORE_V2.DAMAGE_CAP;
  const baseScore = (kdFactor * POWER_SCORE_V2.KD_WEIGHT + damageFactor * POWER_SCORE_V2.DAMAGE_WEIGHT) * 1000;
  const confidence = Math.min(1, Math.sqrt(roundsPlayed / POWER_SCORE_V2.CONFIDENCE_ROUNDS));
  const score = Math.round(baseScore * confidence + POWER_SCORE_V2.PRIOR_SCORE * (1 - confidence));

  return {
    score,
    baseScore: Math.round(baseScore),
    confidence: Number(confidence.toFixed(4)),
    sampleLimited: roundsPlayed < POWER_SCORE_V2.CONFIDENCE_ROUNDS,
    kdFactor: Number(kdFactor.toFixed(4)),
    damageFactor: Number(damageFactor.toFixed(4)),
  };
}

/** @deprecated 仅 lifetime 总览等场景保留；战力值请用 aggregateSquadRankedSeasonStats */
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

async function getCompetitivePowerScore(platform, playerId, seasonId = '') {
  let seasons = [];
  try {
    seasons = await getSeasons(platform);
  } catch (_) {
    return buildEmptyPowerScore(seasonId || '');
  }

  const currentSeason = seasons.find((item) => item?.isCurrentSeason);
  const resolvedSeasonId = String(seasonId || '').trim() || currentSeason?.id || '';
  if (!resolvedSeasonId) return buildEmptyPowerScore();

  let rankedData = null;
  try {
    rankedData = await getPlayerRankedSeason(platform, playerId, resolvedSeasonId);
  } catch (error) {
    if (Number(error?.statusCode || 0) === 404) return buildEmptyPowerScore(resolvedSeasonId);
    throw error;
  }

  const rankedGameModeStats = rankedData?.attributes?.rankedGameModeStats || {};
  const rankedDetails = extractSquadRankedDetails(rankedGameModeStats);
  const aggregated = aggregateSquadRankedSeasonStats(rankedGameModeStats);
  if (!aggregated) {
    const empty = buildEmptyPowerScore(resolvedSeasonId);
    return {
      ...empty,
      rankedDetails,
      currentTier: rankedDetails?.currentTier || null,
      bestTier: rankedDetails?.bestTier || null,
      currentRankPoint: rankedDetails?.currentRankPoint ?? null,
      bestRankPoint: rankedDetails?.bestRankPoint ?? null,
      kda: rankedDetails?.kda ?? null,
      top10Ratio: rankedDetails?.top10Ratio ?? null,
      winRatio: rankedDetails?.winRatio ?? null,
      assists: rankedDetails?.assists ?? 0,
      dBNOs: rankedDetails?.dBNOs ?? 0,
    };
  }

  const computed = computePowerScoreV2(aggregated);

  return {
    score: computed.score,
    level: calculatePowerLevel(computed.score),
    kd: Number(aggregated.kd.toFixed(2)),
    avgDamage: Number(aggregated.avgDamage.toFixed(1)),
    avgRank: Number(aggregated.avgRank.toFixed(1)),
    matchesAnalyzed: aggregated.roundsPlayed,
    seasonId: resolvedSeasonId,
    formulaVersion: 'v2',
    baseScore: computed.baseScore,
    confidence: computed.confidence,
    sampleLimited: computed.sampleLimited,
    factors: {
      kdFactor: computed.kdFactor,
      damageFactor: computed.damageFactor,
    },
    rankedDetails,
    currentTier: rankedDetails?.currentTier || null,
    bestTier: rankedDetails?.bestTier || null,
    currentRankPoint: rankedDetails?.currentRankPoint ?? null,
    bestRankPoint: rankedDetails?.bestRankPoint ?? null,
    kda: rankedDetails?.kda ?? null,
    top10Ratio: rankedDetails?.top10Ratio ?? null,
    winRatio: rankedDetails?.winRatio ?? null,
    assists: rankedDetails?.assists ?? 0,
    dBNOs: rankedDetails?.dBNOs ?? 0,
  };
}

async function getWeaponMastery(platform, playerId) {
  try {
    const data = await requestPubg(`/${platform}/players/${playerId}/weapon_mastery`);
    const summaries = data?.data?.attributes?.weaponSummaries || {};
    const weapons = Object.entries(summaries).map(([id, summary]) => {
      const official = summary?.OfficialStatsTotal || {};
      const legacy = summary?.StatsTotal || {};
      const level = Number(official.LevelCurrent ?? summary?.LevelCurrent ?? 0);
      const xp = Number(
        official.XPTotal
        ?? official.LevelXPTotal
        ?? summary?.XPTotal
        ?? 0
      );
      const kills = Number(official.Kills ?? legacy.Kills ?? 0);
      const damage = Number(official.DamagePlayer ?? legacy.DamagePlayer ?? 0);
      const headshots = Number(official.HeadShots ?? legacy.HeadShots ?? 0);
      const hasOfficial = official.LevelCurrent != null || official.Kills != null;
      return {
        id,
        name: formatWeaponName(id),
        level,
        xp,
        kills,
        damage,
        headshots,
        statsType: hasOfficial ? 'official' : 'legacy',
      };
    });

    weapons.sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      return b.kills - a.kills;
    });

    return {
      weapons: weapons.slice(0, 8),
      total: weapons.length,
    };
  } catch (error) {
    if (Number(error?.statusCode || 0) === 404) {
      return { weapons: [], total: 0 };
    }
    throw error;
  }
}

async function getSurvivalMastery(platform, playerId) {
  try {
    const data = await requestPubg(`/${platform}/players/${playerId}/survival_mastery`);
    const attrs = data?.data?.attributes || {};
    return {
      level: Number(attrs.level ?? attrs.Level ?? 0),
      tier: attrs.tier ?? attrs.Tier ?? null,
      xp: Number(attrs.xp ?? attrs.XP ?? 0),
      totalMatchesPlayed: Number(attrs.totalMatchesPlayed ?? 0),
      totalAirDropsLooted: Number(attrs.totalAirDropsLooted ?? 0),
      totalDamageDealt: Number(attrs.totalDamageDealt ?? 0),
      totalHeals: Number(attrs.totalHeals ?? 0),
      totalKills: Number(attrs.totalKills ?? 0),
      totalDistanceTraveled: Number(attrs.totalDistanceTraveled ?? 0),
    };
  } catch (error) {
    if (Number(error?.statusCode || 0) === 404) return null;
    throw error;
  }
}

async function getPlayerClan(platform, playerId) {
  try {
    const player = await getPlayerWithRelationships(platform, playerId);
    if (!player) return null;
    const clanId = player.attributes?.clanId
      || player.relationships?.clan?.data?.id
      || null;
    if (!clanId) return null;

    const data = await requestPubg(`/${platform}/clans/${clanId}`);
    const clan = data?.data || {};
    const attrs = clan.attributes || {};
    return {
      id: clan.id || clanId,
      name: attrs.clanName || attrs.name || '',
      tag: attrs.clanTag || attrs.tag || '',
      clanName: attrs.clanName || attrs.name || '',
      clanTag: attrs.clanTag || attrs.tag || '',
      level: Number(attrs.clanLevel ?? attrs.level ?? 0),
      memberCount: Number(attrs.memberCount ?? 0),
    };
  } catch (error) {
    if (Number(error?.statusCode || 0) === 404) return null;
    throw error;
  }
}

module.exports = {
  getPlayerByName,
  getLifetimeStats,
  getRecentMatches,
  getMatchesBySeason,
  getCompetitivePowerScore,
  getWeaponMastery,
  getSurvivalMastery,
  getPlayerClan,
  getMatchById,
  getSeasons,
  getPlayerSeason,
  getPlayerWithRelationships,
  parsePlayerStatsFromMatch,
  parseMatchDetailWithTeam,
  matchGameMode,
  formatTier,
  summarizeModeStats,
  buildModeBreakdown,
  extractSquadRankedDetails,
};
