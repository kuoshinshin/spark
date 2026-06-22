function toInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num);
}

function calcTail(damage) {
  const rounded = Math.round(Number(damage) || 0);
  const digit = Math.abs(rounded % 10);
  return digit === 0 ? 10 : digit;
}

function circularDiff(a, b) {
  const da = Number(a);
  const db = Number(b);
  const abs = Math.abs(da - db);
  return Math.min(abs, 10 - abs);
}

function pairByRemaining(players, pair) {
  const pairIds = new Set(pair.map((p) => p.userId));
  const other = players.filter((p) => !pairIds.has(p.userId));
  return [pair, other];
}

function randomizeTeams(players, seed = Date.now()) {
  const list = [...players];
  let x = Math.abs(Math.trunc(Number(seed) || 1)) || 1;
  for (let i = list.length - 1; i > 0; i -= 1) {
    x = (x * 1664525 + 1013904223) % 0x100000000;
    const j = x % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return [list.slice(0, 2), list.slice(2, 4)];
}

function groupPlayersByPriority(players, seed = Date.now()) {
  const list = Array.isArray(players) ? players : [];
  if (list.length !== 4) {
    return { ok: false, code: 'INVALID_PLAYER_COUNT', message: '豆子局必须是 4 人' };
  }

  const tailBuckets = new Map();
  for (const p of list) {
    const tail = Number(p.tail);
    if (!tailBuckets.has(tail)) tailBuckets.set(tail, []);
    tailBuckets.get(tail).push(p);
  }

  const bucketSizes = [...tailBuckets.values()].map((rows) => rows.length);
  if (bucketSizes.some((size) => size >= 3)) {
    const teams = randomizeTeams(list, seed);
    return {
      ok: true,
      strategy: 'random',
      needsRandom: true,
      teams,
    };
  }

  const exactPairs = [...tailBuckets.values()].filter((rows) => rows.length === 2);
  if (exactPairs.length === 2) {
    return { ok: true, strategy: 'same', needsRandom: false, teams: [exactPairs[0], exactPairs[1]] };
  }
  if (exactPairs.length === 1) {
    return { ok: true, strategy: 'same', needsRandom: false, teams: pairByRemaining(list, exactPairs[0]) };
  }

  let best = null;
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      const diff = circularDiff(a.tail, b.tail);
      const rank = [diff, Math.min(a.seatNo || 99, b.seatNo || 99), Math.max(a.seatNo || 99, b.seatNo || 99)];
      if (!best) {
        best = { pair: [a, b], rank };
      } else {
        const old = best.rank;
        if (
          rank[0] < old[0] ||
          (rank[0] === old[0] && rank[1] < old[1]) ||
          (rank[0] === old[0] && rank[1] === old[1] && rank[2] < old[2])
        ) {
          best = { pair: [a, b], rank };
        }
      }
    }
  }

  if (best) {
    return { ok: true, strategy: 'adjacent', needsRandom: false, teams: pairByRemaining(list, best.pair) };
  }

  const small = list.filter((p) => Number(p.tail) >= 1 && Number(p.tail) <= 5);
  const big = list.filter((p) => Number(p.tail) >= 6 && Number(p.tail) <= 10);
  if (small.length === 2 && big.length === 2) {
    return { ok: true, strategy: 'bigSmall', needsRandom: false, teams: [small, big] };
  }

  return {
    ok: true,
    strategy: 'random',
    needsRandom: true,
    teams: randomizeTeams(list, seed),
  };
}

function splitBeans(total, count) {
  const each = Math.trunc(total / count);
  const remainder = total % count;
  return { each, remainder };
}

function calcBeans(teamA, teamB) {
  const ta = Array.isArray(teamA) ? teamA : [];
  const tb = Array.isArray(teamB) ? teamB : [];
  const killsA = ta.reduce((sum, p) => sum + toInt(p.kills), 0);
  const killsB = tb.reduce((sum, p) => sum + toInt(p.kills), 0);
  const diff = Math.abs(killsA - killsB);

  if (diff === 0) {
    return {
      winner: null,
      killsA,
      killsB,
      beanBase: 0,
      beanTotal: 0,
      multiplied: false,
      playerBeans: new Map(),
    };
  }

  const winner = killsA > killsB ? 'A' : 'B';
  const winnerTeam = winner === 'A' ? ta : tb;
  const loserTeam = winner === 'A' ? tb : ta;
  const winnerChicken = winnerTeam.some((p) => Number(p.winPlace || 0) === 1);
  const beanTotal = diff * (winnerChicken ? 2 : 1);

  const playerBeans = new Map();
  const winnerSplit = splitBeans(beanTotal, winnerTeam.length);
  const loserSplit = splitBeans(beanTotal, loserTeam.length);

  winnerTeam.forEach((p, idx) => {
    const val = winnerSplit.each + (idx < winnerSplit.remainder ? 1 : 0);
    playerBeans.set(p.userId, val);
  });
  loserTeam.forEach((p, idx) => {
    const val = loserSplit.each + (idx < loserSplit.remainder ? 1 : 0);
    playerBeans.set(p.userId, -val);
  });

  return {
    winner,
    killsA,
    killsB,
    beanBase: diff,
    beanTotal,
    multiplied: winnerChicken,
    playerBeans,
  };
}

function buildSettlement(players, seed = Date.now()) {
  const normalized = (Array.isArray(players) ? players : []).map((p) => ({
    userId: Number(p.userId),
    seatNo: Number(p.seatNo || 0),
    displayName: p.displayName || '',
    damage: Number(p.damage || 0),
    kills: toInt(p.kills || 0),
    winPlace: toInt(p.winPlace || 0),
    tail: calcTail(p.damage || 0),
  }));

  const grouped = groupPlayersByPriority(normalized, seed);
  if (!grouped.ok) return grouped;

  const [teamA, teamB] = grouped.teams;
  const beanResult = calcBeans(teamA, teamB);

  return {
    ok: true,
    strategy: grouped.strategy,
    needsRandom: grouped.needsRandom,
    teamA: teamA.map((p) => ({ ...p })),
    teamB: teamB.map((p) => ({ ...p })),
    beanResult,
    players: normalized.map((p) => ({
      ...p,
      teamNo: teamA.some((a) => a.userId === p.userId) ? 1 : 2,
      netBeans: beanResult.playerBeans.get(p.userId) || 0,
    })),
  };
}

module.exports = {
  calcTail,
  groupPlayersByPriority,
  calcBeans,
  buildSettlement,
};
