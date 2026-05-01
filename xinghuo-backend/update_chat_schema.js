const pool = require('./config/db');
const fs = require('fs');
const path = require('path');

async function updateSchema() {
  try {
    console.log('开始更新数据库结构...');
    
    // 读取SQL文件
    const sqlPath = path.join(__dirname, 'update_chat_schema.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // 分割SQL语句并执行
    const sqlStatements = sqlContent.split(';').filter(stmt => stmt.trim());
    
    for (const statement of sqlStatements) {
      try {
        await pool.execute(statement);
        console.log('执行SQL语句成功:', statement.substring(0, 100) + '...');
      } catch (error) {
        console.warn('SQL语句执行失败:', error.message);
        // 继续执行其他语句
      }
    }
    
    console.log('数据库结构更新完成！');
  } catch (error) {
    console.error('更新数据库结构失败:', error);
  } finally {
    pool.end();
  }
}

updateSchema();
