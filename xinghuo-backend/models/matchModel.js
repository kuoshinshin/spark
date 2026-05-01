const pool = require('../config/db');
const { calculateTeamScore } = require('../services/pgsScoring');

const extractPowerScore = (raw) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const score = Number(parsed?.score);
    return Number.isFinite(score) ? score : null;
  } catch {
    return null;
  }
};

const toJson = (value) => JSON.stringify(value || {});

class MatchModel {
  static TEAM_COUNT = 16;
  static TEAM_SLOT_COUNT = 5; // 0: 队长, 1-3: 正式队员, 4: 替补

  // 创建比赛
  static async create(title, description, startTime, endTime, location, status = 'upcoming', registrationOpenAt = null, registrationCloseAt = null, rosterFrozenAt = null, isActiveRegistration = false) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      if (isActiveRegistration) {
        await connection.execute('UPDATE matches SET is_active_registration = 0');
      }
      const [result] = await connection.execute(
        `INSERT INTO matches
        (title, description, start_time, end_time, location, status, phase, registration_open_at, registration_close_at, roster_frozen_at, is_active_registration)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [title, description, startTime, endTime, location, status, isActiveRegistration ? 'registration' : 'draft', registrationOpenAt, registrationCloseAt, rosterFrozenAt, isActiveRegistration ? 1 : 0]
      );
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // 获取所有比赛
  static async getAll() {
    const [rows] = await pool.execute('SELECT * FROM matches ORDER BY start_time DESC');
    return rows;
  }

  // 根据ID获取比赛
  static async getById(id) {
    const [rows] = await pool.execute('SELECT * FROM matches WHERE id = ?', [id]);
    return rows[0];
  }

  static async getActiveRegistrationMatch() {
    const [activeRows] = await pool.execute(
      `SELECT * FROM matches
       WHERE is_active_registration = 1
         AND phase = 'registration'
       ORDER BY start_time ASC
       LIMIT 1`
    );
    if (activeRows[0]) return activeRows[0];
    const [fallbackRows] = await pool.execute(
      `SELECT * FROM matches
       WHERE phase IN ('registration', 'frozen', 'live', 'completed')
          OR status IN ('upcoming', 'ongoing', 'completed')
       ORDER BY
        FIELD(phase, 'registration', 'frozen', 'live', 'completed', 'draft', 'archived'),
        start_time ASC
       LIMIT 1`
    );
    return fallbackRows[0] || null;
  }

  static async createRegistration(matchId, userId, payload) {
    const { teamName, playerName, gameId, phone, address } = payload;
    const [result] = await pool.execute(
      `INSERT INTO match_registrations
      (match_id, user_id, team_name, player_name, game_id, phone, address, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
      ON DUPLICATE KEY UPDATE
      team_name = VALUES(team_name),
      player_name = VALUES(player_name),
      game_id = VALUES(game_id),
      phone = VALUES(phone),
      address = VALUES(address),
      status = 'pending',
      review_note = '',
      reviewed_by = NULL,
      reviewed_at = NULL`,
      [matchId, userId, teamName, playerName, gameId, phone, address]
    );
    return result;
  }

  static async getRegistrationsByMatch(matchId) {
    const [rows] = await pool.execute(
      `SELECT
        mr.*,
        u.username AS applicant_username
      FROM match_registrations mr
      JOIN users u ON u.id = mr.user_id
      WHERE mr.match_id = ?
      ORDER BY mr.created_at DESC`,
      [matchId]
    );
    return rows;
  }

  static async reviewRegistration(matchId, registrationId, status, reviewNote, reviewerId) {
    const [result] = await pool.execute(
      `UPDATE match_registrations
      SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW()
      WHERE id = ? AND match_id = ?`,
      [status, reviewNote || '', reviewerId, registrationId, matchId]
    );
    return result;
  }

  static async freezeMatchRoster(matchId) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute(
        `UPDATE matches
        SET roster_frozen_at = NOW(),
            registration_close_at = IFNULL(registration_close_at, NOW()),
            is_active_registration = 0,
            phase = 'frozen'
        WHERE id = ?`,
        [matchId]
      );
      await connection.execute(
        `UPDATE match_teams SET status = 'completed' WHERE match_id = ? AND status <> 'completed'`,
        [matchId]
      );
      await connection.commit();
      await this.createRosterSnapshot(matchId);
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // 更新比赛信息
  static async update(id, data) {
    const allowedFields = new Set([
      'title',
      'description',
      'start_time',
      'end_time',
      'location',
      'status',
      'phase',
      'registration_open_at',
      'registration_close_at',
      'roster_frozen_at',
      'is_active_registration',
    ]);
    const normalized = {};
    for (const [key, value] of Object.entries(data || {})) {
      if (allowedFields.has(key)) normalized[key] = value;
    }
    const fields = Object.keys(normalized);
    if (fields.length === 0) {
      return { affectedRows: 0 };
    }
    const values = fields.map((field) => normalized[field]);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      if (Number(normalized.is_active_registration) === 1 || normalized.is_active_registration === true) {
        await connection.execute('UPDATE matches SET is_active_registration = 0 WHERE id <> ?', [id]);
      }
      const [result] = await connection.execute(
        `UPDATE matches SET ${setClause} WHERE id = ?`,
        [...values, id]
      );
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async setActiveRegistration(id) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [matchRows] = await connection.execute('SELECT * FROM matches WHERE id = ? FOR UPDATE', [id]);
      if (!matchRows.length) {
        await connection.rollback();
        return { affectedRows: 0 };
      }
      await connection.execute('UPDATE matches SET is_active_registration = 0 WHERE id <> ?', [id]);
      const [result] = await connection.execute(
        `UPDATE matches
         SET is_active_registration = 1,
             status = 'upcoming',
             phase = 'registration',
             roster_frozen_at = NULL,
             registration_open_at = IFNULL(registration_open_at, NOW())
         WHERE id = ?`,
        [id]
      );
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async closeRegistration(id) {
    const [result] = await pool.execute(
      `UPDATE matches
       SET is_active_registration = 0,
           phase = IF(phase = 'registration', 'draft', phase),
           registration_close_at = IFNULL(registration_close_at, NOW())
       WHERE id = ?`,
      [id]
    );
    return result;
  }

  static async logOperation(matchId, matchTeamId, operatorUserId, action, payload = {}) {
    await pool.execute(
      `INSERT INTO match_operation_logs (match_id, match_team_id, operator_user_id, action, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
      [matchId || null, matchTeamId || null, operatorUserId || null, action, toJson(payload)]
    );
  }

  static async createRosterSnapshot(matchId) {
    await pool.execute('DELETE FROM match_roster_snapshots WHERE match_id = ?', [matchId]);
    await pool.execute(
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

  static async getFrozenTeamCount(matchId) {
    const [[row]] = await pool.execute(
      `SELECT COUNT(DISTINCT match_team_id) AS c
       FROM match_roster_snapshots
       WHERE match_id = ?`,
      [matchId]
    );
    return Number(row?.c || 0);
  }

  static async startMatch(matchId) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT * FROM matches WHERE id = ? FOR UPDATE', [matchId]);
      const match = rows[0];
      if (!match) throw new Error('比赛不存在');
      if (match.phase !== 'frozen') throw new Error('只有名单冻结后才能开赛');

      const [[{ c }]] = await connection.execute(
        `SELECT COUNT(DISTINCT match_team_id) AS c
         FROM match_roster_snapshots
         WHERE match_id = ?`,
        [matchId]
      );
      if (Number(c || 0) < 2) throw new Error('至少需要 2 支队伍才能开赛');

      const [result] = await connection.execute(
        `UPDATE matches
         SET phase = 'live',
             status = 'ongoing',
             started_at = NOW()
         WHERE id = ?`,
        [matchId]
      );
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async completeMatch(matchId) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT * FROM matches WHERE id = ? FOR UPDATE', [matchId]);
      const match = rows[0];
      if (!match) throw new Error('比赛不存在');
      if (match.phase !== 'live') throw new Error('只有进行中的比赛才能完成');

      const [[completed]] = await connection.execute(
        "SELECT COUNT(*) AS c FROM match_rounds WHERE match_id = ? AND status = 'completed'",
        [matchId]
      );
      if (Number(completed?.c || 0) < 1) throw new Error('至少需要一个已完成局次才能完成比赛');

      const [[liveRound]] = await connection.execute(
        "SELECT COUNT(*) AS c FROM match_rounds WHERE match_id = ? AND status = 'live'",
        [matchId]
      );
      if (Number(liveRound?.c || 0) > 0) throw new Error('仍有进行中的局次，请先锁定或作废');

      const [result] = await connection.execute(
        `UPDATE matches
         SET phase = 'completed',
             status = 'completed',
             completed_at = NOW()
         WHERE id = ?`,
        [matchId]
      );
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async createRound(matchId, roundNo, mapName, createdBy) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [matches] = await connection.execute('SELECT * FROM matches WHERE id = ? FOR UPDATE', [matchId]);
      const match = matches[0];
      if (!match) throw new Error('比赛不存在');
      if (match.phase !== 'live') throw new Error('只有开赛后才能创建局次');

      const normalizedRoundNo = Number(roundNo);
      if (!Number.isInteger(normalizedRoundNo) || normalizedRoundNo < 1) {
        throw new Error('局次编号必须为正整数');
      }

      const [result] = await connection.execute(
        `INSERT INTO match_rounds (match_id, round_no, map_name, status, created_by)
         VALUES (?, ?, ?, 'pending', ?)`,
        [matchId, normalizedRoundNo, String(mapName || '').trim() || null, createdBy || null]
      );
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      if (error?.code === 'ER_DUP_ENTRY') throw new Error('该局次编号已存在');
      throw error;
    } finally {
      connection.release();
    }
  }

  static async getRounds(matchId) {
    const [rounds] = await pool.execute(
      `SELECT * FROM match_rounds WHERE match_id = ? ORDER BY round_no ASC`,
      [matchId]
    );
    return rounds;
  }

  static async getRoundResults(matchId, roundId) {
    const [rows] = await pool.execute(
      `SELECT * FROM match_round_results
       WHERE match_id = ? AND round_id = ?
       ORDER BY placement ASC`,
      [matchId, roundId]
    );
    return rows;
  }

  static async startRound(matchId, roundId) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [roundRows] = await connection.execute(
        'SELECT * FROM match_rounds WHERE id = ? AND match_id = ? FOR UPDATE',
        [roundId, matchId]
      );
      const round = roundRows[0];
      if (!round) throw new Error('局次不存在');
      if (round.status !== 'pending') throw new Error('只有待开始局次可以开始');

      const [[live]] = await connection.execute(
        "SELECT COUNT(*) AS c FROM match_rounds WHERE match_id = ? AND status = 'live' AND id <> ?",
        [matchId, roundId]
      );
      if (Number(live?.c || 0) > 0) throw new Error('已有进行中的局次');

      const [result] = await connection.execute(
        `UPDATE match_rounds SET status = 'live', started_at = NOW() WHERE id = ? AND match_id = ?`,
        [roundId, matchId]
      );
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async getEligibleSnapshotTeams(matchId) {
    const [rows] = await pool.execute(
      `SELECT DISTINCT match_team_id, team_number, team_name
       FROM match_roster_snapshots
       WHERE match_id = ?
       ORDER BY team_number ASC`,
      [matchId]
    );
    return rows;
  }

  static async saveRoundResults(matchId, roundId, results = [], operatorUserId) {
    if (!Array.isArray(results) || !results.length) throw new Error('results 不能为空');

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [matchRows] = await connection.execute('SELECT * FROM matches WHERE id = ? FOR UPDATE', [matchId]);
      const match = matchRows[0];
      if (!match) throw new Error('比赛不存在');
      if (match.phase !== 'live') throw new Error('只有赛中阶段可以录入成绩');

      const [roundRows] = await connection.execute(
        'SELECT * FROM match_rounds WHERE id = ? AND match_id = ? FOR UPDATE',
        [roundId, matchId]
      );
      const round = roundRows[0];
      if (!round) throw new Error('局次不存在');
      if (['completed', 'voided'].includes(round.status)) throw new Error('该局已锁定或作废，不能修改成绩');

      const [snapshotTeams] = await connection.execute(
        `SELECT DISTINCT match_team_id, team_number, team_name
         FROM match_roster_snapshots
         WHERE match_id = ?`,
        [matchId]
      );
      const teamMap = new Map(snapshotTeams.map((team) => [Number(team.match_team_id), team]));
      const teamCount = teamMap.size;
      if (teamCount < 2) throw new Error('冻结名单中队伍不足');

      const placements = new Set();
      for (const item of results) {
        const teamId = Number(item.matchTeamId || item.match_team_id);
        const placement = Number(item.placement);
        const kills = Number(item.kills || 0);
        const penaltyPoints = Number(item.penaltyPoints || item.penalty_points || 0);

        if (!teamMap.has(teamId)) throw new Error(`队伍 ${teamId} 不在冻结名单中`);
        if (!Number.isInteger(placement) || placement < 1 || placement > teamCount) {
          throw new Error(`队伍 ${teamId} 的排名无效`);
        }
        if (placements.has(placement)) throw new Error(`排名 ${placement} 重复`);
        placements.add(placement);
        if (!Number.isFinite(kills) || kills < 0) throw new Error('淘汰数必须大于等于 0');
        if (!Number.isFinite(penaltyPoints) || penaltyPoints < 0) throw new Error('扣分必须大于等于 0');

        const team = teamMap.get(teamId);
        const score = calculateTeamScore({ placement, kills });
        const totalPoints = score.totalPoints - Math.floor(penaltyPoints);

        await connection.execute(
          `INSERT INTO match_round_results
            (match_id, round_id, match_team_id, team_number, team_name, placement, kills,
             placement_points, kill_points, total_points, penalty_points, remark, is_locked, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
           ON DUPLICATE KEY UPDATE
             team_number = VALUES(team_number),
             team_name = VALUES(team_name),
             placement = VALUES(placement),
             kills = VALUES(kills),
             placement_points = VALUES(placement_points),
             kill_points = VALUES(kill_points),
             total_points = VALUES(total_points),
             penalty_points = VALUES(penalty_points),
             remark = VALUES(remark),
             updated_by = VALUES(updated_by),
             is_locked = 0`,
          [
            matchId,
            roundId,
            teamId,
            team.team_number,
            team.team_name,
            placement,
            Math.floor(kills),
            score.placementPoints,
            score.killPoints,
            totalPoints,
            Math.floor(penaltyPoints),
            String(item.remark || '').trim() || null,
            operatorUserId || null,
            operatorUserId || null,
          ]
        );
      }

      if (round.status === 'pending') {
        await connection.execute(
          "UPDATE match_rounds SET status = 'live', started_at = IFNULL(started_at, NOW()) WHERE id = ? AND match_id = ?",
          [roundId, matchId]
        );
      }

      await connection.commit();
      return { success: true };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async completeRound(matchId, roundId) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [roundRows] = await connection.execute(
        'SELECT * FROM match_rounds WHERE id = ? AND match_id = ? FOR UPDATE',
        [roundId, matchId]
      );
      const round = roundRows[0];
      if (!round) throw new Error('局次不存在');
      if (round.status === 'voided') throw new Error('作废局不能锁定');
      if (round.status === 'completed') throw new Error('局次已锁定');

      const [[teams]] = await connection.execute(
        `SELECT COUNT(DISTINCT match_team_id) AS c FROM match_roster_snapshots WHERE match_id = ?`,
        [matchId]
      );
      const [[results]] = await connection.execute(
        `SELECT COUNT(*) AS c, COUNT(DISTINCT placement) AS p FROM match_round_results WHERE match_id = ? AND round_id = ?`,
        [matchId, roundId]
      );
      if (Number(results?.c || 0) < Number(teams?.c || 0)) throw new Error('仍有队伍未录入成绩');
      if (Number(results?.p || 0) !== Number(results?.c || 0)) throw new Error('排名存在重复');

      const [result] = await connection.execute(
        `UPDATE match_rounds SET status = 'completed', ended_at = NOW() WHERE id = ? AND match_id = ?`,
        [roundId, matchId]
      );
      await connection.execute(
        `UPDATE match_round_results SET is_locked = 1 WHERE match_id = ? AND round_id = ?`,
        [matchId, roundId]
      );

      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async voidRound(matchId, roundId) {
    const [result] = await pool.execute(
      `UPDATE match_rounds SET status = 'voided', ended_at = IFNULL(ended_at, NOW()) WHERE id = ? AND match_id = ?`,
      [roundId, matchId]
    );
    return result;
  }

  static async getLeaderboard(matchId) {
    const [rows] = await pool.execute(
      `SELECT
        s.match_team_id AS matchTeamId,
        MAX(s.team_number) AS teamNumber,
        MAX(s.team_name) AS teamName,
        COALESCE(SUM(r.total_points), 0) AS totalPoints,
        COALESCE(SUM(r.placement_points), 0) AS placementPoints,
        COALESCE(SUM(r.kill_points), 0) AS killPoints,
        COALESCE(SUM(r.penalty_points), 0) AS penaltyPoints,
        COALESCE(SUM(r.kills), 0) AS kills,
        COALESCE(MIN(r.placement), 0) AS bestPlacement,
        COUNT(r.id) AS roundsPlayed
       FROM (
        SELECT DISTINCT match_team_id, team_number, team_name
        FROM match_roster_snapshots
        WHERE match_id = ?
       ) s
       LEFT JOIN match_round_results r ON r.match_team_id = s.match_team_id AND r.match_id = ?
       LEFT JOIN match_rounds mr ON mr.id = r.round_id
       WHERE (r.id IS NULL OR mr.status = 'completed')
       GROUP BY s.match_team_id
       ORDER BY totalPoints DESC, kills DESC, bestPlacement ASC, teamNumber ASC`,
      [matchId, matchId]
    );
    return rows.map((row, index) => ({
      rank: index + 1,
      matchTeamId: row.matchTeamId,
      teamNumber: row.teamNumber,
      teamName: row.teamName,
      totalPoints: Number(row.totalPoints || 0),
      placementPoints: Number(row.placementPoints || 0),
      killPoints: Number(row.killPoints || 0),
      penaltyPoints: Number(row.penaltyPoints || 0),
      kills: Number(row.kills || 0),
      bestPlacement: Number(row.bestPlacement || 0),
      roundsPlayed: Number(row.roundsPlayed || 0),
    }));
  }

  // 删除比赛
  static async delete(id) {
    const [result] = await pool.execute('DELETE FROM matches WHERE id = ?', [id]);
    return result;
  }

  // 获取即将开始的比赛
  static async getUpcoming() {
    const [rows] = await pool.execute(
      'SELECT * FROM matches WHERE status = ? ORDER BY start_time ASC',
      ['upcoming']
    );
    return rows;
  }

  // 获取正在进行的比赛
  static async getOngoing() {
    const [rows] = await pool.execute(
      'SELECT * FROM matches WHERE status = ? ORDER BY start_time ASC',
      ['ongoing']
    );
    return rows;
  }

  // 获取选手卡数据
  static async getPlayerCard() {
    const [rows] = await pool.execute(
      'SELECT * FROM player_cards ORDER BY updated_at DESC LIMIT 1'
    );
    return rows[0] || null;
  }
  
  // 保存选手卡数据
  static async savePlayerCard(data) {
    const { name, gameId, phone, address, company } = data;
    const [result] = await pool.execute(
      `INSERT INTO player_cards (name, game_id, phone, address, company)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       game_id = VALUES(game_id),
       phone = VALUES(phone),
       address = VALUES(address),
       company = VALUES(company),
       updated_at = CURRENT_TIMESTAMP`,
      [name, gameId, phone, address, company]
    );
    return result;
  }
  
  // 获取所有队伍
  static async getAllTeams() {
    const [teams] = await pool.execute('SELECT * FROM teams ORDER BY team_number ASC');
    
    // 为每个队伍获取队员信息
    for (const team of teams) {
      const [players] = await pool.execute(
        'SELECT * FROM team_players WHERE team_id = ? ORDER BY player_index ASC',
        [team.id]
      );
      team.players = players;
    }
    
    return teams;
  }

  static async ensureMatchTeamStructures(matchId) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [[{ c }]] = await connection.execute(
        'SELECT COUNT(*) AS c FROM match_team_players WHERE match_id = ?',
        [matchId]
      );
      if (Number(c) >= this.TEAM_COUNT * this.TEAM_SLOT_COUNT) {
        await connection.commit();
        return;
      }

      for (let i = 1; i <= this.TEAM_COUNT; i += 1) {
        await connection.execute(
          `INSERT IGNORE INTO match_teams (match_id, team_number, team_name, locked, status)
           VALUES (?, ?, ?, true, 'locked')`,
          [matchId, i, `队伍 ${i}`]
        );
      }

      const [teams] = await connection.execute(
        'SELECT id, team_number FROM match_teams WHERE match_id = ? ORDER BY team_number ASC',
        [matchId]
      );
      for (const team of teams) {
        await connection.execute(
          'DELETE FROM match_team_players WHERE match_team_id = ? AND player_index >= ?',
          [team.id, this.TEAM_SLOT_COUNT]
        );
        for (let slot = 0; slot < this.TEAM_SLOT_COUNT; slot += 1) {
          await connection.execute(
            `INSERT IGNORE INTO match_team_players (match_id, match_team_id, player_index)
             VALUES (?, ?, ?)`,
            [matchId, team.id, slot]
          );
        }
      }

      // 兼容当前正在使用的全局报名数据：首次创建赛事队伍时迁移一次。
      const [[{ filled }]] = await connection.execute(
        `SELECT COUNT(*) AS filled
         FROM match_team_players
         WHERE match_id = ? AND user_id IS NOT NULL AND TRIM(user_id) <> ''`,
        [matchId]
      );
      if (Number(filled) === 0) {
        await connection.execute(
          `UPDATE match_teams mt
           JOIN teams t ON t.team_number = mt.team_number
           SET mt.team_name = t.team_name,
               mt.captain_user_id = t.captain_user_id,
               mt.locked = t.locked,
               mt.status = COALESCE(t.status, IF(t.locked, 'locked', 'unlocked')),
               mt.updated_by = t.updated_by
           WHERE mt.match_id = ?`,
          [matchId]
        );
        await connection.execute(
          `UPDATE match_team_players mtp
           JOIN match_teams mt ON mt.id = mtp.match_team_id
           JOIN teams t ON t.team_number = mt.team_number
           JOIN team_players tp ON tp.team_id = t.id AND tp.player_index = mtp.player_index
           SET mtp.user_id = NULLIF(tp.user_id, ''),
               mtp.name = tp.name,
               mtp.game_id = tp.game_id,
               mtp.company = tp.company,
               mtp.is_current_user = tp.is_current_user,
               mtp.player_card_uuid = tp.player_card_uuid
           WHERE mt.match_id = ?`,
          [matchId]
        );
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (error?.code === 'ER_DUP_ENTRY') {
        throw new Error('你已加入其他队伍，不能重复加入');
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  static async hasRosterSnapshots(matchId) {
    const [[row]] = await pool.execute(
      'SELECT COUNT(*) AS c FROM match_roster_snapshots WHERE match_id = ?',
      [matchId]
    );
    return Number(row?.c || 0) > 0;
  }

  /** 冻结后名单以快照为准，避免用户资料变更导致展示漂移 */
  static async getRegistrationMapFromSnapshots(matchId) {
    await this.ensureMatchTeamStructures(matchId);
    const [rows] = await pool.execute(
      `SELECT
        t.id,
        t.match_id,
        t.team_number,
        t.team_name,
        t.captain_user_id,
        t.status,
        t.locked,
        idx.player_index,
        s.user_id AS snap_user_id,
        s.player_name,
        s.game_id,
        s.platform,
        s.real_name,
        s.power_score,
        s.team_name AS snap_team_name
      FROM match_teams t
      CROSS JOIN (
        SELECT 0 AS player_index UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
      ) idx
      LEFT JOIN match_roster_snapshots s
        ON s.match_team_id = t.id
       AND s.match_id = ?
       AND s.player_index = idx.player_index
      WHERE t.match_id = ?
      ORDER BY t.team_number ASC, idx.player_index ASC`,
      [matchId, matchId]
    );

    const teamMap = new Map();
    for (const row of rows) {
      if (!teamMap.has(row.id)) {
        teamMap.set(row.id, {
          id: row.id,
          matchId: row.match_id,
          teamNumber: row.team_number,
          teamName: row.team_name,
          captainUserId: row.captain_user_id ? Number(row.captain_user_id) : null,
          status: row.status || (row.locked ? 'locked' : 'unlocked'),
          slots: [],
        });
      }
      const teamEntry = teamMap.get(row.id);
      if (row.snap_team_name) teamEntry.teamName = row.snap_team_name;

      const uid = row.snap_user_id;
      const hasUid = uid != null && String(uid).trim() !== '' && String(uid).trim() !== '0';
      teamEntry.slots.push({
        slotId: null,
        playerIndex: row.player_index,
        userId: hasUid ? Number(uid) : null,
        name: row.player_name || '',
        gameId: row.game_id || '',
        company: row.platform || '',
        playerCardUuid: '',
        realName: row.real_name || '',
        powerScore: row.power_score != null && row.power_score !== '' ? Number(row.power_score) : null,
      });
    }

    return Array.from(teamMap.values()).map((team) => {
      const slotMap = new Map(team.slots.map((s) => [s.playerIndex, s]));
      const slots = Array.from({ length: this.TEAM_SLOT_COUNT }, (_, idx) => {
        const found = slotMap.get(idx);
        if (found) return found;
        return {
          slotId: null,
          playerIndex: idx,
          userId: null,
          name: '',
          gameId: '',
          company: '',
          playerCardUuid: '',
          realName: '',
          powerScore: null,
        };
      });
      return { ...team, slots };
    });
  }

  static async getRegistrationTeamFromSnapshots(matchId, teamId) {
    await this.ensureMatchTeamStructures(matchId);
    const [rows] = await pool.execute(
      `SELECT
        t.id,
        t.match_id,
        t.team_number,
        t.team_name,
        t.captain_user_id,
        t.status,
        t.locked,
        idx.player_index,
        s.user_id AS snap_user_id,
        s.player_name,
        s.game_id,
        s.platform,
        s.real_name,
        s.power_score,
        s.team_name AS snap_team_name
      FROM match_teams t
      CROSS JOIN (
        SELECT 0 AS player_index UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
      ) idx
      LEFT JOIN match_roster_snapshots s
        ON s.match_team_id = t.id
       AND s.match_id = ?
       AND s.player_index = idx.player_index
      WHERE t.match_id = ? AND t.id = ?
      ORDER BY idx.player_index ASC`,
      [matchId, matchId, teamId]
    );

    if (!rows.length) return null;

    const team = {
      id: rows[0].id,
      matchId: rows[0].match_id,
      teamNumber: rows[0].team_number,
      teamName: rows[0].team_name,
      captainUserId: rows[0].captain_user_id ? Number(rows[0].captain_user_id) : null,
      status: rows[0].status || (rows[0].locked ? 'locked' : 'unlocked'),
      slots: [],
    };

    for (const row of rows) {
      if (row.snap_team_name) team.teamName = row.snap_team_name;
      const uid = row.snap_user_id;
      const hasUid = uid != null && String(uid).trim() !== '' && String(uid).trim() !== '0';
      team.slots.push({
        slotId: null,
        playerIndex: row.player_index,
        userId: hasUid ? Number(uid) : null,
        name: row.player_name || '',
        gameId: row.game_id || '',
        company: row.platform || '',
        playerCardUuid: '',
        realName: row.real_name || '',
        powerScore: row.power_score != null && row.power_score !== '' ? Number(row.power_score) : null,
      });
    }

    const slotMap = new Map(team.slots.map((s) => [s.playerIndex, s]));
    team.slots = Array.from({ length: this.TEAM_SLOT_COUNT }, (_, idx) => {
      const found = slotMap.get(idx);
      if (found) return found;
      return {
        slotId: null,
        playerIndex: idx,
        userId: null,
        name: '',
        gameId: '',
        company: '',
        playerCardUuid: '',
        realName: '',
        powerScore: null,
      };
    });
    return team;
  }

  static async getRegistrationMap(matchId) {
    await this.ensureMatchTeamStructures(matchId);
    const [teams] = await pool.execute(
      `SELECT
        t.id,
        t.match_id,
        t.team_number,
        t.team_name,
        t.captain_user_id,
        t.status,
        t.locked,
        tp.id AS slot_id,
        tp.player_index,
        tp.user_id,
        tp.name,
        tp.game_id,
        tp.company,
        tp.player_card_uuid,
        u.real_name,
        pc.payload_json AS pubg_power_cached_json
      FROM match_teams t
      LEFT JOIN match_team_players tp ON tp.match_team_id = t.id
      LEFT JOIN users u ON u.id = CAST(tp.user_id AS UNSIGNED)
      LEFT JOIN pubg_api_cache pc
        ON pc.user_id = u.id
       AND pc.cache_key = CONCAT(u.pubg_platform, ':', u.pubg_player_id, ':power')
      WHERE t.match_id = ?
      ORDER BY t.team_number ASC, tp.player_index ASC`,
      [matchId]
    );

    const teamMap = new Map();
    for (const row of teams) {
      if (!teamMap.has(row.id)) {
        teamMap.set(row.id, {
          id: row.id,
          matchId: row.match_id,
          teamNumber: row.team_number,
          teamName: row.team_name,
          captainUserId: row.captain_user_id ? Number(row.captain_user_id) : null,
          status: row.status || (row.locked ? 'locked' : 'unlocked'),
          slots: [],
        });
      }

      if (row.slot_id) {
        teamMap.get(row.id).slots.push({
          slotId: row.slot_id,
          playerIndex: row.player_index,
          userId: row.user_id ? Number(row.user_id) : null,
          name: row.name || '',
          gameId: row.game_id || '',
          company: row.company || '',
          playerCardUuid: row.player_card_uuid || '',
          realName: row.real_name || '',
          powerScore: extractPowerScore(row.pubg_power_cached_json),
        });
      }
    }

    return Array.from(teamMap.values()).map((team) => {
      const slotMap = new Map(team.slots.map((s) => [s.playerIndex, s]));
      const slots = Array.from({ length: this.TEAM_SLOT_COUNT }, (_, idx) => {
        const found = slotMap.get(idx);
        if (found) return found;
        return {
          slotId: null,
          playerIndex: idx,
          userId: null,
          name: '',
          gameId: '',
          company: '',
          playerCardUuid: '',
          realName: '',
          powerScore: null,
        };
      });
      return { ...team, slots };
    });
  }

  static async getRegistrationTeam(matchId, teamId) {
    await this.ensureMatchTeamStructures(matchId);
    const [rows] = await pool.execute(
      `SELECT
        t.id,
        t.match_id,
        t.team_number,
        t.team_name,
        t.captain_user_id,
        t.status,
        t.locked,
        tp.id AS slot_id,
        tp.player_index,
        tp.user_id,
        tp.name,
        tp.game_id,
        tp.company,
        tp.player_card_uuid,
        u.real_name,
        pc.payload_json AS pubg_power_cached_json
      FROM match_teams t
      LEFT JOIN match_team_players tp ON tp.match_team_id = t.id
      LEFT JOIN users u ON u.id = CAST(tp.user_id AS UNSIGNED)
      LEFT JOIN pubg_api_cache pc
        ON pc.user_id = u.id
       AND pc.cache_key = CONCAT(u.pubg_platform, ':', u.pubg_player_id, ':power')
      WHERE t.match_id = ? AND t.id = ?
      ORDER BY tp.player_index ASC`,
      [matchId, teamId]
    );

    if (!rows.length) return null;

    const team = {
      id: rows[0].id,
      matchId: rows[0].match_id,
      teamNumber: rows[0].team_number,
      teamName: rows[0].team_name,
      captainUserId: rows[0].captain_user_id ? Number(rows[0].captain_user_id) : null,
      status: rows[0].status || (rows[0].locked ? 'locked' : 'unlocked'),
      slots: [],
    };

    for (const row of rows) {
      if (row.slot_id) {
        team.slots.push({
          slotId: row.slot_id,
          playerIndex: row.player_index,
          userId: row.user_id ? Number(row.user_id) : null,
          name: row.name || '',
          gameId: row.game_id || '',
          company: row.company || '',
          playerCardUuid: row.player_card_uuid || '',
          realName: row.real_name || '',
          powerScore: extractPowerScore(row.pubg_power_cached_json),
        });
      }
    }

    const slotMap = new Map(team.slots.map((s) => [s.playerIndex, s]));
    team.slots = Array.from({ length: this.TEAM_SLOT_COUNT }, (_, idx) => {
      const found = slotMap.get(idx);
      if (found) return found;
      return {
        slotId: null,
        playerIndex: idx,
        userId: null,
        name: '',
        gameId: '',
        company: '',
        playerCardUuid: '',
        realName: '',
        powerScore: null,
      };
    });

    return team;
  }

  static async getCurrentUserTeamSlot(userId) {
    const [rows] = await pool.execute(
      `SELECT tp.id, tp.team_id, tp.player_index
       FROM team_players tp
       WHERE tp.user_id = ?
       LIMIT 1`,
      [String(userId)]
    );
    return rows[0] || null;
  }

  static async getTeamById(teamId) {
    const [rows] = await pool.execute('SELECT * FROM teams WHERE id = ?', [teamId]);
    return rows[0] || null;
  }

  static async getTeamSlot(teamId, playerIndex) {
    const [rows] = await pool.execute(
      'SELECT * FROM team_players WHERE team_id = ? AND player_index = ? LIMIT 1',
      [teamId, playerIndex]
    );
    return rows[0] || null;
  }

  static async updateTeamNameByCaptain(matchId, teamId, teamName, userId) {
    const [result] = await pool.execute(
      'UPDATE match_teams SET team_name = ?, updated_by = ? WHERE match_id = ? AND id = ? AND captain_user_id = ?',
      [teamName, String(userId), matchId, teamId, String(userId)]
    );
    return result;
  }

  static async takeCaptainSlot(matchId, teamId, userId, userData) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existingTeam] = await connection.execute(
        'SELECT * FROM match_teams WHERE match_id = ? AND id = ? FOR UPDATE',
        [matchId, teamId]
      );
      if (!existingTeam.length) throw new Error('队伍不存在');

      const [occupied] = await connection.execute(
        'SELECT id FROM match_team_players WHERE match_id = ? AND user_id = ? LIMIT 1 FOR UPDATE',
        [matchId, String(userId)]
      );
      if (occupied.length) throw new Error('你已加入其他队伍，不能重复加入');

      const [captainSlotRows] = await connection.execute(
        'SELECT * FROM match_team_players WHERE match_id = ? AND match_team_id = ? AND player_index = 0 FOR UPDATE',
        [matchId, teamId]
      );
      const captainSlot = captainSlotRows[0];
      if (!captainSlot) throw new Error('队长位置不存在');
      if (captainSlot.user_id) throw new Error('该队伍队长位已被占用');

      await connection.execute(
        `UPDATE match_team_players
         SET user_id = ?, name = ?, game_id = ?, company = ?, is_current_user = false, player_card_uuid = ?
         WHERE match_id = ? AND match_team_id = ? AND player_index = 0`,
        [String(userId), userData.name, userData.gameId, userData.company || '', userData.uuid || null, matchId, teamId]
      );

      await connection.execute(
        `UPDATE match_teams
         SET captain_user_id = ?, locked = false, status = 'unlocked', updated_by = ?
         WHERE match_id = ? AND id = ?`,
        [String(userId), String(userId), matchId, teamId]
      );

      await connection.commit();
      return { success: true, teamId };
    } catch (error) {
      await connection.rollback();
      if (error?.code === 'ER_DUP_ENTRY') {
        throw new Error('你已加入其他队伍，不能重复加入');
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  static async joinSlot(matchId, teamId, playerIndex, userId, userData) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [teamRows] = await connection.execute(
        'SELECT * FROM match_teams WHERE match_id = ? AND id = ? FOR UPDATE',
        [matchId, teamId]
      );
      if (!teamRows.length) throw new Error('队伍不存在');
      const team = teamRows[0];

      const [alreadyInAnyTeam] = await connection.execute(
        'SELECT id FROM match_team_players WHERE match_id = ? AND user_id = ? LIMIT 1 FOR UPDATE',
        [matchId, String(userId)]
      );
      if (alreadyInAnyTeam.length) throw new Error('你已加入其他队伍，不能重复加入');

      const [slotRows] = await connection.execute(
        'SELECT * FROM match_team_players WHERE match_id = ? AND match_team_id = ? AND player_index = ? FOR UPDATE',
        [matchId, teamId, playerIndex]
      );
      if (!slotRows.length) throw new Error('队伍位置不存在');
      if (slotRows[0].user_id) throw new Error('该位置已被占用');

      if (!team.captain_user_id) throw new Error('该队伍还没有队长，请先成为队长');

      await connection.execute(
        `UPDATE match_team_players
         SET user_id = ?, name = ?, game_id = ?, company = ?, is_current_user = false, player_card_uuid = ?
         WHERE match_id = ? AND match_team_id = ? AND player_index = ?`,
        [String(userId), userData.name, userData.gameId, userData.company || '', userData.uuid || null, matchId, teamId, playerIndex]
      );

      await connection.commit();
      return { success: true };
    } catch (error) {
      await connection.rollback();
      if (error?.code === 'ER_DUP_ENTRY') {
        throw new Error('你已加入其他队伍，不能重复加入');
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  static async removeTeamMember(matchId, teamId, playerIndex, operatorUserId) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [teamRows] = await connection.execute(
        'SELECT * FROM match_teams WHERE match_id = ? AND id = ? FOR UPDATE',
        [matchId, teamId]
      );
      if (!teamRows.length) throw new Error('队伍不存在');
      const team = teamRows[0];

      if (String(team.captain_user_id || '') !== String(operatorUserId)) {
        throw new Error('仅队长可移除队员');
      }
      if (playerIndex === 0) {
        throw new Error('队长位不能直接移除，请先转移队长后再操作');
      }

      const [slotRows] = await connection.execute(
        'SELECT * FROM match_team_players WHERE match_id = ? AND match_team_id = ? AND player_index = ? FOR UPDATE',
        [matchId, teamId, playerIndex]
      );
      if (!slotRows.length) throw new Error('队伍位置不存在');
      if (!slotRows[0].user_id) throw new Error('该位置当前无人');

      await connection.execute(
        `UPDATE match_team_players
         SET user_id = NULL, name = NULL, game_id = NULL, company = NULL, is_current_user = false, player_card_uuid = NULL
         WHERE match_id = ? AND match_team_id = ? AND player_index = ?`,
        [matchId, teamId, playerIndex]
      );

      await connection.commit();
      return { success: true };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async transferCaptain(matchId, teamId, currentCaptainUserId, targetPlayerIndex) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [teamRows] = await connection.execute(
        'SELECT * FROM match_teams WHERE match_id = ? AND id = ? FOR UPDATE',
        [matchId, teamId]
      );
      if (!teamRows.length) throw new Error('队伍不存在');
      const team = teamRows[0];
      if (String(team.captain_user_id || '') !== String(currentCaptainUserId)) {
        throw new Error('仅当前队长可转让队长身份');
      }
      if (!Number.isInteger(targetPlayerIndex) || targetPlayerIndex < 1 || targetPlayerIndex > 4) {
        throw new Error('目标位置必须是 1-4');
      }

      const [targetRows] = await connection.execute(
        'SELECT * FROM match_team_players WHERE match_id = ? AND match_team_id = ? AND player_index = ? FOR UPDATE',
        [matchId, teamId, targetPlayerIndex]
      );
      if (!targetRows.length) throw new Error('目标位置不存在');
      if (!targetRows[0].user_id) throw new Error('目标位置无人，无法转让');

      await connection.execute(
        'UPDATE match_teams SET captain_user_id = ?, updated_by = ? WHERE match_id = ? AND id = ?',
        [String(targetRows[0].user_id), String(currentCaptainUserId), matchId, teamId]
      );

      await connection.commit();
      return { success: true };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async leaveMyTeam(matchId, userId) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT tp.*, t.captain_user_id
         FROM match_team_players tp
         JOIN match_teams t ON t.id = tp.match_team_id
         WHERE tp.match_id = ? AND tp.user_id = ?
         LIMIT 1
         FOR UPDATE`,
        [matchId, String(userId)]
      );
      if (!rows.length) throw new Error('你当前不在任何队伍中');
      const current = rows[0];
      const teamId = current.match_team_id;

      if (String(current.captain_user_id || '') === String(userId)) {
        // user_id 可能存成 ''，IS NOT NULL 仍会命中，需排除空串才算“有队员”
        const [others] = await connection.execute(
          `SELECT COUNT(*) AS c FROM match_team_players
           WHERE match_id = ?
             AND match_team_id = ?
             AND player_index BETWEEN 1 AND 4
             AND user_id IS NOT NULL
             AND TRIM(user_id) <> ''`,
          [matchId, teamId]
        );
        const otherCount = Number(others[0]?.c || 0);
        if (otherCount > 0) {
          throw new Error('你是当前队长，请先转让队长后再退出队伍');
        }
        await connection.execute(
          `UPDATE match_team_players
           SET user_id = NULL, name = NULL, game_id = NULL, company = NULL, is_current_user = false, player_card_uuid = NULL
           WHERE match_id = ? AND match_team_id = ? AND player_index = 0`,
          [matchId, teamId]
        );
        await connection.execute(
          `UPDATE match_teams
           SET captain_user_id = NULL, locked = true, status = 'locked', updated_by = ?
           WHERE match_id = ? AND id = ?`,
          [String(userId), matchId, teamId]
        );
        await connection.commit();
        return { success: true, teamId };
      }

      await connection.execute(
        `UPDATE match_team_players
         SET user_id = NULL, name = NULL, game_id = NULL, company = NULL, is_current_user = false, player_card_uuid = NULL
         WHERE id = ?`,
        [current.id]
      );
      await connection.commit();
      return { success: true, teamId };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  
  // 申领队长
  static async claimCaptain(teamId, userData) {
    const { name, gameId, company, uuid } = userData;
    
    // 开始事务
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      
      // 更新队伍状态
      await connection.execute(
        'UPDATE teams SET locked = false, status = \'unlocked\' WHERE id = ? AND locked = true',
        [teamId]
      );
      
      // 更新队长信息（第一个队员）
      await connection.execute(
        `UPDATE team_players 
         SET name = ?, game_id = ?, company = ?, is_current_user = true, player_card_uuid = ? 
         WHERE team_id = ? AND player_index = 0`,
        [name, gameId, company, uuid, teamId]
      );
      
      await connection.commit();
      return { success: true };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  
  // 加入队伍
  static async joinTeam(teamId, playerIndex, userData) {
    const { name, gameId, company, uuid } = userData;
    
    // 更新队员信息
    const [result] = await pool.execute(
      `UPDATE team_players 
       SET name = ?, game_id = ?, company = ?, is_current_user = true, player_card_uuid = ? 
       WHERE team_id = ? AND player_index = ? AND name IS NULL`,
      [name, gameId, company, uuid, teamId, playerIndex]
    );
    
    return { success: result.affectedRows > 0 };
  }
  
  // 退出队伍
  static async leaveTeam(teamId, playerIndex) {
    // 清空队员信息，不检查 is_current_user，确保能够退出
    const [result] = await pool.execute(
      `UPDATE team_players 
       SET name = NULL, game_id = NULL, company = NULL, is_current_user = false, player_card_uuid = NULL 
       WHERE team_id = ? AND player_index = ?`,
      [teamId, playerIndex]
    );
    
    // 检查队伍是否为空，如果为空则重新锁定
    const [players] = await pool.execute(
      'SELECT * FROM team_players WHERE team_id = ? AND name IS NOT NULL',
      [teamId]
    );
    
    if (players.length === 0) {
      await pool.execute(
        'UPDATE teams SET locked = true, status = \'locked\' WHERE id = ?',
        [teamId]
      );
    }
    
    return { success: result.affectedRows > 0 };
  }
  
  // 锁定队伍（组队完毕）
  static async lockTeam(teamId) {
    const [result] = await pool.execute(
      'UPDATE teams SET status = \'completed\' WHERE id = ?',
      [teamId]
    );
    return { success: result.affectedRows > 0 };
  }
  
  // 解锁队伍
  static async unlockTeam(teamId) {
    const [result] = await pool.execute(
      'UPDATE teams SET status = \'unlocked\' WHERE id = ?',
      [teamId]
    );
    return { success: result.affectedRows > 0 };
  }
  
  // 编辑队伍名称
  static async updateTeamName(teamId, teamName) {
    const [result] = await pool.execute(
      'UPDATE teams SET team_name = ? WHERE id = ?',
      [teamName, teamId]
    );
    return { success: result.affectedRows > 0 };
  }
  
  // 检查队伍状态
  static async checkTeamStatus(teamId) {
    const [rows] = await pool.execute(
      'SELECT * FROM teams WHERE id = ?',
      [teamId]
    );
    return rows[0] || null;
  }
  
  // 生成选手卡唯一标识
  static generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  
  // 保存选手卡数据（带唯一标识）
  static async savePlayerCardWithUUID(data) {
    const { name, gameId, phone, address, company } = data;
    
    // 先检查是否已有选手卡
    const [existingCards] = await pool.execute('SELECT * FROM player_cards LIMIT 1');
    let uuid;
    
    if (existingCards.length > 0) {
      // 如果已有选手卡，使用其UUID
      uuid = existingCards[0].uuid;
    } else {
      // 如果没有，生成新的UUID
      uuid = this.generateUUID();
    }
    
    const [result] = await pool.execute(
      `INSERT INTO player_cards (name, game_id, phone, address, company, uuid)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       game_id = VALUES(game_id),
       phone = VALUES(phone),
       address = VALUES(address),
       company = VALUES(company),
       updated_at = CURRENT_TIMESTAMP`,
      [name, gameId, phone, address, company, uuid]
    );
    
    return { ...result, uuid };
  }
  
  // 通过UUID获取选手卡
  static async getPlayerCardByUUID(uuid) {
    const [rows] = await pool.execute(
      'SELECT * FROM player_cards WHERE uuid = ?',
      [uuid]
    );
    return rows[0] || null;
  }

  // 更新选手名称（编辑 team_players.name）
  static async updatePlayerName(teamId, playerId, name) {
    const [result] = await pool.execute(
      'UPDATE team_players SET name = ? WHERE team_id = ? AND id = ?',
      [name, teamId, playerId]
    );
    return result;
  }

  // 获取用户参与（已完成队伍）的列表
  static async getUserCompletedTeams(userId) {
    // teams.status 表示队伍状态；这里只统计已完成的队伍
    const [rows] = await pool.execute(
      `
      SELECT
        mt.id,
        mt.team_name,
        mt.status,
        mt.created_at,
        mt.updated_at,
        m.id AS match_id,
        m.title AS match_title
      FROM match_team_players mtp
      JOIN match_teams mt ON mtp.match_team_id = mt.id
      JOIN matches m ON mt.match_id = m.id
      WHERE mtp.user_id = ? AND (mt.status = 'completed' OR m.status = 'completed')
      ORDER BY COALESCE(mt.updated_at, m.end_time, m.start_time) DESC
      `,
      [String(userId)]
    );
    return rows;
  }
}

module.exports = MatchModel;