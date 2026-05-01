const pool = require('./config/db');

async function addAccountField() {
  try {
    console.log('开始添加account字段到users表...');
    
    // 添加account字段
    await pool.execute(
      'ALTER TABLE users ADD COLUMN account VARCHAR(255) NOT NULL UNIQUE AFTER id'
    );
    console.log('成功添加account字段');
    
    // 更新现有数据
    await pool.execute(
      'UPDATE users SET account = CONCAT("user_", id) WHERE account = ""'
    );
    console.log('成功更新现有数据');
    
    console.log('所有操作完成！');
  } catch (error) {
    console.error('执行过程中出错:', error);
  } finally {
    // 关闭连接池
    await pool.end();
  }
}

addAccountField();
