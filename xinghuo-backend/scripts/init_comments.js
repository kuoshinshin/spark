const pool = require('../config/db');
const fs = require('fs');
const path = require('path');

async function initComments() {
  try {
    // 读取SQL文件
    const sqlPath = path.join(__dirname, '../config/init_comments.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // 分割SQL语句
    const sqlStatements = sqlContent.split(';').filter(statement => statement.trim() !== '');
    
    // 执行每条SQL语句
    for (const statement of sqlStatements) {
      await pool.execute(statement);
      console.log('执行SQL语句成功:', statement.substring(0, 50) + '...');
    }
    
    console.log('评论相关数据库初始化成功！');
  } catch (error) {
    console.error('评论相关数据库初始化失败:', error);
  } finally {
    // 关闭数据库连接
    await pool.end();
  }
}

initComments();
