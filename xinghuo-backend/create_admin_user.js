require('dotenv').config();
const pool = require('./config/db');
const bcrypt = require('bcryptjs');

async function createAdminUser() {
  const isProd = process.env.NODE_ENV === 'production';
  const password = process.env.ADMIN_INITIAL_PASSWORD || (isProd ? null : 'admin123');
  if (!password) {
    console.error('生产环境必须设置环境变量 ADMIN_INITIAL_PASSWORD');
    process.exit(1);
  }

  const email = process.env.ADMIN_EMAIL || (isProd ? null : 'admin@local.dev');
  if (!email) {
    console.error('生产环境必须设置环境变量 ADMIN_EMAIL');
    process.exit(1);
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await pool.execute(
      `INSERT INTO users (account, username, email, password, role)
       VALUES ('admin', '管理员', ?, ?, 'superadmin')
       ON DUPLICATE KEY UPDATE
         username = VALUES(username),
         email = VALUES(email),
         password = VALUES(password),
         role = VALUES(role)`,
      [email, hashedPassword]
    );

    if (isProd) {
      console.log('管理员账号 admin 已创建或已更新（未输出密码）。');
    } else {
      console.log('管理员账号 admin 已创建或已更新。开发环境若未设置 ADMIN_INITIAL_PASSWORD，仍可使用脚本内置弱密码，上线前务必修改。');
    }
  } catch (error) {
    console.error('创建管理员用户失败:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

createAdminUser();
