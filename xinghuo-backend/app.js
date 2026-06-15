const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { rateLimit } = require('./middleware/rateLimit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.JWT_SECRET) {
  throw new Error('缺少 JWT_SECRET 环境变量，服务已停止启动。');
}

if (!process.env.JWT_EXPIRES_IN) {
  process.env.JWT_EXPIRES_IN = '7d';
}

if (isProd) {
  const hops = process.env.TRUST_PROXY_HOPS;
  app.set('trust proxy', hops != null && String(hops).trim() !== '' ? Number(hops) : 1);
}

const corsOptions = (() => {
  if (!isProd) return {};
  const raw = process.env.CORS_ORIGIN;
  if (!raw || !String(raw).trim()) {
    console.warn(
      '[warn] 生产环境未设置 CORS_ORIGIN，CORS 为宽松模式（任意来源）。' +
        ' 建议设置为前端访问域名，多个以英文逗号分隔，例如 https://www.example.com'
    );
    return {};
  }
  const originList = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    origin: originList.length === 1 ? originList[0] : originList,
    credentials: true,
  };
})();

app.use(cors(corsOptions));
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

const uploadsRoot = path.join(__dirname, 'uploads');
fs.mkdirSync(path.join(uploadsRoot, 'avatars'), { recursive: true });
app.use(
  '/uploads',
  express.static(uploadsRoot, {
    maxAge: isProd ? 7 * 24 * 60 * 60 * 1000 : 0,
    fallthrough: false,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: '请求过于频繁，请稍后再试',
  statusCode: 429
}));

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: '服务运行正常' });
});

async function startServer() {
  try {
    const pool = require('./config/db');
    const connection = await pool.getConnection();
    const ensureColumn = async (tableName, columnName, ddl) => {
      const [rows] = await connection.execute(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = ?
           AND column_name = ?
         LIMIT 1`,
        [tableName, columnName]
      );
      if (!rows.length) {
        await connection.execute(ddl);
      }
    };
    const tableExists = async (tableName) => {
      const [rows] = await connection.execute(
        `SELECT 1
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND table_name = ?
         LIMIT 1`,
        [tableName]
      );
      return rows.length > 0;
    };
    const ensureIndex = async (tableName, indexName, ddl) => {
      const [rows] = await connection.execute(
        `SELECT 1
         FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name = ?
           AND index_name = ?
         LIMIT 1`,
        [tableName, indexName]
      );
      if (!rows.length) {
        await connection.execute(ddl);
      }
    };
    // 老版本 init-db 创建的 users 表缺少 email，但注册逻辑会写入 email
    await ensureColumn(
      'users',
      'email',
      "ALTER TABLE users ADD COLUMN email VARCHAR(191) NULL AFTER username"
    );
    // 回填占位邮箱，避免后续加 UNIQUE 时因 NULL/重复失败
    await connection.execute(`
      UPDATE users
      SET email = CONCAT(
        REPLACE(REPLACE(REPLACE(account, '@', '_at_'), ' ', '_'), '/', '_'),
        '@users.local'
      )
      WHERE (email IS NULL OR TRIM(email) = '')
        AND account IS NOT NULL
        AND TRIM(account) <> ''
    `);
    await ensureIndex(
      'users',
      'uniq_users_email',
      'ALTER TABLE users ADD UNIQUE KEY uniq_users_email (email)'
    );
    await ensureColumn('users', 'real_name', 'ALTER TABLE users ADD COLUMN real_name VARCHAR(100) NULL AFTER username');
    await ensureColumn('users', 'phone', 'ALTER TABLE users ADD COLUMN phone VARCHAR(30) NULL AFTER real_name');
    await ensureColumn('users', 'address', 'ALTER TABLE users ADD COLUMN address VARCHAR(255) NULL AFTER phone');
    await ensureColumn('users', 'pubg_player_name', 'ALTER TABLE users ADD COLUMN pubg_player_name VARCHAR(64) NULL AFTER address');
    await ensureColumn('users', 'pubg_platform', 'ALTER TABLE users ADD COLUMN pubg_platform VARCHAR(20) NULL AFTER pubg_player_name');
    await ensureColumn('users', 'pubg_player_id', 'ALTER TABLE users ADD COLUMN pubg_player_id VARCHAR(64) NULL AFTER pubg_platform');
    await ensureColumn('users', 'pubg_bound_at', 'ALTER TABLE users ADD COLUMN pubg_bound_at DATETIME NULL AFTER pubg_player_id');
    await ensureColumn('users', 'pubg_power_cached_json', 'ALTER TABLE users ADD COLUMN pubg_power_cached_json LONGTEXT NULL AFTER pubg_bound_at');
    await ensureColumn('users', 'pubg_power_cached_at', 'ALTER TABLE users ADD COLUMN pubg_power_cached_at DATETIME NULL AFTER pubg_power_cached_json');

    try {
      const [cols] = await connection.execute(
        `SELECT CHARACTER_MAXIMUM_LENGTH AS maxlen, DATA_TYPE AS dt
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'avatar'`
      );
      const row = cols[0];
      const maxlen = row?.maxlen != null ? Number(row.maxlen) : null;
      if (row && String(row.dt || '').toLowerCase() === 'varchar' && maxlen != null && maxlen < 2048) {
        await connection.execute('ALTER TABLE users MODIFY COLUMN avatar VARCHAR(2048) NULL');
        console.log('[db] users.avatar 已扩展为 VARCHAR(2048)');
      }
    } catch (e) {
      console.warn('[warn] 检查/扩展 users.avatar 列失败:', e?.message || e);
    }

    // 社区帖子：评论/点赞（老库常见缺失这些表，会导致聊天列表/通知创建失败）
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS post_comments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        post_id INT NOT NULL,
        parent_id INT NULL,
        user_id INT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_post_comments_post_id (post_id),
        INDEX idx_post_comments_parent_id (parent_id),
        CONSTRAINT fk_post_comments_post_id FOREIGN KEY (post_id) REFERENCES chats(id) ON DELETE CASCADE,
        CONSTRAINT fk_post_comments_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_post_comments_parent_id FOREIGN KEY (parent_id) REFERENCES post_comments(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS post_likes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        post_id INT NOT NULL,
        user_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_post_like (post_id, user_id),
        CONSTRAINT fk_post_likes_post_id FOREIGN KEY (post_id) REFERENCES chats(id) ON DELETE CASCADE,
        CONSTRAINT fk_post_likes_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS comment_likes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        comment_id INT NOT NULL,
        user_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_comment_like (comment_id, user_id),
        CONSTRAINT fk_comment_likes_comment_id FOREIGN KEY (comment_id) REFERENCES post_comments(id) ON DELETE CASCADE,
        CONSTRAINT fk_comment_likes_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS comment_dislikes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        comment_id INT NOT NULL,
        user_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_comment_dislike (comment_id, user_id),
        CONSTRAINT fk_comment_dislikes_comment_id FOREIGN KEY (comment_id) REFERENCES post_comments(id) ON DELETE CASCADE,
        CONSTRAINT fk_comment_dislikes_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 组队（旧功能）：用户统计接口会查询 teams/team_players
    await connection.execute(`
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

    await connection.execute(`
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
        CONSTRAINT fk_team_players_team_id FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
        UNIQUE KEY unique_team_player (team_id, player_index)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await ensureColumn(
      'teams',
      'status',
      "ALTER TABLE teams ADD COLUMN status ENUM('locked', 'unlocked', 'completed') DEFAULT 'locked' AFTER locked"
    );
    await ensureIndex(
      'teams',
      'idx_teams_status',
      'CREATE INDEX idx_teams_status ON teams(status)'
    );

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS pubg_api_cache (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        cache_key VARCHAR(191) NOT NULL,
        payload_json LONGTEXT NOT NULL,
        fetched_at DATETIME NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_cache_key (user_id, cache_key),
        KEY idx_user_fetched_at (user_id, fetched_at),
        CONSTRAINT fk_pubg_cache_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await connection.execute(`
      INSERT IGNORE INTO pubg_api_cache (user_id, cache_key, payload_json, fetched_at)
      SELECT
        id,
        CONCAT(pubg_platform, ':', pubg_player_id, ':power'),
        pubg_power_cached_json,
        IFNULL(pubg_power_cached_at, NOW())
      FROM users
      WHERE pubg_platform IS NOT NULL
        AND pubg_player_id IS NOT NULL
        AND pubg_power_cached_json IS NOT NULL
    `);
    if (await tableExists('team_players')) {
      await ensureColumn(
        'team_players',
        'player_card_uuid',
        'ALTER TABLE team_players ADD COLUMN player_card_uuid VARCHAR(36) NULL AFTER user_id'
      );
      await ensureColumn(
        'team_players',
        'joined_at',
        'ALTER TABLE team_players ADD COLUMN joined_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP AFTER is_current_user'
      );
      await connection.execute("UPDATE team_players SET user_id = NULL WHERE user_id IS NOT NULL AND TRIM(user_id) = ''");
      await connection.execute(`
        UPDATE team_players tp
        JOIN (
          SELECT user_id, MIN(id) AS keep_id
          FROM team_players
          WHERE user_id IS NOT NULL AND TRIM(user_id) <> ''
          GROUP BY user_id
          HAVING COUNT(*) > 1
        ) dup ON dup.user_id = tp.user_id AND tp.id <> dup.keep_id
        SET tp.user_id = NULL,
            tp.name = NULL,
            tp.game_id = NULL,
            tp.company = NULL,
            tp.is_current_user = false,
            tp.player_card_uuid = NULL
      `);
      await ensureIndex(
        'team_players',
        'uniq_team_players_user_id',
        'ALTER TABLE team_players ADD UNIQUE KEY uniq_team_players_user_id (user_id(191))'
      );
    }
    const ensureInviteCodes = require('./config/ensureInviteCodes');
    await ensureInviteCodes(connection);
    connection.release();
  } catch (e) {
    console.error('[fatal] 数据库连接失败，服务将停止启动：', e?.message || e);
    process.exit(1);
  }

  // 始终只挂真实路由（移除内存 mock 降级）
  const authRoutes = require('./routes/auth');
  const userRoutes = require('./routes/user');
  const chatRoutes = require('./routes/chat');
  const carouselRoutes = require('./routes/carousel');
  const shareRoutes = require('./routes/share');
  const inviteCodeRoutes = require('./routes/inviteCodes');
  const notificationRoutes = require('./routes/notification');

  app.use('/api/auth', authRoutes);
  app.use('/api/invite-codes', inviteCodeRoutes);
  app.use('/api/user', userRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/carousel', carouselRoutes);
  app.use('/api/share', shareRoutes);
  app.use('/api/notifications', notificationRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });

  app.use((err, req, res, next) => {
    console.error('错误:', err);
    res.status(500).json({ error: '服务器内部错误' });
  });

  app.listen(PORT, () => {
    console.log(`服务器已监听端口 ${PORT}（NODE_ENV=${process.env.NODE_ENV || 'undefined'}）`);
    if (!isProd) {
      console.log(`本地访问: http://localhost:${PORT}`);
      console.log(`健康检查: http://localhost:${PORT}/health`);
    }
  });
}

startServer();

module.exports = app;