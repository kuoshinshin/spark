require('dotenv').config();
const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'xinghuo',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// 测试数据库连接
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('数据库连接成功');
    connection.release();
  } catch (error) {
    console.error('数据库连接失败:', error);
    process.exit(1);
  }
}

// 先测试连接
testConnection();

async function createTeamsTable() {
  try {
    // 创建队伍表
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS teams (
        id INT AUTO_INCREMENT PRIMARY KEY,
        team_number INT NOT NULL,
        team_name VARCHAR(255) NOT NULL,
        captain_user_id VARCHAR(255),
        locked BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_team_number (team_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建队员表
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS team_players (
        id INT AUTO_INCREMENT PRIMARY KEY,
        team_id INT NOT NULL,
        player_index INT NOT NULL,
        user_id VARCHAR(255),
        name VARCHAR(255),
        game_id VARCHAR(255),
        company VARCHAR(255),
        is_current_user BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
        UNIQUE KEY unique_team_player (team_id, player_index)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 初始化16支队伍
    for (let i = 1; i <= 16; i++) {
      await pool.execute(
        'INSERT IGNORE INTO teams (team_number, team_name, locked) VALUES (?, ?, ?)',
        [i, `队伍 ${i}`, true]
      );

      // 为每支队伍初始化5个队员位置
      for (let j = 0; j < 5; j++) {
        await pool.execute(
          'INSERT IGNORE INTO team_players (team_id, player_index) VALUES (?, ?)',
          [i, j]
        );
      }
    }

    console.log('队伍和队员表创建成功，已初始化16支队伍');
  } catch (error) {
    console.error('创建队伍和队员表失败:', error);
  } finally {
    pool.end();
  }
}

createTeamsTable();