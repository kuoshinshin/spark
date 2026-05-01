const pool = require('./db');

async function initDatabase() {
  let connection;
  try {
    connection = await pool.getConnection();
    
    // 创建用户表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account VARCHAR(50) NOT NULL UNIQUE,
        username VARCHAR(50) NOT NULL,
        real_name VARCHAR(100),
        phone VARCHAR(30),
        address VARCHAR(255),
        password VARCHAR(255) NOT NULL,
        avatar VARCHAR(255),
        role ENUM('user', 'admin', 'superadmin') DEFAULT 'user',
        dark_mode BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    
    // 创建聊天表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS chats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        content TEXT NOT NULL,
        media VARCHAR(255),
        media_type ENUM('image', 'video'),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    
    // 创建比赛表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS matches (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        description TEXT,
        start_time DATETIME NOT NULL,
        end_time DATETIME NOT NULL,
        location VARCHAR(255),
        status ENUM('upcoming', 'ongoing', 'completed') DEFAULT 'upcoming',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    
    // 创建轮播表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS carousel_slides (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        subtitle VARCHAR(100),
        content TEXT,
        type ENUM('text', 'promotion', 'event') DEFAULT 'text',
        buttons TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

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

    const inviteDisabled = process.env.INIT_DEFAULT_INVITE_CODE === '0';
    const inviteFromEnv =
      process.env.INIT_DEFAULT_INVITE_CODE &&
      process.env.INIT_DEFAULT_INVITE_CODE !== '0' &&
      String(process.env.INIT_DEFAULT_INVITE_CODE).trim();
    const isProd = process.env.NODE_ENV === 'production';
    const defaultDevCode = 'xinghuo2026';
    const inviteCode = inviteFromEnv || (!inviteDisabled && !isProd ? defaultDevCode : null);

    if (inviteCode) {
      await connection.execute(
        `INSERT IGNORE INTO invite_codes (code, remark, max_uses, used_count, is_active)
         VALUES (?, '初始化默认邀请码', NULL, 0, 1)`,
        [inviteCode]
      );
    } else if (isProd && !inviteDisabled) {
      console.warn(
        '[init-db] 生产环境已跳过写入默认邀请码。请在后台创建邀请码，或设置环境变量 INIT_DEFAULT_INVITE_CODE=你的码；若明确不需要可设 INIT_DEFAULT_INVITE_CODE=0'
      );
    }

    console.log('数据库表创建成功');
  } catch (error) {
    console.error('数据库初始化失败:', error);
  } finally {
    if (connection) connection.release();
    // 关闭连接池，避免脚本执行完不退出
    try {
      await pool.end();
    } catch (e) {
      // ignore
    }
  }
}

initDatabase();