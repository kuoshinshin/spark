const db = require('../config/db');

async function alterPlayerCardsCharset() {
  try {
    // 修改表字符集
    const alterTableQuery = `
      ALTER TABLE player_cards
      CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `;

    await db.query(alterTableQuery);
    console.log('选手卡表字符集修改成功');

    // 清空现有数据，以便测试新的字符集
    const truncateQuery = 'TRUNCATE TABLE player_cards';
    await db.query(truncateQuery);
    console.log('选手卡表数据已清空');

    // 关闭数据库连接
    await db.end();
  } catch (error) {
    console.error('修改选手卡表字符集失败:', error);
    process.exit(1);
  }
}

alterPlayerCardsCharset();