const db = require('../config/db');

async function createPlayerCardsTable() {
  try {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS player_cards (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        game_id VARCHAR(100) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        address VARCHAR(255) NOT NULL,
        company VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `;

    await db.query(createTableQuery);
    console.log('选手卡表创建成功');

    // 关闭数据库连接
    await db.end();
  } catch (error) {
    console.error('创建选手卡表失败:', error);
    process.exit(1);
  }
}

createPlayerCardsTable();