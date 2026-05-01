const pool = require('../config/db');

class InviteCodeModel {
  static async listAll() {
    const [rows] = await pool.execute(
      'SELECT id, code, remark, max_uses, used_count, is_active, created_at, updated_at FROM invite_codes ORDER BY id DESC'
    );
    return rows;
  }

  static async findById(id) {
    const [rows] = await pool.execute('SELECT * FROM invite_codes WHERE id = ?', [id]);
    return rows[0];
  }

  /** 事务内：按邀请码锁定有效行（用于注册扣次） */
  static async findActiveByCodeForUpdate(conn, code) {
    const trimmed = (code || '').trim();
    if (!trimmed) return null;
    const [rows] = await conn.execute(
      `SELECT * FROM invite_codes WHERE code = ? AND is_active = 1 LIMIT 1 FOR UPDATE`,
      [trimmed]
    );
    return rows[0];
  }

  static async incrementUsed(conn, id) {
    const [result] = await conn.execute(
      'UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ?',
      [id]
    );
    return result;
  }

  static async create({ code, remark, max_uses, is_active }) {
    const [result] = await pool.execute(
      `INSERT INTO invite_codes (code, remark, max_uses, is_active) VALUES (?, ?, ?, ?)`,
      [
        String(code).trim(),
        remark != null && String(remark).trim() !== '' ? String(remark).trim() : null,
        max_uses === undefined || max_uses === '' ? null : Number(max_uses),
        is_active === undefined || is_active === null ? 1 : is_active ? 1 : 0,
      ]
    );
    return result;
  }

  static async update(id, { code, remark, max_uses, is_active }) {
    const fields = [];
    const values = [];
    if (code !== undefined) {
      fields.push('code = ?');
      values.push(String(code).trim());
    }
    if (remark !== undefined) {
      fields.push('remark = ?');
      values.push(remark != null && String(remark).trim() !== '' ? String(remark).trim() : null);
    }
    if (max_uses !== undefined) {
      fields.push('max_uses = ?');
      values.push(max_uses === '' || max_uses === null ? null : Number(max_uses));
    }
    if (is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(is_active ? 1 : 0);
    }
    if (!fields.length) return { affectedRows: 0 };
    values.push(id);
    const [result] = await pool.execute(
      `UPDATE invite_codes SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
    return result;
  }

  static async delete(id) {
    const [result] = await pool.execute('DELETE FROM invite_codes WHERE id = ?', [id]);
    return result;
  }
}

module.exports = InviteCodeModel;
