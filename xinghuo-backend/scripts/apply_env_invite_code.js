/**
 * 将 .env 中的 INIT_DEFAULT_INVITE_CODE 写入 invite_codes，并停用弱默认码 xinghuo2026。
 * 执行：node scripts/apply_env_invite_code.js
 */
require('dotenv').config();
const pool = require('../config/db');

async function main() {
  const raw = process.env.INIT_DEFAULT_INVITE_CODE;
  const code = raw && String(raw).trim() !== '' && raw !== '0' ? String(raw).trim() : '';
  if (!code) {
    console.error('未配置 INIT_DEFAULT_INVITE_CODE 或为 0，已退出');
    process.exit(1);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO invite_codes (code, remark, max_uses, used_count, is_active)
       VALUES (?, 'INIT_DEFAULT_INVITE_CODE（正式码）', NULL, 0, 1)
       ON DUPLICATE KEY UPDATE is_active = 1, remark = VALUES(remark)`,
      [code]
    );
    if (code !== 'xinghuo2026') {
      await conn.execute(`UPDATE invite_codes SET is_active = 0 WHERE code = ?`, ['xinghuo2026']);
    }
    await conn.commit();
    console.log(JSON.stringify({ ok: true, activeInviteLength: code.length }, null, 2));
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(async (e) => {
  console.error(e?.message || e);
  try {
    await pool.end();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
