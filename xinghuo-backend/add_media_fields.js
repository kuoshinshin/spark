const pool = require('./config/db');

async function addMediaFieldsToChats() {
  try {
    const connection = await pool.getConnection();
    
    console.log('开始为chats表添加media和media_type字段...');
    
    // 检查并添加media字段
    try {
      const [mediaColumns] = await connection.execute('SHOW COLUMNS FROM chats LIKE \'media\'');
      if (mediaColumns.length === 0) {
        await connection.execute('ALTER TABLE chats ADD COLUMN media VARCHAR(255)');
        console.log('✓ 成功添加media字段');
      } else {
        console.log('⚠️ media字段已存在');
      }
    } catch (error) {
      console.log('⚠️ 检查或添加media字段时出错:', error.message);
    }
    
    // 检查并添加media_type字段
    try {
      const [mediaTypeColumns] = await connection.execute('SHOW COLUMNS FROM chats LIKE \'media_type\'');
      if (mediaTypeColumns.length === 0) {
        await connection.execute('ALTER TABLE chats ADD COLUMN media_type ENUM(\'image\', \'video\')');
        console.log('✓ 成功添加media_type字段');
      } else {
        console.log('⚠️ media_type字段已存在');
      }
    } catch (error) {
      console.log('⚠️ 检查或添加media_type字段时出错:', error.message);
    }
    
    console.log('\n🎉 字段添加完成！');
    connection.release();
  } catch (error) {
    console.error('添加字段失败:', error);
  }
}

addMediaFieldsToChats();
