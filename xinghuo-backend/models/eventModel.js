const pool = require('../config/db');
const {
  getDefaultScoringConfig,
  getDefaultBasicInfoContent,
  normalizePlacementPoints,
  scoringConfigFromBasicInfo,
  calculateTeamPoints,
  validateRoundResults,
  validateMemberResults,
  normalizeRoundInput,
  validateBasicInfoPayload,
  buildStandings,
  resolveStoredRoundScores,
  memberKillSumKey,
} = require('../services/eventScoring');

const ACTIVE_STATUSES = ['registration', 'locked', 'scoring'];
const TEAM_COUNT = 16;
const SLOTS_PER_TEAM = 5;

function padTeamName(n) {
  return `Team ${String(n).padStart(2, '0')}`;
}

function parseScoringConfig(raw) {
  if (!raw) return getDefaultScoringConfig();
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return getDefaultScoringConfig();
  }
}

class EventModel {
  static async findById(id) {
    const [rows] = await pool.execute('SELECT * FROM events WHERE id = ?', [id]);
    const row = rows[0];
    if (!row) return null;
    return { ...row, scoring_config: parseScoringConfig(row.scoring_config) };
  }

  static async getActiveEvent() {
    const [rows] = await pool.execute(
      `SELECT * FROM events
       WHERE status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
       ORDER BY FIELD(status, 'registration', 'locked', 'scoring'), id DESC
       LIMIT 1`,
      ACTIVE_STATUSES
    );
    const row = rows[0];
    if (!row) return null;
    return { ...row, scoring_config: parseScoringConfig(row.scoring_config) };
  }

  static async getCurrentForUser() {
    return EventModel.getActiveEvent();
  }

  static async listAll() {
    const [rows] = await pool.execute(
      'SELECT * FROM events ORDER BY id DESC'
    );
    return rows.map((row) => ({
      ...row,
      scoring_config: parseScoringConfig(row.scoring_config),
    }));
  }

  static async hasOtherActiveEvent(excludeId = null) {
    const params = [...ACTIVE_STATUSES];
    let sql = `SELECT id FROM events WHERE status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})`;
    if (excludeId != null) {
      sql += ' AND id <> ?';
      params.push(excludeId);
    }
    sql += ' LIMIT 1';
    const [rows] = await pool.execute(sql, params);
    return rows.length > 0;
  }

  static async create(data) {
    const scoring = JSON.stringify(data.scoring_config || getDefaultScoringConfig());
    const [result] = await pool.execute(
      `INSERT INTO events (
        title, description, status, team_count, slots_per_team,
        registration_open_at, registration_close_at,
        scoring_config, require_pubg_binding, created_by
      ) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.title,
        data.description || '',
        TEAM_COUNT,
        SLOTS_PER_TEAM,
        data.registration_open_at || null,
        data.registration_close_at || null,
        scoring,
        data.require_pubg_binding ? 1 : 0,
        data.created_by,
      ]
    );
    const eventId = result.insertId;
    await EventModel.ensureBasicInfo(eventId);
    return eventId;
  }

  static parseBasicInfoRow(row) {
    if (!row) return null;
    let placementPoints = row.placement_points;
    if (typeof placementPoints === 'string') {
      try {
        placementPoints = JSON.parse(placementPoints);
      } catch {
        placementPoints = null;
      }
    }
    return {
      ...row,
      placement_points: normalizePlacementPoints(placementPoints),
    };
  }

  static async getBasicInfo(eventId) {
    const [rows] = await pool.execute(
      'SELECT * FROM event_basic_info WHERE event_id = ? LIMIT 1',
      [eventId]
    );
    return EventModel.parseBasicInfoRow(rows[0]);
  }

  static async getScoringConfigForEvent(eventId) {
    const basicInfo = await EventModel.getBasicInfo(eventId);
    if (basicInfo) return scoringConfigFromBasicInfo(basicInfo);
    const event = await EventModel.findById(eventId);
    return event?.scoring_config || getDefaultScoringConfig();
  }

  static async ensureBasicInfo(eventId, { content, placementPoints, pointsPerKill } = {}) {
    const existing = await EventModel.getBasicInfo(eventId);
    if (existing) return existing;
    const defaults = getDefaultScoringConfig();
    const payload = {
      content: content || getDefaultBasicInfoContent(),
      placement_points: JSON.stringify(normalizePlacementPoints(placementPoints || defaults.placementPoints)),
      points_per_kill: pointsPerKill != null ? Number(pointsPerKill) : defaults.pointsPerKill,
    };
    await pool.execute(
      `INSERT INTO event_basic_info (event_id, content, placement_points, points_per_kill)
       VALUES (?, ?, ?, ?)`,
      [eventId, payload.content, payload.placement_points, payload.points_per_kill]
    );
    return EventModel.getBasicInfo(eventId);
  }

  static async upsertBasicInfo(eventId, data, updatedBy = null) {
    const validation = validateBasicInfoPayload({
      content: data.content,
      placementPoints: data.placement_points || data.placementPoints,
      pointsPerKill: data.points_per_kill ?? data.pointsPerKill,
    });
    if (!validation.ok) return { ok: false, code: 'VALIDATION', message: validation.message };

    const content = data.content != null ? String(data.content) : getDefaultBasicInfoContent();
    const placementPoints = normalizePlacementPoints(data.placement_points || data.placementPoints);
    const pointsPerKill = data.points_per_kill != null
      ? Number(data.points_per_kill)
      : Number(data.pointsPerKill ?? 1);

    const existing = await EventModel.getBasicInfo(eventId);
    if (existing) {
      await pool.execute(
        `UPDATE event_basic_info
         SET content = ?, placement_points = ?, points_per_kill = ?, updated_by = ?
         WHERE event_id = ?`,
        [content, JSON.stringify(placementPoints), pointsPerKill, updatedBy, eventId]
      );
    } else {
      await pool.execute(
        `INSERT INTO event_basic_info (event_id, content, placement_points, points_per_kill, updated_by)
         VALUES (?, ?, ?, ?, ?)`,
        [eventId, content, JSON.stringify(placementPoints), pointsPerKill, updatedBy]
      );
    }
    return { ok: true, basicInfo: await EventModel.getBasicInfo(eventId) };
  }

  static async update(id, data) {
    const fields = [];
    const values = [];
    const allowed = [
      'title',
      'description',
      'registration_open_at',
      'registration_close_at',
      'require_pubg_binding',
    ];
    allowed.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        fields.push(`${key} = ?`);
        let val = data[key];
        if (key === 'require_pubg_binding') val = val ? 1 : 0;
        values.push(val);
      }
    });
    if (data.scoring_config) {
      fields.push('scoring_config = ?');
      values.push(JSON.stringify(data.scoring_config));
    }
    if (!fields.length) return { affectedRows: 0 };
    values.push(id);
    const [result] = await pool.execute(
      `UPDATE events SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
    return result;
  }

  static async publish(eventId) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [events] = await conn.execute('SELECT * FROM events WHERE id = ? FOR UPDATE', [eventId]);
      const event = events[0];
      if (!event) {
        await conn.rollback();
        return { ok: false, code: 'NOT_FOUND' };
      }
      if (event.status !== 'draft') {
        await conn.rollback();
        return { ok: false, code: 'NOT_DRAFT' };
      }
      const [active] = await conn.execute(
        `SELECT id FROM events WHERE status IN ('registration','locked','scoring') AND id <> ? LIMIT 1`,
        [eventId]
      );
      if (active.length) {
        await conn.rollback();
        return { ok: false, code: 'ACTIVE_EXISTS' };
      }
      await conn.execute(
        `UPDATE events SET status = 'registration' WHERE id = ?`,
        [eventId]
      );
      for (let n = 1; n <= TEAM_COUNT; n += 1) {
        const [teamRes] = await conn.execute(
          `INSERT INTO event_teams (event_id, team_number, team_name) VALUES (?, ?, ?)`,
          [eventId, n, padTeamName(n)]
        );
        const teamId = teamRes.insertId;
        for (let slot = 0; slot < SLOTS_PER_TEAM; slot += 1) {
          await conn.execute(
            `INSERT INTO event_team_slots (event_id, event_team_id, slot_index) VALUES (?, ?, ?)`,
            [eventId, teamId, slot]
          );
        }
      }
      await conn.commit();
      return { ok: true };
    } catch (e) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw e;
    } finally {
      conn.release();
    }
  }

  static async lock(eventId) {
    const [result] = await pool.execute(
      `UPDATE events SET status = 'locked', locked_at = NOW()
       WHERE id = ? AND status = 'registration'`,
      [eventId]
    );
    return result.affectedRows > 0;
  }

  static async startScoring(eventId) {
    const [result] = await pool.execute(
      `UPDATE events SET status = 'scoring'
       WHERE id = ? AND status = 'locked'`,
      [eventId]
    );
    return result.affectedRows > 0;
  }

  static async canFinish(eventId) {
    const event = await EventModel.findById(eventId);
    if (!event) return { ok: false, code: 'NOT_FOUND', message: '杯赛不存在' };
    if (event.status !== 'scoring') {
      return { ok: false, code: 'INVALID_STATUS', message: '仅录分中的杯赛可结束' };
    }
    const rounds = await EventModel.getRounds(eventId);
    if (!rounds.length) {
      return { ok: false, code: 'NO_ROUNDS', message: '请先创建局次并完成全部成绩录入' };
    }
    const incompleteRounds = rounds.filter((round) => round.status !== 'completed');
    if (incompleteRounds.length) {
      const labels = incompleteRounds.map((round) => `第${round.round_no}局`).join('、');
      return { ok: false, code: 'INCOMPLETE_ROUNDS', message: `尚有未完成局次：${labels}` };
    }
    const teams = await EventModel.getTeams(eventId);
    for (const round of rounds) {
      const results = await EventModel.getRoundResults(round.id);
      if (results.length < teams.length) {
        return {
          ok: false,
          code: 'INCOMPLETE_RESULTS',
          message: `第 ${round.round_no} 局成绩不完整，请录入全部队伍成绩`,
        };
      }
    }
    return { ok: true };
  }

  static async finish(eventId) {
    const check = await EventModel.canFinish(eventId);
    if (!check.ok) return check;
    const [result] = await pool.execute(
      `UPDATE events SET status = 'finished', finished_at = NOW()
       WHERE id = ? AND status = 'scoring'`,
      [eventId]
    );
    if (!result.affectedRows) {
      return { ok: false, code: 'INVALID_STATUS', message: '仅录分中的杯赛可结束' };
    }
    return { ok: true };
  }

  static async getRounds(eventId) {
    const [rows] = await pool.execute(
      `SELECT * FROM event_rounds WHERE event_id = ? ORDER BY round_no ASC`,
      [eventId]
    );
    return rows;
  }

  static async getRoundById(roundId, eventId = null) {
    const params = [roundId];
    let sql = 'SELECT * FROM event_rounds WHERE id = ?';
    if (eventId != null) {
      sql += ' AND event_id = ?';
      params.push(eventId);
    }
    const [rows] = await pool.execute(sql, params);
    return rows[0] || null;
  }

  static async createRound(eventId, { roundNo, mapName }) {
    const event = await EventModel.findById(eventId);
    if (!event) return { ok: false, code: 'NOT_FOUND' };
    if (!['locked', 'scoring'].includes(event.status)) {
      return { ok: false, code: 'INVALID_STATUS' };
    }
    if (event.status === 'locked') {
      await EventModel.startScoring(eventId);
    }
    const [result] = await pool.execute(
      `INSERT INTO event_rounds (event_id, round_no, map_name) VALUES (?, ?, ?)`,
      [eventId, roundNo, mapName || null]
    );
    return { ok: true, roundId: result.insertId };
  }

  static buildOccupiedSlotsMap(slots) {
    const map = new Map();
    slots.forEach((slot) => {
      if (!slot.user_id) return;
      if (!map.has(slot.event_team_id)) map.set(slot.event_team_id, []);
      map.get(slot.event_team_id).push(slot);
    });
    return map;
  }

  static resolveSlotDisplayName(slot) {
    return EventModel.resolveSlotRealName(slot) || slot.display_name || slot.username || '—';
  }

  static async getRoundMemberResults(roundId) {
    const [rows] = await pool.execute(
      `SELECT * FROM event_round_member_results WHERE round_id = ? ORDER BY event_team_id ASC, slot_index ASC`,
      [roundId]
    );
    return rows;
  }

  static async getRoundMemberResultsMap(roundId) {
    const rows = await EventModel.getRoundMemberResults(roundId);
    const map = new Map();
    rows.forEach((row) => {
      if (!map.has(row.event_team_id)) map.set(row.event_team_id, []);
      map.get(row.event_team_id).push(row);
    });
    return map;
  }

  static async getRoundResults(roundId) {
    const [rows] = await pool.execute(
      `SELECT r.*, t.team_number, t.team_name
       FROM event_round_results r
       JOIN event_teams t ON t.id = r.event_team_id
       WHERE r.round_id = ?
       ORDER BY r.placement ASC`,
      [roundId]
    );
    const memberMap = await EventModel.getRoundMemberResultsMap(roundId);
    return rows.map((row) => ({
      ...row,
      has_member_details: (memberMap.get(row.event_team_id) || []).length > 0,
    }));
  }

  static mapPublicMemberResult(row) {
    return {
      slotIndex: row.slot_index,
      role: row.slot_index === 0 ? 'captain' : 'member',
      displayName: row.display_name,
      kills: row.kills,
    };
  }

  static async getTeamRoundDetails(eventId, teamId) {
    const data = await EventModel.getTeamWithSlots(eventId, teamId);
    if (!data) return null;
    const rounds = await EventModel.getRounds(eventId);
    const [teamResults] = await pool.execute(
      `SELECT r.*, er.round_no, er.map_name, er.status AS round_status
       FROM event_round_results r
       JOIN event_rounds er ON er.id = r.round_id
       WHERE r.event_id = ? AND r.event_team_id = ?
       ORDER BY er.round_no ASC`,
      [eventId, teamId]
    );
    const [memberResults] = await pool.execute(
      `SELECT * FROM event_round_member_results
       WHERE event_id = ? AND event_team_id = ?
       ORDER BY round_id ASC, slot_index ASC`,
      [eventId, teamId]
    );
    const memberByRound = new Map();
    memberResults.forEach((row) => {
      if (!memberByRound.has(row.round_id)) memberByRound.set(row.round_id, []);
      memberByRound.get(row.round_id).push(EventModel.mapPublicMemberResult(row));
    });
    const resultByRound = new Map(teamResults.map((row) => [row.round_id, row]));
    const scoringConfig = await EventModel.getScoringConfigForEvent(eventId);

    const detailRounds = rounds.map((round) => {
      const result = resultByRound.get(round.id);
      const members = memberByRound.get(round.id) || [];
      const memberKillSum = members.length
        ? members.reduce((sum, member) => sum + Number(member.kills || 0), 0)
        : null;
      const resolved = result
        ? resolveStoredRoundScores(result, scoringConfig, memberKillSum)
        : null;
      return {
        roundId: round.id,
        roundNo: round.round_no,
        mapName: round.map_name,
        status: round.status,
        placement: resolved?.placement ?? result?.placement ?? null,
        kills: resolved?.kills ?? result?.kills ?? null,
        placementPoints: resolved?.placementPoints ?? result?.placement_points ?? null,
        killPoints: resolved?.killPoints ?? result?.kill_points ?? null,
        totalPoints: resolved?.totalPoints ?? result?.total_points ?? null,
        members,
      };
    }).filter((round) => round.status === 'completed' || round.placement != null || round.members.length);

    return {
      team: {
        id: data.team.id,
        teamNumber: data.team.team_number,
        teamName: data.team.team_name,
      },
      rounds: detailRounds,
    };
  }

  static async getEventRoster(eventId) {
    const [teams, slots] = await Promise.all([
      EventModel.getTeams(eventId),
      EventModel.getSlotsByEvent(eventId),
    ]);
    const slotMap = EventModel.buildOccupiedSlotsMap(slots);
    return teams.map((team) => ({
      id: team.id,
      teamNumber: team.team_number,
      teamName: team.team_name,
      members: (slotMap.get(team.id) || []).map((slot) => ({
        slotIndex: slot.slot_index,
        role: slot.slot_index === 0 ? 'captain' : 'member',
        displayName: EventModel.resolveSlotDisplayName(slot),
        userId: slot.user_id,
      })),
    }));
  }

  static async saveRoundResults({ eventId, roundId, results, updatedBy }) {
    const event = await EventModel.findById(eventId);
    if (!event) return { ok: false, code: 'NOT_FOUND' };
    if (!['scoring', 'locked'].includes(event.status)) {
      return { ok: false, code: 'INVALID_STATUS' };
    }
    const round = await EventModel.getRoundById(roundId, eventId);
    if (!round) return { ok: false, code: 'ROUND_NOT_FOUND' };

    const teams = await EventModel.getTeams(eventId);
    const normalizedResults = results.map(normalizeRoundInput);
    const validation = validateRoundResults(normalizedResults, teams.length);
    if (!validation.ok) return { ok: false, code: 'VALIDATION', message: validation.message };

    const scoringConfig = await EventModel.getScoringConfigForEvent(eventId);
    const slots = await EventModel.getSlotsByEvent(eventId);
    const occupiedByTeam = EventModel.buildOccupiedSlotsMap(slots);

    const teamIds = new Set(teams.map((t) => t.id));
    for (const row of normalizedResults) {
      if (!teamIds.has(Number(row.eventTeamId))) {
        return { ok: false, code: 'VALIDATION', message: '队伍 ID 无效' };
      }
      const occupied = occupiedByTeam.get(Number(row.eventTeamId)) || [];
      const memberValidation = validateMemberResults(
        row.members,
        occupied.map((slot) => slot.slot_index)
      );
      if (!memberValidation.ok) {
        return { ok: false, code: 'VALIDATION', message: memberValidation.message };
      }
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (event.status === 'locked') {
        await conn.execute(`UPDATE events SET status = 'scoring' WHERE id = ?`, [eventId]);
      }
      for (const row of normalizedResults) {
        const teamId = Number(row.eventTeamId);
        const placement = Number(row.placement);
        const kills = Number(row.kills);
        const points = calculateTeamPoints(placement, kills, scoringConfig);
        await conn.execute(
          `INSERT INTO event_round_results (
            event_id, round_id, event_team_id, placement, kills,
            placement_points, kill_points, total_points, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            placement = VALUES(placement),
            kills = VALUES(kills),
            placement_points = VALUES(placement_points),
            kill_points = VALUES(kill_points),
            total_points = VALUES(total_points),
            updated_by = VALUES(updated_by)`,
          [
            eventId,
            roundId,
            teamId,
            placement,
            kills,
            points.placementPoints,
            points.killPoints,
            points.totalPoints,
            updatedBy,
          ]
        );

        if (row.members.length) {
          const occupied = occupiedByTeam.get(teamId) || [];
          const killMap = new Map(
            row.members.map((member) => [Number(member.slotIndex ?? member.slot_index), Number(member.kills ?? 0)])
          );
          await conn.execute(
            `DELETE FROM event_round_member_results WHERE round_id = ? AND event_team_id = ?`,
            [roundId, teamId]
          );
          for (const slot of occupied) {
            const memberKills = killMap.has(slot.slot_index)
              ? killMap.get(slot.slot_index)
              : 0;
            await conn.execute(
              `INSERT INTO event_round_member_results (
                event_id, round_id, event_team_id, slot_index, user_id, display_name, kills, updated_by
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                eventId,
                roundId,
                teamId,
                slot.slot_index,
                slot.user_id,
                EventModel.resolveSlotDisplayName(slot),
                memberKills,
                updatedBy,
              ]
            );
          }
        }
      }
      await conn.commit();
      return { ok: true };
    } catch (e) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw e;
    } finally {
      conn.release();
    }
  }

  static async completeRound(eventId, roundId) {
    const round = await EventModel.getRoundById(roundId, eventId);
    if (!round) return { ok: false, code: 'ROUND_NOT_FOUND' };
    const results = await EventModel.getRoundResults(roundId);
    const teams = await EventModel.getTeams(eventId);
    if (results.length < teams.length) {
      return { ok: false, code: 'INCOMPLETE', message: '请先录入全部队伍成绩' };
    }
    const [result] = await pool.execute(
      `UPDATE event_rounds SET status = 'completed', completed_at = NOW()
       WHERE id = ? AND event_id = ?`,
      [roundId, eventId]
    );
    return result.affectedRows > 0 ? { ok: true } : { ok: false, code: 'ROUND_NOT_FOUND' };
  }

  static buildMemberKillLeaderboard(rows) {
    const map = new Map();
    rows.forEach((row) => {
      const key = row.user_id ? `u:${row.user_id}` : `s:${row.event_team_id}:${row.slot_index}`;
      const kills = Number(row.kills) || 0;
      const slotLike = {
        user_real_name: row.real_name,
        display_name: row.slot_display_name || row.display_name,
        username: row.username,
        pubg_player_name: row.slot_pubg_name,
        user_pubg_player_name: row.user_pubg_name,
      };
      if (!map.has(key)) {
        map.set(key, {
          userId: row.user_id,
          teamId: row.event_team_id,
          teamNumber: row.team_number,
          teamName: row.team_name,
          realName: EventModel.resolveSlotRealName(slotLike) || row.display_name || '—',
          gameId: EventModel.resolveSlotPubgName(slotLike),
          totalKills: 0,
        });
      }
      map.get(key).totalKills += kills;
    });
    const leaderboard = [...map.values()].sort((a, b) => {
      if (b.totalKills !== a.totalKills) return b.totalKills - a.totalKills;
      return a.teamNumber - b.teamNumber;
    });
    leaderboard.forEach((entry, index) => {
      entry.rank = index + 1;
    });
    return leaderboard;
  }

  static async getMemberKillLeaderboard(eventId) {
    const [rows] = await pool.execute(
      `SELECT m.user_id, m.event_team_id, m.slot_index, m.display_name, m.kills,
              t.team_number, t.team_name,
              u.real_name, u.username, u.pubg_player_name AS user_pubg_name,
              s.pubg_player_name AS slot_pubg_name, s.display_name AS slot_display_name
       FROM event_round_member_results m
       INNER JOIN event_rounds r ON r.id = m.round_id AND r.status = 'completed'
       INNER JOIN event_teams t ON t.id = m.event_team_id
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN event_team_slots s
         ON s.event_id = m.event_id
        AND s.event_team_id = m.event_team_id
        AND s.slot_index = m.slot_index
       WHERE m.event_id = ?
       ORDER BY m.event_team_id ASC, m.slot_index ASC`,
      [eventId]
    );
    return EventModel.buildMemberKillLeaderboard(rows);
  }

  static async getStandingsData(eventId) {
    const [event, teams, rounds] = await Promise.all([
      EventModel.findById(eventId),
      EventModel.getTeams(eventId),
      EventModel.getRounds(eventId),
    ]);
    if (!event) return null;
    const roundIds = rounds.map((r) => r.id);
    let allResults = [];
    if (roundIds.length) {
      const [rows] = await pool.execute(
        `SELECT * FROM event_round_results WHERE event_id = ?`,
        [eventId]
      );
      allResults = rows;
    }
    const resultsByRound = new Map();
    allResults.forEach((row) => {
      if (!resultsByRound.has(row.round_id)) resultsByRound.set(row.round_id, []);
      resultsByRound.get(row.round_id).push(row);
    });
    if (roundIds.length) {
      const [memberRows] = await pool.execute(
        `SELECT round_id, event_team_id, COUNT(*) AS member_count, SUM(kills) AS kill_sum
         FROM event_round_member_results
         WHERE event_id = ?
         GROUP BY round_id, event_team_id`,
        [eventId]
      );
      const memberCountMap = new Map(
        memberRows.map((row) => [`${row.round_id}:${row.event_team_id}`, Number(row.member_count)])
      );
      const memberKillSumMap = new Map(
        memberRows.map((row) => [
          memberKillSumKey(row.round_id, row.event_team_id),
          Number(row.kill_sum || 0),
        ])
      );
      allResults.forEach((row) => {
        row.has_member_details = memberCountMap.has(`${row.round_id}:${row.event_team_id}`);
      });
      const scoringConfig = await EventModel.getScoringConfigForEvent(eventId);
      const standings = buildStandings(teams, rounds, resultsByRound, scoringConfig, memberKillSumMap);
      return { event, teams, rounds, standings };
    }
    const scoringConfig = await EventModel.getScoringConfigForEvent(eventId);
    const standings = buildStandings(teams, rounds, resultsByRound, scoringConfig);
    return { event, teams, rounds, standings };
  }

  static async buildEventHistorySummary(eventId) {
    const [rounds, data, leaderboard] = await Promise.all([
      EventModel.getRounds(eventId),
      EventModel.getStandingsData(eventId),
      EventModel.getMemberKillLeaderboard(eventId),
    ]);
    const completedRounds = rounds.filter((round) => round.status === 'completed');
    const champion = data?.standings?.[0];
    const topKiller = leaderboard?.[0];
    const [participantRows] = await pool.execute(
      `SELECT COUNT(DISTINCT user_id) AS cnt
       FROM event_team_slots
       WHERE event_id = ? AND user_id IS NOT NULL`,
      [eventId]
    );
    return {
      totalRounds: completedRounds.length,
      championTeamName: champion?.teamName || null,
      championTeamNumber: champion?.teamNumber || null,
      topKillerName: topKiller?.realName || null,
      topKillerKills: topKiller?.totalKills || 0,
      participantCount: Number(participantRows[0]?.cnt || 0),
    };
  }

  static async listFinishedEvents() {
    const [rows] = await pool.execute(
      `SELECT id, title, finished_at
       FROM events
       WHERE status = 'finished'
       ORDER BY finished_at DESC, id DESC`
    );
    const items = await Promise.all(
      rows.map(async (row) => {
        const summary = await EventModel.buildEventHistorySummary(row.id);
        return {
          id: row.id,
          title: row.title,
          finishedAt: row.finished_at,
          ...summary,
        };
      })
    );
    return items;
  }

  static async getEventArchive(eventId) {
    const event = await EventModel.findById(eventId);
    if (!event || event.status !== 'finished') return null;
    const [data, leaderboard, summary, basicInfoRow] = await Promise.all([
      EventModel.getStandingsData(eventId),
      EventModel.getMemberKillLeaderboard(eventId),
      EventModel.buildEventHistorySummary(eventId),
      EventModel.ensureBasicInfo(eventId),
    ]);
    return {
      event,
      rounds: data.rounds,
      standings: data.standings,
      leaderboard,
      summary,
      basicInfo: basicInfoRow,
    };
  }

  static async getUserCupHistory(userId) {
    const [participations] = await pool.execute(
      `SELECT s.event_id, s.event_team_id, e.title, e.finished_at,
              t.team_number, t.team_name
       FROM event_team_slots s
       INNER JOIN events e ON e.id = s.event_id AND e.status = 'finished'
       INNER JOIN event_teams t ON t.id = s.event_team_id
       WHERE s.user_id = ?
       ORDER BY e.finished_at DESC, e.id DESC`,
      [userId]
    );
    if (!participations.length) {
      return {
        summary: { seasonsPlayed: 0, championships: 0, bestRank: null, totalKills: 0 },
        seasons: [],
      };
    }
    const seasons = [];
    let championships = 0;
    let bestRank = null;
    let totalKills = 0;
    for (const row of participations) {
      const data = await EventModel.getStandingsData(row.event_id);
      const teamStanding = (data?.standings || []).find((item) => item.teamId === row.event_team_id);
      const rank = teamStanding?.rank ?? null;
      if (rank === 1) championships += 1;
      if (rank != null && (bestRank == null || rank < bestRank)) bestRank = rank;
      const [killRows] = await pool.execute(
        `SELECT COALESCE(SUM(m.kills), 0) AS total
         FROM event_round_member_results m
         INNER JOIN event_rounds r ON r.id = m.round_id AND r.status = 'completed'
         WHERE m.event_id = ? AND m.user_id = ?`,
        [row.event_id, userId]
      );
      const kills = Number(killRows[0]?.total || 0);
      totalKills += kills;
      seasons.push({
        eventId: row.event_id,
        title: row.title,
        finishedAt: row.finished_at,
        teamNumber: row.team_number,
        teamName: row.team_name,
        teamRank: rank,
        totalKills: kills,
        teamTotalPoints: teamStanding?.totalPoints ?? 0,
        isChampion: rank === 1,
      });
    }
    return {
      summary: {
        seasonsPlayed: seasons.length,
        championships,
        bestRank,
        totalKills,
      },
      seasons,
    };
  }

  static async getTeams(eventId) {
    const [rows] = await pool.execute(
      `SELECT * FROM event_teams WHERE event_id = ? ORDER BY team_number ASC`,
      [eventId]
    );
    return rows;
  }

  static async getSlotsByEvent(eventId) {
    const [rows] = await pool.execute(
      `SELECT s.*, u.username, u.real_name AS user_real_name, u.avatar,
              u.pubg_player_name AS user_pubg_player_name, u.pubg_power_cached_json
       FROM event_team_slots s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.event_id = ?
       ORDER BY s.event_team_id ASC, s.slot_index ASC`,
      [eventId]
    );
    return rows;
  }

  static async getUserSlot(eventId, userId) {
    const [rows] = await pool.execute(
      `SELECT s.*, t.team_number, t.team_name
       FROM event_team_slots s
       JOIN event_teams t ON t.id = s.event_team_id
       WHERE s.event_id = ? AND s.user_id = ?
       ORDER BY s.joined_at ASC, s.id ASC
       LIMIT 1`,
      [eventId, userId]
    );
    return rows[0] || null;
  }

  static async getTeamWithSlots(eventId, teamId) {
    const [teams] = await pool.execute(
      'SELECT * FROM event_teams WHERE id = ? AND event_id = ?',
      [teamId, eventId]
    );
    if (!teams[0]) return null;
    const [slots] = await pool.execute(
      `SELECT s.*, u.username, u.real_name AS user_real_name, u.avatar,
              u.pubg_player_name AS user_pubg_player_name, u.pubg_power_cached_json
       FROM event_team_slots s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.event_team_id = ?
       ORDER BY s.slot_index ASC`,
      [teamId]
    );
    return { team: teams[0], slots };
  }

  static async refreshSlotSparkScores(eventId) {
    const [rows] = await pool.execute(
      `SELECT s.id, u.pubg_power_cached_json
       FROM event_team_slots s
       JOIN users u ON u.id = s.user_id
       WHERE s.event_id = ? AND s.user_id IS NOT NULL`,
      [eventId]
    );
    await Promise.all(
      rows.map((row) => {
        const score = EventModel.parsePowerCacheScore(row.pubg_power_cached_json);
        return pool.execute(
          'UPDATE event_team_slots SET spark_score = ? WHERE id = ?',
          [score, row.id]
        );
      })
    );
  }

  static async joinSlot({ eventId, teamId, slotIndex, userId, displayName, pubgPlayerName, sparkScore = null }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [events] = await conn.execute(
        'SELECT status, require_pubg_binding FROM events WHERE id = ? FOR UPDATE',
        [eventId]
      );
      if (!events[0] || events[0].status !== 'registration') {
        await conn.rollback();
        return { ok: false, code: 'NOT_REGISTRATION' };
      }
      // 锁定本赛事全部槽位，避免并发占坑竞态
      await conn.execute(
        'SELECT id FROM event_team_slots WHERE event_id = ? FOR UPDATE',
        [eventId]
      );
      const [existingInTeam] = await conn.execute(
        'SELECT id, slot_index FROM event_team_slots WHERE event_team_id = ? AND user_id = ? LIMIT 1',
        [teamId, userId]
      );
      if (existingInTeam.length) {
        await conn.rollback();
        return { ok: false, code: 'ALREADY_JOINED' };
      }
      const [existing] = await conn.execute(
        'SELECT id, event_team_id FROM event_team_slots WHERE event_id = ? AND user_id = ? LIMIT 1',
        [eventId, userId]
      );
      if (existing.length) {
        await conn.rollback();
        return { ok: false, code: 'ALREADY_JOINED' };
      }
      const [slots] = await conn.execute(
        `SELECT s.id, s.user_id, s.slot_index, t.id AS team_id
         FROM event_team_slots s
         JOIN event_teams t ON t.id = s.event_team_id
         WHERE s.event_id = ? AND t.id = ? AND s.slot_index = ?
         FOR UPDATE`,
        [eventId, teamId, slotIndex]
      );
      const slot = slots[0];
      if (!slot) {
        await conn.rollback();
        return { ok: false, code: 'SLOT_NOT_FOUND' };
      }
      if (slot.user_id) {
        await conn.rollback();
        return { ok: false, code: 'SLOT_TAKEN' };
      }
      if (events[0].require_pubg_binding && !pubgPlayerName) {
        await conn.rollback();
        return { ok: false, code: 'PUBG_REQUIRED' };
      }
      await conn.execute(
        `UPDATE event_team_slots
         SET user_id = ?, display_name = ?, pubg_player_name = ?, spark_score = ?, joined_at = NOW()
         WHERE id = ?`,
        [userId, displayName, pubgPlayerName || null, sparkScore, slot.id]
      );
      if (Number(slotIndex) === 0) {
        await conn.execute(
          'UPDATE event_teams SET captain_user_id = ? WHERE id = ?',
          [userId, teamId]
        );
      }
      await conn.commit();
      return { ok: true };
    } catch (e) {
      try {
        await conn.rollback();
      } catch (_) {}
      if (e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062)) {
        return { ok: false, code: 'ALREADY_JOINED' };
      }
      throw e;
    } finally {
      conn.release();
    }
  }

  static async leave(eventId, userId) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [events] = await conn.execute('SELECT status FROM events WHERE id = ?', [eventId]);
      if (!events[0] || events[0].status !== 'registration') {
        await conn.rollback();
        return { ok: false, code: 'NOT_REGISTRATION' };
      }
      const [slots] = await conn.execute(
        `SELECT s.id, s.slot_index, s.event_team_id
         FROM event_team_slots s
         WHERE s.event_id = ? AND s.user_id = ?
         FOR UPDATE`,
        [eventId, userId]
      );
      const slot = slots[0];
      if (!slot) {
        await conn.rollback();
        return { ok: false, code: 'NOT_IN_TEAM' };
      }
      await conn.execute(
        `UPDATE event_team_slots
         SET user_id = NULL, display_name = NULL, pubg_player_name = NULL, spark_score = NULL, joined_at = NULL
         WHERE id = ?`,
        [slot.id]
      );
      if (Number(slot.slot_index) === 0) {
        await conn.execute(
          'UPDATE event_teams SET captain_user_id = NULL WHERE id = ?',
          [slot.event_team_id]
        );
      }
      await conn.commit();
      return { ok: true };
    } catch (e) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw e;
    } finally {
      conn.release();
    }
  }

  static async clearSlot(slotId) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute(
        `SELECT s.*, e.status AS event_status
         FROM event_team_slots s
         JOIN events e ON e.id = s.event_id
         WHERE s.id = ?
         FOR UPDATE`,
        [slotId]
      );
      const slot = rows[0];
      if (!slot) {
        await conn.rollback();
        return { ok: false, code: 'NOT_FOUND' };
      }
      await conn.execute(
        `UPDATE event_team_slots
         SET user_id = NULL, display_name = NULL, pubg_player_name = NULL, spark_score = NULL, joined_at = NULL
         WHERE id = ?`,
        [slotId]
      );
      if (Number(slot.slot_index) === 0) {
        await conn.execute(
          'UPDATE event_teams SET captain_user_id = NULL WHERE id = ?',
          [slot.event_team_id]
        );
      }
      await conn.commit();
      return { ok: true };
    } catch (e) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw e;
    } finally {
      conn.release();
    }
  }

  static resolveSlotRealName(slotRow) {
    const liveRealName = String(slotRow.user_real_name || '').trim();
    if (liveRealName) return liveRealName;
    const snap = String(slotRow.display_name || '').trim();
    const username = String(slotRow.username || '').trim();
    if (snap && snap !== username) return snap;
    return username || null;
  }

  static resolveSlotPubgName(slotRow) {
    return String(slotRow.pubg_player_name || slotRow.user_pubg_player_name || '').trim() || null;
  }

  static parsePowerCacheScore(raw) {
    if (!raw) return null;
    try {
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const score = Number(data?.score);
      if (!Number.isFinite(score)) return null;
      return Math.round(score);
    } catch {
      return null;
    }
  }

  static resolveSparkScore(slotRow) {
    const fromCache = EventModel.parsePowerCacheScore(slotRow.pubg_power_cached_json);
    if (fromCache != null) return fromCache;
    if (slotRow.spark_score != null && Number.isFinite(Number(slotRow.spark_score))) {
      return Math.round(Number(slotRow.spark_score));
    }
    return null;
  }

  static async syncUserSparkScore(userId, score) {
    const rounded = score != null && Number.isFinite(Number(score)) ? Math.round(Number(score)) : null;
    await pool.execute(
      `UPDATE event_team_slots s
       JOIN events e ON e.id = s.event_id
       SET s.spark_score = ?
       WHERE s.user_id = ? AND e.status = 'registration'`,
      [rounded, userId]
    );
  }

  static async dedupeOccupiedSlots() {
    const [dupes] = await pool.execute(
      `SELECT event_id, user_id
       FROM event_team_slots
       WHERE user_id IS NOT NULL
       GROUP BY event_id, user_id
       HAVING COUNT(*) > 1`
    );
    for (const row of dupes) {
      const [slots] = await pool.execute(
        `SELECT id, slot_index, event_team_id
         FROM event_team_slots
         WHERE event_id = ? AND user_id = ?
         ORDER BY joined_at ASC, id ASC`,
        [row.event_id, row.user_id]
      );
      const keep = slots[0];
      for (let i = 1; i < slots.length; i += 1) {
        const duplicate = slots[i];
        await pool.execute(
          `UPDATE event_team_slots
           SET user_id = NULL, display_name = NULL, pubg_player_name = NULL, spark_score = NULL, joined_at = NULL
           WHERE id = ?`,
          [duplicate.id]
        );
        if (Number(duplicate.slot_index) === 0) {
          await pool.execute(
            'UPDATE event_teams SET captain_user_id = NULL WHERE id = ?',
            [duplicate.event_team_id]
          );
        }
      }
      if (keep && Number(keep.slot_index) === 0) {
        await pool.execute(
          'UPDATE event_teams SET captain_user_id = ? WHERE id = ?',
          [row.user_id, keep.event_team_id]
        );
      }
    }
    return dupes.length;
  }

  static parsePowerCacheEntry(raw) {
    if (!raw) return null;
    try {
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const score = EventModel.parsePowerCacheScore(raw);
      if (score == null || score <= 0) return null;
      return {
        score,
        level: data?.level || null,
        kd: Number(data?.kd || 0),
        avgDamage: Number(data?.avgDamage || 0),
        matchesAnalyzed: Number(data?.matchesAnalyzed || 0),
        sampleLimited: Boolean(data?.sampleLimited),
        formulaVersion: data?.formulaVersion || null,
        seasonId: data?.seasonId || null,
      };
    } catch {
      return null;
    }
  }

  static buildLobby(teams, slots) {
    const slotMap = new Map();
    slots.forEach((s) => {
      if (!slotMap.has(s.event_team_id)) slotMap.set(s.event_team_id, []);
      const realName = EventModel.resolveSlotRealName(s);
      slotMap.get(s.event_team_id).push({
        id: s.id,
        slotIndex: s.slot_index,
        role: s.slot_index === 0 ? 'captain' : 'member',
        userId: s.user_id,
        realName,
        displayName: realName,
        avatar: s.avatar || null,
        pubgPlayerName: EventModel.resolveSlotPubgName(s),
        sparkScore: EventModel.resolveSparkScore(s),
        occupied: Boolean(s.user_id),
      });
    });
    return teams.map((t) => ({
      id: t.id,
      teamNumber: t.team_number,
      teamName: t.team_name,
      captainUserId: t.captain_user_id,
      slots: (slotMap.get(t.id) || []).sort((a, b) => a.slotIndex - b.slotIndex),
      memberCount: (slotMap.get(t.id) || []).filter((s) => s.occupied).length,
    }));
  }
}

module.exports = EventModel;
