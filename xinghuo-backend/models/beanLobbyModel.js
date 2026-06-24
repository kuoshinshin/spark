const pool = require('../config/db');
const FIXED_TABLE_COUNT = 12;
const FIXED_TABLE_PREFIX = '豆子桌-';

function toJsonSafe(value) {
  return JSON.stringify(value == null ? {} : value);
}

function toMysqlDatetime(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

class BeanLobbyModel {
  static getFixedTableNames() {
    return Array.from({ length: FIXED_TABLE_COUNT }, (_, idx) => `${FIXED_TABLE_PREFIX}${String(idx + 1).padStart(2, '0')}`);
  }

  static async ensureFixedTables() {
    const names = BeanLobbyModel.getFixedTableNames();
    if (!names.length) return;
    try {
      await pool.execute('ALTER TABLE bean_tables MODIFY COLUMN owner_user_id INT NULL');
    } catch (_) {
      // 启动迁移会正式处理该列；这里仅避免旧库阻塞固定桌初始化。
    }
    const placeholders = names.map(() => '?').join(',');
    const [existingRows] = await pool.execute(
      `SELECT table_name FROM bean_tables WHERE is_archived = 0 AND table_name IN (${placeholders})`,
      names
    );
    const existing = new Set(existingRows.map((row) => row.table_name));
    const missing = names.filter((name) => !existing.has(name));
    if (!missing.length) return;

    for (const name of missing) {
      await pool.execute(
        `INSERT INTO bean_tables (table_name, owner_user_id, status, seat_count, soft_locked, is_archived)
         VALUES (?, NULL, 'waiting', 4, 0, 0)`,
        [name]
      );
    }
  }

  static async listTables() {
    await BeanLobbyModel.ensureFixedTables();
    const fixedNames = BeanLobbyModel.getFixedTableNames();
    const fixedPlaceholders = fixedNames.map(() => '?').join(',');
    const [tables] = await pool.execute(
      `SELECT t.*, owner.username AS owner_username, owner.real_name AS owner_real_name
       FROM bean_tables t
       LEFT JOIN users owner ON owner.id = t.owner_user_id
       WHERE t.is_archived = 0 AND t.table_name IN (${fixedPlaceholders})
       ORDER BY t.table_name ASC`,
      fixedNames
    );
    if (!tables.length) return [];
    const ids = tables.map((t) => t.id);
    const placeholders = ids.map(() => '?').join(',');
    const [players] = await pool.execute(
      `SELECT p.*, u.username, u.real_name, u.avatar, u.pubg_player_name, u.pubg_player_id, u.pubg_platform
       FROM bean_table_players p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.table_id IN (${placeholders}) AND p.is_active = 1
       ORDER BY p.table_id ASC, p.seat_no ASC`,
      ids
    );
    const [scoreRows] = await pool.execute(
      `SELECT s.table_id, sp.user_id, sp.net_beans
       FROM bean_sessions s
       JOIN bean_session_players sp ON sp.session_id = s.id
       WHERE s.table_id IN (${placeholders})
         AND s.id = (
           SELECT t.current_session_id
           FROM bean_tables t
           WHERE t.id = s.table_id
         )`,
      ids
    );
    const scoreMap = new Map();
    scoreRows.forEach((row) => {
      scoreMap.set(`${row.table_id}:${row.user_id}`, Number(row.net_beans || 0));
    });
    const map = new Map();
    players.forEach((p) => {
      if (!map.has(p.table_id)) map.set(p.table_id, []);
      map.get(p.table_id).push({
        id: p.id,
        seatNo: p.seat_no,
        userId: p.user_id,
        role: p.player_role,
        isSubstitute: Boolean(p.is_substitute),
        username: p.username,
        realName: p.real_name,
        avatar: p.avatar,
        pubgPlatform: p.pubg_platform || '',
        pubgPlayerId: p.pubg_player_id || '',
        pubgPlayerName: p.pubg_player_name || '',
        currentScore: scoreMap.get(`${p.table_id}:${p.user_id}`) ?? 0,
      });
    });
    return tables.map((t) => ({
      id: t.id,
      tableName: t.table_name,
      ownerUserId: t.owner_user_id,
      ownerName: t.owner_real_name || t.owner_username || '',
      status: t.status,
      softLocked: Boolean(t.soft_locked),
      currentSessionId: t.current_session_id,
      seatCount: t.seat_count,
      players: (map.get(t.id) || []),
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    }));
  }

  static async findTableById(tableId) {
    const rows = await BeanLobbyModel.listTables();
    return rows.find((row) => Number(row.id) === Number(tableId)) || null;
  }

  static async createTable({ tableName, ownerUserId }) {
    void tableName;
    void ownerUserId;
    return { ok: false, code: 'FIXED_TABLES_ONLY', message: '大厅固定 12 桌，不支持手动创建' };
  }

  static async joinTable({ tableId, userId, preferredSeatNo }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [tables] = await conn.execute(
        `SELECT * FROM bean_tables WHERE id = ? FOR UPDATE`,
        [tableId]
      );
      const table = tables[0];
      if (!table || table.is_archived) {
        await conn.rollback();
        return { ok: false, code: 'TABLE_NOT_FOUND' };
      }
      if (table.status !== 'waiting') {
        await conn.rollback();
        return { ok: false, code: 'TABLE_NOT_JOINABLE' };
      }
      const [exists] = await conn.execute(
        `SELECT id FROM bean_table_players WHERE table_id = ? AND user_id = ? AND is_active = 1 LIMIT 1`,
        [tableId, userId]
      );
      if (exists.length) {
        await conn.rollback();
        return { ok: false, code: 'ALREADY_IN_TABLE' };
      }
      const [actives] = await conn.execute(
        `SELECT id, seat_no FROM bean_table_players WHERE table_id = ? AND is_active = 1 ORDER BY seat_no ASC FOR UPDATE`,
        [tableId]
      );
      if (actives.length >= table.seat_count) {
        await conn.rollback();
        return { ok: false, code: 'TABLE_FULL' };
      }
      let seatNo = 1;
      if (Number.isInteger(preferredSeatNo) && preferredSeatNo >= 1 && preferredSeatNo <= Number(table.seat_count || 4)) {
        const occupied = actives.some((p) => Number(p.seat_no) === Number(preferredSeatNo));
        if (occupied) {
          await conn.rollback();
          return { ok: false, code: 'SEAT_OCCUPIED', message: '该座位已被占用' };
        }
        seatNo = Number(preferredSeatNo);
      } else {
        while (actives.some((p) => Number(p.seat_no) === seatNo)) seatNo += 1;
      }
      const role = actives.length === 0 ? 'owner' : 'player';
      await conn.execute(
        `INSERT INTO bean_table_players
         (table_id, user_id, seat_no, player_role, is_active, joined_at)
         VALUES (?, ?, ?, ?, 1, NOW())`,
        [tableId, userId, seatNo, role]
      );
      if (role === 'owner') {
        await conn.execute(
          `UPDATE bean_tables SET owner_user_id = ? WHERE id = ?`,
          [userId, tableId]
        );
      }
      await conn.commit();
      return { ok: true };
    } catch (error) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw error;
    } finally {
      conn.release();
    }
  }

  static async leaveTable({ tableId, userId }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [tables] = await conn.execute(
        `SELECT * FROM bean_tables WHERE id = ? FOR UPDATE`,
        [tableId]
      );
      const table = tables[0];
      if (!table || table.is_archived) {
        await conn.rollback();
        return { ok: false, code: 'TABLE_NOT_FOUND' };
      }
      if (table.status !== 'waiting') {
        await conn.rollback();
        return { ok: false, code: 'TABLE_NOT_LEAVABLE' };
      }
      const [rows] = await conn.execute(
        `SELECT * FROM bean_table_players WHERE table_id = ? AND user_id = ? AND is_active = 1 FOR UPDATE`,
        [tableId, userId]
      );
      const player = rows[0];
      if (!player) {
        await conn.rollback();
        return { ok: false, code: 'NOT_IN_TABLE' };
      }
      const isOwner = player.player_role === 'owner';
      await conn.execute(
        `UPDATE bean_table_players SET is_active = 0, left_at = NOW() WHERE id = ?`,
        [player.id]
      );
      if (isOwner) {
        const [others] = await conn.execute(
          `SELECT user_id FROM bean_table_players
           WHERE table_id = ? AND is_active = 1
           ORDER BY seat_no ASC, joined_at ASC
           LIMIT 1 FOR UPDATE`,
          [tableId]
        );
        if (others.length) {
          const newOwnerUserId = others[0].user_id;
          await conn.execute(
            `UPDATE bean_tables SET owner_user_id = ? WHERE id = ?`,
            [newOwnerUserId, tableId]
          );
          await conn.execute(
            `UPDATE bean_table_players
             SET player_role = CASE
               WHEN user_id = ? THEN 'owner'
               ELSE 'player'
             END
             WHERE table_id = ? AND is_active = 1`,
            [newOwnerUserId, tableId]
          );
        } else {
          await conn.execute(
            `UPDATE bean_tables SET owner_user_id = NULL WHERE id = ?`,
            [tableId]
          );
        }
      }
      await conn.commit();
      return { ok: true };
    } catch (error) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw error;
    } finally {
      conn.release();
    }
  }

  static async transferOwner({ tableId, currentOwnerUserId, targetUserId }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [tables] = await conn.execute(
        `SELECT * FROM bean_tables WHERE id = ? FOR UPDATE`,
        [tableId]
      );
      const table = tables[0];
      if (!table || table.is_archived) {
        await conn.rollback();
        return { ok: false, code: 'TABLE_NOT_FOUND' };
      }
      if (Number(table.owner_user_id) !== Number(currentOwnerUserId)) {
        await conn.rollback();
        return { ok: false, code: 'ONLY_OWNER' };
      }
      if (Number(currentOwnerUserId) === Number(targetUserId)) {
        await conn.rollback();
        return { ok: false, code: 'SAME_USER' };
      }
      const [targetRows] = await conn.execute(
        `SELECT id FROM bean_table_players
         WHERE table_id = ? AND user_id = ? AND is_active = 1
         LIMIT 1 FOR UPDATE`,
        [tableId, targetUserId]
      );
      if (!targetRows.length) {
        await conn.rollback();
        return { ok: false, code: 'OWNER_TRANSFER_TARGET_INVALID', message: '目标用户不在当前桌内' };
      }
      await conn.execute(
        `UPDATE bean_tables SET owner_user_id = ? WHERE id = ?`,
        [targetUserId, tableId]
      );
      await conn.execute(
        `UPDATE bean_table_players
         SET player_role = CASE
           WHEN user_id = ? THEN 'owner'
           WHEN user_id = ? THEN 'player'
           ELSE player_role
         END
         WHERE table_id = ? AND is_active = 1`,
        [targetUserId, currentOwnerUserId, tableId]
      );
      if (table.current_session_id) {
        await conn.execute(
          `INSERT INTO bean_settlement_logs (session_id, action, operator_user_id, detail_json)
           VALUES (?, 'owner_transfer', ?, ?)`,
          [
            table.current_session_id,
            currentOwnerUserId,
            toJsonSafe({ fromUserId: currentOwnerUserId, toUserId: targetUserId }),
          ]
        );
      }
      await conn.commit();
      return { ok: true };
    } catch (error) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw error;
    } finally {
      conn.release();
    }
  }

  static async startSession({ tableId, ownerUserId }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [tables] = await conn.execute(
        `SELECT * FROM bean_tables WHERE id = ? FOR UPDATE`,
        [tableId]
      );
      const table = tables[0];
      if (!table || table.is_archived) {
        await conn.rollback();
        return { ok: false, code: 'TABLE_NOT_FOUND' };
      }
      if (Number(table.owner_user_id) !== Number(ownerUserId)) {
        await conn.rollback();
        return { ok: false, code: 'ONLY_OWNER' };
      }
      if (table.status !== 'waiting') {
        await conn.rollback();
        return { ok: false, code: 'TABLE_BUSY' };
      }
      const [players] = await conn.execute(
        `SELECT p.*, u.username, u.real_name, u.pubg_platform, u.pubg_player_id, u.pubg_player_name
         FROM bean_table_players p
         LEFT JOIN users u ON u.id = p.user_id
         WHERE p.table_id = ? AND p.is_active = 1
         ORDER BY p.seat_no ASC
         FOR UPDATE`,
        [tableId]
      );
      if (players.length !== 4) {
        await conn.rollback();
        return { ok: false, code: 'PLAYER_COUNT_INVALID', message: '开局前需要 4 人满桌' };
      }
      const missingPubg = players.find((p) => !p.pubg_platform || !p.pubg_player_id);
      if (missingPubg) {
        await conn.rollback();
        return { ok: false, code: 'PUBG_BIND_REQUIRED', message: '桌内存在未绑定 PUBG 账号的玩家' };
      }
      const platforms = [...new Set(players.map((p) => p.pubg_platform))];
      if (platforms.length > 1) {
        await conn.rollback();
        return { ok: false, code: 'PLATFORM_MISMATCH', message: '4 名玩家 PUBG 平台必须一致' };
      }
      const randomSeed = Math.floor(Math.random() * 2147483647);
      const [sessionRes] = await conn.execute(
        `INSERT INTO bean_sessions
         (table_id, status, started_by, started_at, random_seed)
         VALUES (?, 'started', ?, NOW(), ?)`,
        [tableId, ownerUserId, randomSeed]
      );
      const sessionId = sessionRes.insertId;
      for (const p of players) {
        const displayName = p.real_name || p.username || '';
        await conn.execute(
          `INSERT INTO bean_session_players
           (session_id, user_id, seat_no, display_name, pubg_platform, pubg_player_id, pubg_player_name)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [sessionId, p.user_id, p.seat_no, displayName, p.pubg_platform, p.pubg_player_id, p.pubg_player_name || null]
        );
      }
      await conn.execute(
        `UPDATE bean_tables
         SET status = 'playing', soft_locked = 1, current_session_id = ?
         WHERE id = ?`,
        [sessionId, tableId]
      );
      await conn.execute(
        `INSERT INTO bean_settlement_logs (session_id, action, operator_user_id, detail_json)
         VALUES (?, 'session_started', ?, ?)`,
        [sessionId, ownerUserId, toJsonSafe({ tableId, playerCount: players.length })]
      );
      await conn.commit();
      return { ok: true, sessionId };
    } catch (error) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw error;
    } finally {
      conn.release();
    }
  }

  static async substitutePlayer({ tableId, ownerUserId, seatNo, newUserId }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [tables] = await conn.execute('SELECT * FROM bean_tables WHERE id = ? FOR UPDATE', [tableId]);
      const table = tables[0];
      if (!table || table.is_archived) {
        await conn.rollback();
        return { ok: false, code: 'TABLE_NOT_FOUND' };
      }
      if (Number(table.owner_user_id) !== Number(ownerUserId)) {
        await conn.rollback();
        return { ok: false, code: 'ONLY_OWNER' };
      }
      if (table.status !== 'playing' || !table.soft_locked || !table.current_session_id) {
        await conn.rollback();
        return { ok: false, code: 'NOT_SOFT_LOCKED' };
      }

      const [seatRows] = await conn.execute(
        `SELECT * FROM bean_table_players
         WHERE table_id = ? AND seat_no = ? AND is_active = 1
         FOR UPDATE`,
        [tableId, seatNo]
      );
      const oldSeat = seatRows[0];
      if (!oldSeat) {
        await conn.rollback();
        return { ok: false, code: 'SEAT_NOT_FOUND' };
      }
      if (Number(oldSeat.user_id) === Number(newUserId)) {
        await conn.rollback();
        return { ok: false, code: 'SAME_USER' };
      }
      const [already] = await conn.execute(
        `SELECT id FROM bean_table_players
         WHERE table_id = ? AND user_id = ? AND is_active = 1
         LIMIT 1`,
        [tableId, newUserId]
      );
      if (already.length) {
        await conn.rollback();
        return { ok: false, code: 'ALREADY_IN_TABLE' };
      }
      const [newUsers] = await conn.execute(
        `SELECT id, username, real_name, pubg_platform, pubg_player_id, pubg_player_name
         FROM users WHERE id = ?`,
        [newUserId]
      );
      const newUser = newUsers[0];
      if (!newUser || !newUser.pubg_platform || !newUser.pubg_player_id) {
        await conn.rollback();
        return { ok: false, code: 'PUBG_BIND_REQUIRED', message: '替补用户未绑定 PUBG 账号' };
      }
      await conn.execute(
        `UPDATE bean_table_players SET is_active = 0, left_at = NOW() WHERE id = ?`,
        [oldSeat.id]
      );
      await conn.execute(
        `INSERT INTO bean_table_players
         (table_id, user_id, seat_no, player_role, is_active, is_substitute, replaced_user_id, joined_at)
         VALUES (?, ?, ?, 'player', 1, 1, ?, NOW())`,
        [tableId, newUserId, seatNo, oldSeat.user_id]
      );
      await conn.execute(
        `UPDATE bean_session_players
         SET user_id = ?, display_name = ?, pubg_platform = ?, pubg_player_id = ?, pubg_player_name = ?
         WHERE session_id = ? AND seat_no = ?`,
        [
          newUserId,
          newUser.real_name || newUser.username || '',
          newUser.pubg_platform,
          newUser.pubg_player_id,
          newUser.pubg_player_name || null,
          table.current_session_id,
          seatNo,
        ]
      );
      await conn.execute(
        `INSERT INTO bean_settlement_logs (session_id, action, operator_user_id, detail_json)
         VALUES (?, 'substitute', ?, ?)`,
        [
          table.current_session_id,
          ownerUserId,
          toJsonSafe({ seatNo, oldUserId: oldSeat.user_id, newUserId }),
        ]
      );
      await conn.commit();
      return { ok: true, sessionId: table.current_session_id };
    } catch (error) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw error;
    } finally {
      conn.release();
    }
  }

  static async getSessionById(sessionId) {
    const [rows] = await pool.execute(
      `SELECT s.*, t.table_name, t.owner_user_id
       FROM bean_sessions s
       JOIN bean_tables t ON t.id = s.table_id
       WHERE s.id = ?`,
      [sessionId]
    );
    return rows[0] || null;
  }

  static async getSessionPlayers(sessionId) {
    const [rows] = await pool.execute(
      `SELECT p.*, u.username, u.real_name, u.avatar
       FROM bean_session_players p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.session_id = ?
       ORDER BY p.seat_no ASC`,
      [sessionId]
    );
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      seatNo: row.seat_no,
      displayName: row.display_name || row.real_name || row.username || '',
      avatar: row.avatar || null,
      pubgPlatform: row.pubg_platform,
      pubgPlayerId: row.pubg_player_id,
      pubgPlayerName: row.pubg_player_name,
      damage: row.damage,
      kills: row.kills,
      winPlace: row.win_place,
      tail: row.tail,
      teamNo: row.team_no,
      netBeans: row.net_beans,
      sourceConfidence: row.source_confidence,
      manualOverride: Boolean(row.manual_override),
    }));
  }

  static async setSessionPreview({ sessionId, resolvedMatchId, players, summary, status = 'preview' }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `UPDATE bean_sessions
         SET status = ?, resolved_match_id = ?, summary_json = ?, updated_at = NOW()
         WHERE id = ?`,
        [status, resolvedMatchId || null, toJsonSafe(summary), sessionId]
      );
      for (const p of players) {
        await conn.execute(
          `UPDATE bean_session_players
           SET damage = ?, kills = ?, win_place = ?, tail = ?, team_no = ?, net_beans = ?,
               source_confidence = ?, manual_override = ?
           WHERE session_id = ? AND user_id = ?`,
          [
            p.damage ?? null,
            p.kills ?? null,
            p.winPlace ?? null,
            p.tail ?? null,
            p.teamNo ?? null,
            p.netBeans ?? null,
            Number(p.sourceConfidence ?? 1),
            p.manualOverride ? 1 : 0,
            sessionId,
            p.userId,
          ]
        );
      }
      await conn.commit();
      return { ok: true };
    } catch (error) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw error;
    } finally {
      conn.release();
    }
  }

  static async appendLog({ sessionId, action, operatorUserId, detail }) {
    await pool.execute(
      `INSERT INTO bean_settlement_logs (session_id, action, operator_user_id, detail_json)
       VALUES (?, ?, ?, ?)`,
      [sessionId, action, operatorUserId || null, toJsonSafe(detail)]
    );
  }

  static async listLogs(sessionId) {
    const [rows] = await pool.execute(
      `SELECT l.*, u.username, u.real_name
       FROM bean_settlement_logs l
       LEFT JOIN users u ON u.id = l.operator_user_id
       WHERE l.session_id = ?
       ORDER BY l.id ASC`,
      [sessionId]
    );
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      operatorUserId: row.operator_user_id,
      operatorName: row.real_name || row.username || '',
      detail: (() => {
        try {
          return row.detail_json ? JSON.parse(row.detail_json) : {};
        } catch {
          return {};
        }
      })(),
      createdAt: row.created_at,
    }));
  }

  static async confirmSession({ sessionId, operatorUserId }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [sessions] = await conn.execute(`SELECT * FROM bean_sessions WHERE id = ? FOR UPDATE`, [sessionId]);
      const session = sessions[0];
      if (!session) {
        await conn.rollback();
        return { ok: false, code: 'SESSION_NOT_FOUND' };
      }
      if (!['preview', 'matched', 'started'].includes(session.status)) {
        await conn.rollback();
        return { ok: false, code: 'INVALID_STATUS', message: '当前状态不可确认结算' };
      }
      if (Number(session.round_count || 0) < 1) {
        await conn.rollback();
        return { ok: false, code: 'NO_ROUNDS', message: '至少完成一局结算后可确认' };
      }
      await conn.execute(
        `UPDATE bean_sessions SET status = 'settled', settled_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [sessionId]
      );
      await conn.execute(
        `UPDATE bean_tables
         SET status = 'waiting', soft_locked = 0, current_session_id = NULL
         WHERE id = ?`,
        [session.table_id]
      );
      await conn.execute(
        `INSERT INTO bean_settlement_logs (session_id, action, operator_user_id, detail_json)
         VALUES (?, 'confirm', ?, ?)`,
        [sessionId, operatorUserId || null, toJsonSafe({ status: 'settled' })]
      );
      await conn.commit();
      return { ok: true };
    } catch (error) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw error;
    } finally {
      conn.release();
    }
  }

  static async reopenSession({ sessionId, operatorUserId }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [sessions] = await conn.execute(`SELECT * FROM bean_sessions WHERE id = ? FOR UPDATE`, [sessionId]);
      const session = sessions[0];
      if (!session) {
        await conn.rollback();
        return { ok: false, code: 'SESSION_NOT_FOUND' };
      }
      await conn.execute(
        `UPDATE bean_sessions
         SET status = 'preview', settled_at = NULL, updated_at = NOW()
         WHERE id = ?`,
        [sessionId]
      );
      await conn.execute(
        `UPDATE bean_tables
         SET status = 'playing', soft_locked = 1, current_session_id = ?
         WHERE id = ?`,
        [sessionId, session.table_id]
      );
      await conn.execute(
        `INSERT INTO bean_settlement_logs (session_id, action, operator_user_id, detail_json)
         VALUES (?, 'reopen', ?, ?)`,
        [sessionId, operatorUserId || null, toJsonSafe({ status: 'preview' })]
      );
      await conn.commit();
      return { ok: true };
    } catch (error) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw error;
    } finally {
      conn.release();
    }
  }

  static async updateManualPlayers({ sessionId, players, operatorUserId }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const p of players) {
        await conn.execute(
          `UPDATE bean_session_players
           SET damage = ?, kills = ?, win_place = ?, manual_override = 1
           WHERE session_id = ? AND user_id = ?`,
          [p.damage ?? null, p.kills ?? null, p.winPlace ?? null, sessionId, p.userId]
        );
      }
      await conn.execute(
        `INSERT INTO bean_settlement_logs (session_id, action, operator_user_id, detail_json)
         VALUES (?, 'manual_adjust', ?, ?)`,
        [sessionId, operatorUserId || null, toJsonSafe({ players })]
      );
      await conn.commit();
      return { ok: true };
    } catch (error) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw error;
    } finally {
      conn.release();
    }
  }

  static parseJsonField(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  static mapSessionRound(row) {
    return {
      id: row.id,
      roundNo: row.round_no,
      matchId: row.match_id,
      matchCreatedAt: row.match_created_at,
      gameMode: row.game_mode || '',
      matchType: row.match_type || '',
      mapName: row.map_name || '',
      summary: BeanLobbyModel.parseJsonField(row.summary_json, {}),
      players: BeanLobbyModel.parseJsonField(row.players_json, []),
      source: row.source || 'auto',
      createdAt: row.created_at,
    };
  }

  static async listSessionRounds(sessionId) {
    const [rows] = await pool.execute(
      `SELECT * FROM bean_session_rounds WHERE session_id = ? ORDER BY round_no ASC`,
      [sessionId]
    );
    return rows.map(BeanLobbyModel.mapSessionRound);
  }

  static async getSessionRoundById(roundId, sessionId) {
    const [rows] = await pool.execute(
      `SELECT * FROM bean_session_rounds WHERE id = ? AND session_id = ? LIMIT 1`,
      [roundId, sessionId]
    );
    return rows[0] ? BeanLobbyModel.mapSessionRound(rows[0]) : null;
  }

  static async listProcessedMatchIds(sessionId) {
    const [rows] = await pool.execute(
      `SELECT match_id FROM bean_session_rounds WHERE session_id = ?`,
      [sessionId]
    );
    return new Set(rows.map((row) => String(row.match_id)));
  }

  static async listActiveSessionIds() {
    const [rows] = await pool.execute(
      `SELECT current_session_id AS session_id
       FROM bean_tables
       WHERE status = 'playing' AND current_session_id IS NOT NULL AND is_archived = 0`
    );
    return rows.map((row) => Number(row.session_id)).filter((id) => id > 0);
  }

  static async appendSessionRound({
    sessionId,
    matchId,
    matchCreatedAt,
    gameMode,
    matchType,
    mapName,
    summary,
    players,
    source = 'auto',
    operatorUserId = null,
  }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [sessions] = await conn.execute(`SELECT * FROM bean_sessions WHERE id = ? FOR UPDATE`, [sessionId]);
      const session = sessions[0];
      if (!session) {
        await conn.rollback();
        return { ok: false, code: 'SESSION_NOT_FOUND' };
      }
      const roundNo = Number(session.round_count || 0) + 1;
      await conn.execute(
        `INSERT INTO bean_session_rounds
         (session_id, round_no, match_id, match_created_at, game_mode, match_type, map_name, summary_json, players_json, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          roundNo,
          matchId,
          toMysqlDatetime(matchCreatedAt),
          gameMode || null,
          matchType || null,
          mapName || null,
          toJsonSafe(summary),
          toJsonSafe(players),
          source,
        ]
      );
      for (const p of players) {
        const [existing] = await conn.execute(
          `SELECT damage, kills, net_beans FROM bean_session_players WHERE session_id = ? AND user_id = ?`,
          [sessionId, p.userId]
        );
        const prev = existing[0] || {};
        await conn.execute(
          `UPDATE bean_session_players
           SET damage = ?, kills = ?, win_place = ?, tail = ?, team_no = ?, net_beans = ?,
               source_confidence = ?, manual_override = ?
           WHERE session_id = ? AND user_id = ?`,
          [
            Number(prev.damage || 0) + Number(p.damage || 0),
            Number(prev.kills || 0) + Number(p.kills || 0),
            p.winPlace ?? null,
            p.tail ?? null,
            p.teamNo ?? null,
            Number(prev.net_beans || 0) + Number(p.netBeans || 0),
            Number(p.sourceConfidence ?? 1),
            p.manualOverride ? 1 : 0,
            sessionId,
            p.userId,
          ]
        );
      }
      await conn.execute(
        `UPDATE bean_sessions
         SET status = 'preview',
             resolved_match_id = ?,
             summary_json = ?,
             round_count = ?,
             last_polled_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [matchId, toJsonSafe(summary), roundNo, sessionId]
      );
      await conn.execute(
        `INSERT INTO bean_settlement_logs (session_id, action, operator_user_id, detail_json)
         VALUES (?, 'round_auto_settled', ?, ?)`,
        [sessionId, operatorUserId || null, toJsonSafe({ matchId, roundNo, source })]
      );
      await conn.commit();
      return { ok: true, roundNo, matchId };
    } catch (error) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw error;
    } finally {
      conn.release();
    }
  }

  static async touchSessionPoll(sessionId) {
    await pool.execute(
      `UPDATE bean_sessions SET last_polled_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [sessionId]
    );
  }

  static async recalcSessionTotalsFromRounds(sessionId) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const rounds = await BeanLobbyModel.listSessionRounds(sessionId);
      const totals = new Map();
      for (const round of rounds) {
        for (const p of round.players || []) {
          const userId = Number(p.userId);
          if (!totals.has(userId)) {
            totals.set(userId, { damage: 0, kills: 0, netBeans: 0, tail: null, teamNo: null, winPlace: null });
          }
          const item = totals.get(userId);
          item.damage += Number(p.damage || 0);
          item.kills += Number(p.kills || 0);
          item.netBeans += Number(p.netBeans || 0);
          item.tail = p.tail ?? item.tail;
          item.teamNo = p.teamNo ?? item.teamNo;
          item.winPlace = p.winPlace ?? item.winPlace;
        }
      }
      for (const [userId, item] of totals.entries()) {
        await conn.execute(
          `UPDATE bean_session_players
           SET damage = ?, kills = ?, net_beans = ?, tail = ?, team_no = ?, win_place = ?
           WHERE session_id = ? AND user_id = ?`,
          [item.damage, item.kills, item.netBeans, item.tail, item.teamNo, item.winPlace, sessionId, userId]
        );
      }
      const latest = rounds[rounds.length - 1];
      if (latest) {
        await conn.execute(
          `UPDATE bean_sessions
           SET round_count = ?, resolved_match_id = ?, summary_json = ?, status = 'preview', updated_at = NOW()
           WHERE id = ?`,
          [rounds.length, latest.matchId, toJsonSafe(latest.summary), sessionId]
        );
      }
      await conn.commit();
      return { ok: true };
    } catch (error) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw error;
    } finally {
      conn.release();
    }
  }

  static async updateSessionRoundManual({ sessionId, roundId, players, summary, operatorUserId }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute(
        `SELECT id FROM bean_session_rounds WHERE id = ? AND session_id = ? FOR UPDATE`,
        [roundId, sessionId]
      );
      if (!rows.length) {
        await conn.rollback();
        return { ok: false, code: 'ROUND_NOT_FOUND' };
      }
      await conn.execute(
        `UPDATE bean_session_rounds
         SET summary_json = ?, players_json = ?, source = 'manual'
         WHERE id = ?`,
        [toJsonSafe(summary), toJsonSafe(players), roundId]
      );
      await conn.execute(
        `INSERT INTO bean_settlement_logs (session_id, action, operator_user_id, detail_json)
         VALUES (?, 'round_manual_adjust', ?, ?)`,
        [sessionId, operatorUserId || null, toJsonSafe({ roundId, players })]
      );
      await conn.commit();
      await BeanLobbyModel.recalcSessionTotalsFromRounds(sessionId);
      return { ok: true };
    } catch (error) {
      try {
        await conn.rollback();
      } catch (_) {}
      throw error;
    } finally {
      conn.release();
    }
  }
}

module.exports = BeanLobbyModel;
