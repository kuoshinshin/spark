/**
 * 已有数据库升级：创建 invite_codes 表并写入默认邀请码（与旧版硬编码 xinghuo2026 对齐）。
 * 执行：node scripts/add_invite_codes_table.js
 */
require('dotenv').config();
const pool = require('../config/db');

async function main() {
  const connection = await pool.getConnection();
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS invite_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(64) NOT NULL UNIQUE,
        remark VARCHAR(255) DEFAULT NULL,
        max_uses INT DEFAULT NULL COMMENT 'NULL 表示不限制次数',
        used_count INT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    const isProd = process.env.NODE_ENV === 'production';
    const codeFromEnv =
      process.env.MIGRATION_DEFAULT_INVITE_CODE &&
      String(process.env.MIGRATION_DEFAULT_INVITE_CODE).trim();
    const code = codeFromEnv || (isProd ? null : 'xinghuo2026');

    if (code) {
      await connection.execute(
        `
      INSERT IGNORE INTO invite_codes (code, remark, max_uses, used_count, is_active)
      VALUES (?, '迁移：默认邀请码', NULL, 0, 1)
    `,
        [code]
      );
    } else {
      console.warn(
        '[add_invite_codes_table] 生产环境未设置 MIGRATION_DEFAULT_INVITE_CODE，已跳过默认邀请码插入（表仍会创建）。'
      );
    }
    console.log('invite_codes 表已就绪（如已存在则跳过建表/重复插入）');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    connection.release();
    try {
      await pool.end();
    } catch (err) {
      /* ignore */
    }
  }
}

main();
