const pool = require('../config/db');

class UserModel {
  // 创建用户（使用连接池；注册事务请用 createWithConnection）
  static async create(account, username, password, profile = {}) {
    return UserModel.createWithConnection(pool, account, username, password, profile);
  }

  static async createWithConnection(conn, account, username, password, profile = {}) {
    const defaultAvatar = '/default-avatar.svg';
    const realName = typeof profile.realName === 'string' ? profile.realName.trim() : '';
    const phone = typeof profile.phone === 'string' ? profile.phone.trim() : '';
    const address = typeof profile.address === 'string' ? profile.address.trim() : '';
    const rawEmail = typeof profile.email === 'string' ? profile.email.trim() : '';
    const safeLocal = String(account || 'user')
      .trim()
      .replace(/[^a-zA-Z0-9._+-]/g, '_')
      .slice(0, 60) || 'user';
    const email = rawEmail || `${safeLocal}@users.local`;
    const [result] = await conn.execute(
      'INSERT INTO users (account, username, email, password, avatar, real_name, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [account, username, email, password, defaultAvatar, realName, phone, address]
    );
    return result;
  }

  static async findByAccountConn(conn, account) {
    const [rows] = await conn.execute('SELECT * FROM users WHERE account = ?', [account]);
    return rows[0];
  }

  static async findByUsernameConn(conn, username) {
    const [rows] = await conn.execute('SELECT * FROM users WHERE username = ?', [username]);
    return rows[0];
  }

  // 更新用户深色模式设置
  static async updateDarkMode(userId, darkMode) {
    const [result] = await pool.execute(
      'UPDATE users SET dark_mode = ? WHERE id = ?',
      [darkMode, userId]
    );
    return result;
  }

  

  // 根据用户名查找用户
  static async findByUsername(username) {
    const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
    return rows[0];
  }
  
  // 根据账号查找用户
  static async findByAccount(account) {
    const [rows] = await pool.execute('SELECT * FROM users WHERE account = ?', [account]);
    return rows[0];
  }
  
  // 根据ID查找用户
  static async findById(id) {
    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
    return rows[0];
  }

  // 绑定 PUBG 账号
  static async bindPubgAccount(userId, payload) {
    const [result] = await pool.execute(
      `
      UPDATE users
      SET pubg_player_name = ?,
          pubg_platform = ?,
          pubg_player_id = ?,
          pubg_bound_at = NOW(),
          pubg_power_cached_json = NULL,
          pubg_power_cached_at = NULL
      WHERE id = ?
      `,
      [payload.playerName, payload.platform, payload.playerId, userId]
    );
    return result;
  }

  // 解绑 PUBG 账号
  static async unbindPubgAccount(userId) {
    const [result] = await pool.execute(
      `
      UPDATE users
      SET pubg_player_name = NULL,
          pubg_platform = NULL,
          pubg_player_id = NULL,
          pubg_bound_at = NULL,
          pubg_power_cached_json = NULL,
          pubg_power_cached_at = NULL
      WHERE id = ?
      `,
      [userId]
    );
    return result;
  }

  static async getPubgPowerCache(userId) {
    const [rows] = await pool.execute(
      'SELECT pubg_power_cached_json, pubg_power_cached_at FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    return rows[0] || null;
  }

  static async savePubgPowerCache(userId, powerPayload) {
    const payload = JSON.stringify(powerPayload || {});
    const [result] = await pool.execute(
      `UPDATE users
       SET pubg_power_cached_json = ?,
           pubg_power_cached_at = NOW()
       WHERE id = ?`,
      [payload, userId]
    );
    return result;
  }

  // 更新用户信息
  static async update(id, data) {
    const fields = Object.keys(data);
    if (fields.length === 0) {
      return { affectedRows: 0 };
    }
    const values = Object.values(data);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const [result] = await pool.execute(
      `UPDATE users SET ${setClause} WHERE id = ?`,
      [...values, id]
    );
    return result;
  }

  // 获取所有用户
  static async getAll() {
    const [rows] = await pool.execute('SELECT * FROM users');
    return rows;
  }

  // 更新用户角色
  static async updateRole(userId, role) {
    const [result] = await pool.execute(
      'UPDATE users SET role = ? WHERE id = ?',
      [role, userId]
    );
    return result;
  }

  // 根据角色查找用户
  static async getByRole(role) {
    const [rows] = await pool.execute('SELECT * FROM users WHERE role = ?', [role]);
    return rows;
  }

  // 获取用户角色
  static async getRole(userId) {
    const [rows] = await pool.execute('SELECT role FROM users WHERE id = ?', [userId]);
    return rows[0] ? rows[0].role : null;
  }

  // 删除用户
  static async delete(userId) {
    const [result] = await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    return result;
  }

  // 获取用户比赛数据（站内赛事模块重建前返回空统计）
  static async getUserMatches(_userId) {
    return {
      stats: {
        totalMatches: 0,
        totalWins: 0,
        totalKills: 0,
        kdRatio: 0,
        bestRank: 0,
      },
      history: [],
    };
  }
}

module.exports = UserModel;