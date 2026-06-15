const pool = require('../config/db');
const {
  getDefaultScoringConfig,
  calculateTeamPoints,
  validateRoundResults,
  buildStandings,
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
    const active = await EventModel.getActiveEvent();
    if (active) return active;
    const [rows] = await pool.execute(
      `SELECT * FROM events ORDER BY id DESC LIMIT 1`
    );
    const row = rows[0];
    if (!row) return null;
    return { ...row, scoring_config: parseScoringConfig(row.scoring_config) };
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
    return result.insertId;
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

  static async finish(eventId) {
    const [result] = await pool.execute(
      `UPDATE events SET status = 'finished', finished_at = NOW()
       WHERE id = ? AND status = 'scoring'`,
      [eventId]
    );
    return result.affectedRows > 0;
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

  static async getRoundResults(roundId) {
    const [rows] = await pool.execute(
      `SELECT r.*, t.team_number, t.team_name
       FROM event_round_results r
       JOIN event_teams t ON t.id = r.event_team_id
       WHERE r.round_id = ?
       ORDER BY r.placement ASC`,
      [roundId]
    );
    return rows;
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
    const validation = validateRoundResults(results, teams.length);
    if (!validation.ok) return { ok: false, code: 'VALIDATION', message: validation.message };

    const teamIds = new Set(teams.map((t) => t.id));
    for (const row of results) {
      if (!teamIds.has(Number(row.eventTeamId))) {
        return { ok: false, code: 'VALIDATION', message: '队伍 ID 无效' };
      }
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (event.status === 'locked') {
        await conn.execute(`UPDATE events SET status = 'scoring' WHERE id = ?`, [eventId]);
      }
      for (const row of results) {
        const placement = Number(row.placement);
        const kills = Number(row.kills);
        const points = calculateTeamPoints(placement, kills, event.scoring_config);
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
            Number(row.eventTeamId),
            placement,
            kills,
            points.placementPoints,
            points.killPoints,
            points.totalPoints,
            updatedBy,
          ]
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
    const standings = buildStandings(teams, rounds, resultsByRound);
    return { event, teams, rounds, standings };
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
        const score = EventModel.resolveSparkScore(row);
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
      const [existing] = await conn.execute(
        'SELECT id FROM event_team_slots WHERE event_id = ? AND user_id = ? LIMIT 1',
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

  static resolveSparkScore(slotRow) {
    if (slotRow.spark_score != null && Number.isFinite(Number(slotRow.spark_score))) {
      return Math.round(Number(slotRow.spark_score));
    }
    const raw = slotRow.pubg_power_cached_json;
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
