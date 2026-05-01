require('dotenv').config();
const { guardNotProduction } = require('./_guardNotProduction');
guardNotProduction('seed_match_flow');
const pool = require('../config/db');
const { calculateTeamScore } = require('../services/pgsScoring');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function toInt(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return n;
}

function validStage(stage) {
  return ['registration', 'frozen', 'live', 'completed'].includes(stage);
}

function shuffle(arr) {
  const clone = [...arr];
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
}

async function ensureMatchBase(conn, matchId, title) {
  if (matchId) {
    const [rows] = await conn.execute('SELECT * FROM matches WHERE id = ? LIMIT 1', [matchId]);
    if (!rows.length) {
      throw new Error(`match_id=${matchId} 不存在`);
    }
    return rows[0];
  }

  const now = new Date();
  const start = new Date(now.getTime() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const [result] = await conn.execute(
    `INSERT INTO matches
     (title, description, start_time, end_time, location, status, phase, registration_open_at, is_active_registration)
     VALUES (?, ?, ?, ?, ?, 'upcoming', 'registration', NOW(), 1)`,
    [
      title || `测试赛-${now.toISOString().slice(0, 19).replace('T', ' ')}`,
      '脚本自动创建的测试比赛',
      start,
      end,
      '测试服',
    ]
  );
  const [createdRows] = await conn.execute('SELECT * FROM matches WHERE id = ? LIMIT 1', [result.insertId]);
  return createdRows[0];
}

async function ensureTeamsAndSlots(conn, matchId, teamCount) {
  for (let i = 1; i <= teamCount; i += 1) {
    await conn.execute(
      `INSERT INTO match_teams (match_id, team_number, team_name, locked, status)
       VALUES (?, ?, ?, 0, 'unlocked')
       ON DUPLICATE KEY UPDATE
         team_name = VALUES(team_name),
         locked = 0,
         status = 'unlocked'`,
      [matchId, i, `测试队伍 ${i}`]
    );
  }

  const [teams] = await conn.execute(
    'SELECT id, team_number FROM match_teams WHERE match_id = ? ORDER BY team_number ASC',
    [matchId]
  );

  for (const team of teams) {
    for (let slot = 0; slot < 5; slot += 1) {
      await conn.execute(
        `INSERT IGNORE INTO match_team_players (match_id, match_team_id, player_index)
         VALUES (?, ?, ?)`,
        [matchId, team.id, slot]
      );
    }
  }

  return teams;
}

async function cleanupMatchData(conn, matchId) {
  await conn.execute('DELETE FROM match_round_results WHERE match_id = ?', [matchId]);
  await conn.execute('DELETE FROM match_rounds WHERE match_id = ?', [matchId]);
  await conn.execute('DELETE FROM match_roster_snapshots WHERE match_id = ?', [matchId]);
}

async function assignUsersToTeams(conn, matchId, teams, userPrefix) {
  const required = teams.length * 4;
  const safeLimit = Math.max(1, Number(required) || 1);
  const [users] = await conn.execute(
    `SELECT id, account, username, pubg_player_name, pubg_platform
     FROM users
     WHERE account LIKE ?
     ORDER BY id ASC
     LIMIT ${safeLimit}`,
    [`${userPrefix}%`]
  );

  if (users.length < required) {
    throw new Error(`测试用户不足，需要 ${required} 个，当前仅 ${users.length} 个。请先运行 seed_test_users。`);
  }

  let ptr = 0;
  for (const team of teams) {
    const captain = users[ptr];
    ptr += 1;
    await conn.execute(
      `UPDATE match_teams
       SET captain_user_id = ?, team_name = ?, locked = 0, status = 'unlocked', updated_by = ?
       WHERE id = ?`,
      [String(captain.id), `测试队伍 ${team.team_number}`, String(captain.id), team.id]
    );

    for (let slot = 0; slot < 5; slot += 1) {
      if (slot <= 3) {
        const user = slot === 0 ? captain : users[ptr++];
        await conn.execute(
          `UPDATE match_team_players
           SET user_id = ?, name = ?, game_id = ?, company = ?, is_current_user = false, player_card_uuid = NULL
           WHERE match_id = ? AND match_team_id = ? AND player_index = ?`,
          [
            String(user.id),
            user.username || `选手${user.id}`,
            user.pubg_player_name || `PUBG_${user.id}`,
            user.pubg_platform || 'steam',
            matchId,
            team.id,
            slot,
          ]
        );
      } else {
        await conn.execute(
          `UPDATE match_team_players
           SET user_id = NULL, name = NULL, game_id = NULL, company = NULL, is_current_user = false, player_card_uuid = NULL
           WHERE match_id = ? AND match_team_id = ? AND player_index = ?`,
          [matchId, team.id, slot]
        );
      }
    }
  }
}

async function createRosterSnapshot(conn, matchId) {
  await conn.execute('DELETE FROM match_roster_snapshots WHERE match_id = ?', [matchId]);
  await conn.execute(
    `INSERT INTO match_roster_snapshots
      (match_id, match_team_id, team_number, team_name, player_index, user_id, player_name,
       game_id, platform, real_name, phone, address, power_score, snapshotted_at)
     SELECT
      mt.match_id,
      mt.id,
      mt.team_number,
      mt.team_name,
      mtp.player_index,
      mtp.user_id,
      mtp.name,
      mtp.game_id,
      mtp.company,
      u.real_name,
      u.phone,
      u.address,
      CAST(JSON_UNQUOTE(JSON_EXTRACT(pc.payload_json, '$.score')) AS SIGNED),
      NOW()
     FROM match_teams mt
     JOIN match_team_players mtp ON mtp.match_team_id = mt.id
     LEFT JOIN users u ON u.id = CAST(mtp.user_id AS UNSIGNED)
     LEFT JOIN pubg_api_cache pc
      ON pc.user_id = u.id
     AND pc.cache_key = CONCAT(u.pubg_platform, ':', u.pubg_player_id, ':power')
     WHERE mt.match_id = ?
       AND mtp.user_id IS NOT NULL
       AND TRIM(mtp.user_id) <> ''`,
    [matchId]
  );
}

async function createCompletedRounds(conn, matchId, teams, roundCount) {
  const teamEntries = teams.map((t) => ({ matchTeamId: t.id, teamNumber: t.team_number, teamName: `测试队伍 ${t.team_number}` }));

  for (let roundNo = 1; roundNo <= roundCount; roundNo += 1) {
    const [roundResult] = await conn.execute(
      `INSERT INTO match_rounds (match_id, round_no, map_name, status, started_at, ended_at)
       VALUES (?, ?, ?, 'completed', NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         status = 'completed',
         map_name = VALUES(map_name),
         started_at = IFNULL(started_at, NOW()),
         ended_at = NOW()`,
      [matchId, roundNo, `Map-${roundNo}`]
    );

    let roundId = roundResult.insertId;
    if (!roundId) {
      const [rows] = await conn.execute('SELECT id FROM match_rounds WHERE match_id = ? AND round_no = ? LIMIT 1', [matchId, roundNo]);
      roundId = rows[0].id;
    }

    const placements = shuffle(teamEntries.map((_, idx) => idx + 1));
    for (let i = 0; i < teamEntries.length; i += 1) {
      const team = teamEntries[i];
      const placement = placements[i];
      const kills = Math.max(0, Math.floor(Math.random() * 12) + (placement <= 3 ? 2 : 0));
      const score = calculateTeamScore({ placement, kills });

      await conn.execute(
        `INSERT INTO match_round_results
          (match_id, round_id, match_team_id, team_number, team_name, placement, kills,
           placement_points, kill_points, total_points, penalty_points, remark, is_locked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 1)
         ON DUPLICATE KEY UPDATE
           team_number = VALUES(team_number),
           team_name = VALUES(team_name),
           placement = VALUES(placement),
           kills = VALUES(kills),
           placement_points = VALUES(placement_points),
           kill_points = VALUES(kill_points),
           total_points = VALUES(total_points),
           penalty_points = 0,
           is_locked = 1`,
        [
          matchId,
          roundId,
          team.matchTeamId,
          team.teamNumber,
          team.teamName,
          score.placement,
          score.kills,
          score.placementPoints,
          score.killPoints,
          score.totalPoints,
        ]
      );
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stage = String(args.stage || 'completed');
  const teamCount = toInt(args.teamCount, 16);
  const userPrefix = String(args.userPrefix || 'test_user_');
  const roundCount = Math.max(1, toInt(args.rounds, 1));
  const reset = String(args.reset || 'true').toLowerCase() !== 'false';
  const matchIdArg = args.matchId ? toInt(args.matchId, 0) : 0;
  const title = String(args.title || '');

  if (!validStage(stage)) {
    throw new Error(`stage 非法: ${stage}，可选 registration|frozen|live|completed`);
  }
  if (teamCount < 2 || teamCount > 16) {
    throw new Error('teamCount 必须在 2 到 16 之间');
  }

  const conn = await pool.getConnection();
  let match;
  try {
    await conn.beginTransaction();
    match = await ensureMatchBase(conn, matchIdArg, title);
    const matchId = match.id;
    if (reset) {
      await cleanupMatchData(conn, matchId);
    }

    const teams = await ensureTeamsAndSlots(conn, matchId, teamCount);
    await assignUsersToTeams(conn, matchId, teams, userPrefix);

    await conn.execute(
      `UPDATE matches
       SET is_active_registration = 0,
           phase = 'registration',
           status = 'upcoming',
           registration_open_at = IFNULL(registration_open_at, NOW()),
           registration_close_at = NULL,
           roster_frozen_at = NULL,
           started_at = NULL,
           completed_at = NULL
       WHERE id = ?`,
      [matchId]
    );

    if (stage === 'registration') {
      await conn.execute('UPDATE matches SET is_active_registration = 1 WHERE id = ?', [matchId]);
    } else {
      await createRosterSnapshot(conn, matchId);
      await conn.execute(
        `UPDATE matches
         SET phase = 'frozen',
             status = 'upcoming',
             is_active_registration = 0,
             registration_close_at = NOW(),
             roster_frozen_at = NOW()
         WHERE id = ?`,
        [matchId]
      );
    }

    if (stage === 'live' || stage === 'completed') {
      await conn.execute(
        `UPDATE matches
         SET phase = 'live',
             status = 'ongoing',
             started_at = NOW()
         WHERE id = ?`,
        [matchId]
      );
    }

    if (stage === 'completed') {
      await createCompletedRounds(conn, matchId, teams, roundCount);
      await conn.execute(
        `UPDATE matches
         SET phase = 'completed',
             status = 'completed',
             completed_at = NOW()
         WHERE id = ?`,
        [matchId]
      );
    }

    await conn.commit();

    console.log(
      JSON.stringify(
        {
          ok: true,
          matchId,
          stage,
          teamCount,
          rounds: stage === 'completed' ? roundCount : 0,
          userPrefix,
          reset,
        },
        null,
        2
      )
    );
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error('[seed_match_flow] 执行失败:', error?.message || error);
  if (error?.code || error?.errno || error?.sqlMessage) {
    console.error(
      '[seed_match_flow] DB错误详情:',
      JSON.stringify(
        {
          code: error.code,
          errno: error.errno,
          sqlMessage: error.sqlMessage,
          sqlState: error.sqlState,
        },
        null,
        2
      )
    );
  }
  if (error?.stack) {
    console.error(error.stack);
  }
  try {
    await pool.end();
  } catch (e) {
    // ignore
  }
  process.exit(1);
});
