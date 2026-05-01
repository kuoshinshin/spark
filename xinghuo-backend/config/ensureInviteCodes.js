/**
 * 服务启动时：确保 invite_codes 表存在；若当前无任何「启用」的邀请码，则自动补齐一条，
 * 避免仅跑 app、未跑 init-db 或生产未配置时出现「邀请码永远无效」。
 */
async function ensureInviteCodes(connection) {
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

  const [[{ c }]] = await connection.execute(
    'SELECT COUNT(*) AS c FROM invite_codes WHERE is_active = 1'
  );
  if (Number(c) > 0) return;

  const inviteDisabled = process.env.INIT_DEFAULT_INVITE_CODE === '0';
  if (inviteDisabled) {
    console.warn(
      '[ensureInviteCodes] 当前无启用邀请码，且 INIT_DEFAULT_INVITE_CODE=0，注册将不可用。请在后台创建邀请码或取消该环境变量限制。'
    );
    return;
  }

  const isProd = process.env.NODE_ENV === 'production';
  const fromEnv =
    process.env.INIT_DEFAULT_INVITE_CODE &&
    process.env.INIT_DEFAULT_INVITE_CODE !== '0' &&
    String(process.env.INIT_DEFAULT_INVITE_CODE).trim();

  const code = fromEnv || (!isProd ? 'xinghuo2026' : null);

  if (!code) {
    console.warn(
      '[ensureInviteCodes] 生产环境未设置 INIT_DEFAULT_INVITE_CODE，且当前无启用邀请码，注册将不可用。请在 .env 中配置 INIT_DEFAULT_INVITE_CODE 或在后台添加邀请码。'
    );
    return;
  }

  await connection.execute(
    `INSERT INTO invite_codes (code, remark, max_uses, used_count, is_active)
     VALUES (?, ?, NULL, 0, 1)
     ON DUPLICATE KEY UPDATE is_active = 1`,
    [code, fromEnv ? 'INIT_DEFAULT_INVITE_CODE（正式码）' : '开发环境默认邀请码']
  );
}

module.exports = ensureInviteCodes;
