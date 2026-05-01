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

async function updateTables() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    // 修改队伍表，添加状态字段
    try {
      await connection.execute(
        'ALTER TABLE teams ADD COLUMN status ENUM(\'locked\', \'unlocked\', \'completed\') DEFAULT \'locked\' AFTER locked'
      );
    } catch (e) {
      console.log('队伍表 status 字段已存在');
    }
    try {
      await connection.execute(
        'ALTER TABLE teams ADD COLUMN captain_user_id VARCHAR(255) AFTER team_name'
      );
    } catch (e) {
      console.log('队伍表 captain_user_id 字段已存在');
    }
    try {
      await connection.execute(
        'ALTER TABLE teams ADD COLUMN updated_by VARCHAR(255) AFTER captain_user_id'
      );
    } catch (e) {
      console.log('队伍表 updated_by 字段已存在');
    }
    
    // 修改选手卡表，添加唯一标识
    try {
      await connection.execute(
        'ALTER TABLE player_cards ADD COLUMN uuid VARCHAR(36) UNIQUE AFTER id'
      );
    } catch (e) {
      console.log('选手卡表 uuid 字段已存在');
    }
    try {
      await connection.execute(
        'ALTER TABLE player_cards ADD COLUMN created_by VARCHAR(255) AFTER uuid'
      );
    } catch (e) {
      console.log('选手卡表 created_by 字段已存在');
    }
    try {
      await connection.execute(
        'ALTER TABLE player_cards ADD COLUMN updated_by VARCHAR(255) AFTER created_by'
      );
    } catch (e) {
      console.log('选手卡表 updated_by 字段已存在');
    }
    
    // 修改队员表，添加选手卡唯一标识关联
    try {
      await connection.execute(
        'ALTER TABLE team_players ADD COLUMN player_card_uuid VARCHAR(36) AFTER user_id'
      );
    } catch (e) {
      console.log('队员表 player_card_uuid 字段已存在');
    }
    try {
      await connection.execute(
        'ALTER TABLE team_players ADD COLUMN joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER is_current_user'
      );
    } catch (e) {
      console.log('队员表 joined_at 字段已存在');
    }
    
    // 添加索引
    try {
      await connection.execute(
        'CREATE INDEX idx_teams_status ON teams(status)'
      );
    } catch (e) {
      console.log('idx_teams_status 索引已存在');
    }
    try {
      await connection.execute(
        'CREATE INDEX idx_player_cards_uuid ON player_cards(uuid)'
      );
    } catch (e) {
      console.log('idx_player_cards_uuid 索引已存在');
    }
    try {
      await connection.execute(
        'CREATE INDEX idx_team_players_player_card_uuid ON team_players(player_card_uuid)'
      );
    } catch (e) {
      console.log('idx_team_players_player_card_uuid 索引已存在');
    }
    
    await connection.commit();
    console.log('数据库表结构更新成功');
  } catch (error) {
    await connection.rollback();
    console.error('数据库表结构更新失败:', error);
  } finally {
    connection.release();
    await pool.end();
  }
}

updateTables();