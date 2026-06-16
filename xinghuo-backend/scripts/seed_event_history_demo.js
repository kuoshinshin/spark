require('dotenv').config();
const { guardNotProduction } = require('./_guardNotProduction');
guardNotProduction('seed_event_history_demo');

const pool = require('../config/db');
const { calculateTeamPoints, getDefaultScoringConfig } = require('../services/eventScoring');

const TEAM_COUNT = 16;
const SLOTS_PER_TEAM = 5;
const DEMO_PREFIX = '[演示]';

const DEMO_EVENTS = [
  {
    title: `${DEMO_PREFIX} 星火杯 2025 春季赛`,
    description: '春季队内示范杯赛，含 4 局完整成绩与成员击杀明细。',
    finishedAt: '2025-03-20 18:00:00',
    rounds: [
      { roundNo: 1, mapName: '艾伦格' },
      { roundNo: 2, mapName: '米拉玛' },
      { roundNo: 3, mapName: '泰戈' },
      { roundNo: 4, mapName: '荣都' },
    ],
  },
  {
    title: `${DEMO_PREFIX} 星火杯 2024 冬季赛`,
    description: '冬季队内示范杯赛，含 3 局完整成绩与成员击杀明细。',
    finishedAt: '2024-12-08 20:30:00',
    rounds: [
      { roundNo: 1, mapName: '艾伦格' },
      { roundNo: 2, mapName: '维寒迪' },
      { roundNo: 3, mapName: '米拉玛' },
    ],
  },
];

function padTeamName(n) {
  return `战队 ${String(n).padStart(2, '0')}`;
}

function buildMemberKills(totalKills, memberCount = 5) {
  const kills = [];
  let remaining = totalKills;
  for (let i = 0; i < memberCount; i += 1) {
    if (i === memberCount - 1) {
      kills.push(remaining);
    } else {
      const part = Math.floor(remaining / (memberCount - i));
      kills.push(part);
      remaining -= part;
    }
  }
  return kills;
}

function buildRoundResults(teams, roundNo) {
  const shuffled = [...teams].sort((a, b) => {
    const seed = (a.team_number * 17 + roundNo * 13) % teams.length;
    const seedB = (b.team_number * 17 + roundNo * 13) % teams.length;
    return seed - seedB;
  });
  const scoringConfig = getDefaultScoringConfig();
  return shuffled.map((team, index) => {
    const placement = index + 1;
    const kills = Math.max(0, 18 - placement * 2 + ((team.team_number + roundNo) % 5));
    const points = calculateTeamPoints(placement, kills, scoringConfig);
    const memberKills = buildMemberKills(kills, SLOTS_PER_TEAM);
    return {
      teamId: team.id,
      teamNumber: team.team_number,
      placement,
      kills,
      points,
      memberKills,
    };
  });
}

async function getAdminId(conn) {
  const [rows] = await conn.execute(
    `SELECT id FROM users WHERE role IN ('admin', 'superadmin') ORDER BY id ASC LIMIT 1`
  );
  if (!rows.length) throw new Error('未找到管理员账号，请先创建 admin 用户');
  return rows[0].id;
}

async function getSeedUserIds(conn, limit = TEAM_COUNT * SLOTS_PER_TEAM) {
  const [rows] = await conn.execute(
    `SELECT id, username, real_name, pubg_player_name
     FROM users
     WHERE role = 'user'
     ORDER BY id ASC
     LIMIT ${Number(limit)}`
  );
  if (rows.length < TEAM_COUNT * SLOTS_PER_TEAM) {
    throw new Error(`测试用户不足（需要至少 ${TEAM_COUNT * SLOTS_PER_TEAM} 个），请先运行 npm run seed:test-users`);
  }
  return rows;
}

async function seedDemoEvent(conn, config, adminId, users) {
  const [existing] = await conn.execute('SELECT id FROM events WHERE title = ? LIMIT 1', [config.title]);
  if (existing.length) {
    return { eventId: existing[0].id, skipped: true };
  }

  const [eventRes] = await conn.execute(
    `INSERT INTO events (
      title, description, status, team_count, slots_per_team,
      finished_at, require_pubg_binding, created_by
    ) VALUES (?, ?, 'finished', ?, ?, ?, 0, ?)`,
    [config.title, config.description, TEAM_COUNT, SLOTS_PER_TEAM, config.finishedAt, adminId]
  );
  const eventId = eventRes.insertId;

  const defaultPlacement = JSON.stringify(getDefaultScoringConfig().placementPoints);
  await conn.execute(
    `INSERT INTO event_basic_info (event_id, content, placement_points, points_per_kill, updated_by)
     VALUES (?, ?, ?, 1, ?)`,
    [
      eventId,
      `【演示数据】${config.title}\n\n本数据由 seed_event_history_demo 脚本生成，仅供历史赛季功能演示。`,
      defaultPlacement,
      adminId,
    ]
  );

  const teams = [];
  for (let n = 1; n <= TEAM_COUNT; n += 1) {
    const [teamRes] = await conn.execute(
      `INSERT INTO event_teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
      [eventId, n, padTeamName(n)]
    );
    teams.push({ id: teamRes.insertId, team_number: n });
  }

  let userCursor = 0;
  for (const team of teams) {
    for (let slotIndex = 0; slotIndex < SLOTS_PER_TEAM; slotIndex += 1) {
      const user = users[userCursor];
      userCursor += 1;
      if (!user) break;
      const displayName = user.real_name || user.username;
      await conn.execute(
        `INSERT INTO event_team_slots (
          event_id, event_team_id, slot_index, user_id, display_name, pubg_player_name, joined_at
        ) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [eventId, team.id, slotIndex, user.id, displayName, user.pubg_player_name || null]
      );
    }
  }

  const [slotRows] = await conn.execute(
    `SELECT id, event_team_id, slot_index, user_id, display_name
     FROM event_team_slots WHERE event_id = ?`,
    [eventId]
  );
  const slotsByTeam = new Map();
  slotRows.forEach((slot) => {
    if (!slotsByTeam.has(slot.event_team_id)) slotsByTeam.set(slot.event_team_id, []);
    slotsByTeam.get(slot.event_team_id).push(slot);
  });

  for (const roundConfig of config.rounds) {
    const [roundRes] = await conn.execute(
      `INSERT INTO event_rounds (event_id, round_no, map_name, status, completed_at)
       VALUES (?, ?, ?, 'completed', ?)`,
      [eventId, roundConfig.roundNo, roundConfig.mapName, config.finishedAt]
    );
    const roundId = roundRes.insertId;
    const roundResults = buildRoundResults(teams, roundConfig.roundNo);

    for (const row of roundResults) {
      await conn.execute(
        `INSERT INTO event_round_results (
          event_id, round_id, event_team_id, placement, kills,
          placement_points, kill_points, total_points, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          roundId,
          row.teamId,
          row.placement,
          row.kills,
          row.points.placementPoints,
          row.points.killPoints,
          row.points.totalPoints,
          adminId,
        ]
      );

      const teamSlots = (slotsByTeam.get(row.teamId) || []).sort((a, b) => a.slot_index - b.slot_index);
      for (let index = 0; index < teamSlots.length; index += 1) {
        const slot = teamSlots[index];
        const memberKills = row.memberKills[index] ?? 0;
        await conn.execute(
          `INSERT INTO event_round_member_results (
            event_id, round_id, event_team_id, slot_index, user_id, display_name, kills, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            eventId,
            roundId,
            row.teamId,
            slot.slot_index,
            slot.user_id,
            slot.display_name,
            memberKills,
            adminId,
          ]
        );
      }
    }
  }

  return { eventId, skipped: false };
}

async function main() {
  const conn = await pool.getConnection();
  try {
    const adminId = await getAdminId(conn);
    const users = await getSeedUserIds(conn);
    const results = [];
    for (const config of DEMO_EVENTS) {
      const result = await seedDemoEvent(conn, config, adminId, users);
      results.push({ title: config.title, ...result });
    }
    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[seed_event_history_demo] 执行失败:', error?.message || error);
  process.exit(1);
});
