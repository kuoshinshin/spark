const mysql = require('mysql2/promise');
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

if (!isProd) {
  console.log('数据库连接配置:', {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ? '***' : '',
    database: process.env.DB_NAME || 'xinghuo',
  });
}

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'xinghuo',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 30000,
  charset: 'utf8mb4'
};

const pool = mysql.createPool(dbConfig);

// 测试数据库连接
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    if (!isProd) {
      console.log('数据库连接成功');
    }
    connection.release();
  } catch (error) {
    console.error('数据库连接失败:', error);
    console.error('尝试的连接参数:', {
      host: dbConfig.host,
      user: dbConfig.user,
      database: dbConfig.database,
    });
  }
}

testConnection();

module.exports = pool;