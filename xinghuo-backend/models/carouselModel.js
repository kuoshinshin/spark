const pool = require('../config/db');

class CarouselModel {
  // 创建轮播
  static async create(title, subtitle, content, type, buttons) {
    const [result] = await pool.execute(
      'INSERT INTO carousel_slides (title, subtitle, content, type, buttons) VALUES (?, ?, ?, ?, ?)',
      [title, subtitle, content, type, JSON.stringify(buttons)]
    );
    return result;
  }

  // 获取所有轮播
  static async getAll() {
    const [rows] = await pool.execute('SELECT * FROM carousel_slides ORDER BY id ASC');
    return rows;
  }

  // 根据ID获取轮播
  static async getById(id) {
    const [rows] = await pool.execute('SELECT * FROM carousel_slides WHERE id = ?', [id]);
    return rows[0];
  }

  // 更新轮播信息
  static async update(id, data) {
    // 处理buttons字段，确保是JSON格式
    if (data.buttons && typeof data.buttons === 'object') {
      data.buttons = JSON.stringify(data.buttons);
    }
    
    const fields = Object.keys(data);
    if (fields.length === 0) {
      return { affectedRows: 0 };
    }
    const values = Object.values(data);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const [result] = await pool.execute(
      `UPDATE carousel_slides SET ${setClause} WHERE id = ?`,
      [...values, id]
    );
    return result;
  }

  // 删除轮播
  static async delete(id) {
    const [result] = await pool.execute('DELETE FROM carousel_slides WHERE id = ?', [id]);
    return result;
  }
}

module.exports = CarouselModel;