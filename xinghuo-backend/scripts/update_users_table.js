const pool = require('../config/db');

async function updateUsersTable() {
  try {
    console.log('开始更新用户表结构...');
    
    // 连接数据库
    const connection = await pool.getConnection();
    
    try {
      // 添加role字段，默认为'user'
      await connection.execute(
        'ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT \'user\' AFTER avatar'
      );
      
      console.log('用户表结构更新成功，添加了role字段');
      
      // 查看更新后的表结构
      const [result] = await connection.execute('DESCRIBE users');
      console.log('更新后的用户表结构:');
      console.table(result);
      
    } catch (error) {
      if (error.code === 'ER_DUP_FIELDNAME') {
        console.log('role字段已经存在，跳过添加');
      } else {
        console.error('更新用户表结构失败:', error);
        throw error;
      }
    } finally {
      connection.release();
    }
    
  } catch (error) {
    console.error('更新用户表结构时发生错误:', error);
  } finally {
    // 关闭数据库连接池
    await pool.end();
  }
}

// 执行更新操作
updateUsersTable();
