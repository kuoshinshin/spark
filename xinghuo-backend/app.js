const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { rateLimit } = require('./middleware/rateLimit');
const { createServeUploadMedia, isUploadMediaRequest } = require('./middleware/serveUploadMedia');
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
const defaultAvatarFile = path.join(uploadsRoot, 'default-avatar.svg');
fs.mkdirSync(path.join(uploadsRoot, 'avatars'), { recursive: true });
fs.mkdirSync(path.join(uploadsRoot, 'posts'), { recursive: true });

function sendDefaultAvatar(res) {
  res.type('image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.sendFile(defaultAvatarFile);
}

function serveAvatarUpload(req, res) {
  const filename = path.basename(String(req.path || ''));
  if (!filename || filename.includes('..') || !/\.(jpe?g|png|gif|webp|svg)$/i.test(filename)) {
    return sendDefaultAvatar(res);
  }
  const filePath = path.join(uploadsRoot, 'avatars', filename);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  return sendDefaultAvatar(res);
}

app.get('/uploads/avatars/:filename', serveAvatarUpload);
app.head('/uploads/avatars/:filename', serveAvatarUpload);

const serveUploadMedia = createServeUploadMedia(uploadsRoot);
app.get('/api/media', serveUploadMedia);
app.head('/api/media', serveUploadMedia);

// 经 /api 反代访问上传文件，避免生产 Nginx 静态图片规则拦截 /uploads
app.use(
  '/api/uploads',
  express.static(uploadsRoot, {
    maxAge: isProd ? 7 * 24 * 60 * 60 * 1000 : 0,
    fallthrough: false,
  })
);

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
  statusCode: 429,
  skip: (req) => req.path === '/health' || isUploadMediaRequest(req),
}));

app.use((req, res, next) => {
  if (isUploadMediaRequest(req)) {
    return next();
  }
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
    // 旧版社区活动表与 V2 杯赛 events 同名但结构不同
    if (await tableExists('events')) {
      const [cupCols] = await connection.execute(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'events' AND column_name = 'team_count'
         LIMIT 1`
      );
      if (!cupCols.length) {
        await connection.execute('RENAME TABLE events TO legacy_community_events');
        console.log('[migrate] 旧版 events 表已重命名为 legacy_community_events');
      }
    }
    const cupFkParent = async (tableName) => {
      const [refs] = await connection.execute(
        `SELECT REFERENCED_TABLE_NAME AS ref
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
         LIMIT 1`,
        [tableName]
      );
      return refs[0]?.ref || null;
    };
    const isCupEventsTable = async (tableName) => {
      if (!(await tableExists(tableName))) return false;
      const [cols] = await connection.execute(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'team_count'
         LIMIT 1`,
        [tableName]
      );
      return cols.length > 0;
    };
    if (await tableExists('event_team_slots')) {
      const parent = await cupFkParent('event_team_slots');
      if (parent && !(await isCupEventsTable(parent))) {
        await connection.execute('DROP TABLE event_team_slots');
        console.log('[migrate] 已删除旧版 event_team_slots');
      }
    }
    if (await tableExists('event_teams')) {
      const parent = await cupFkParent('event_teams');
      if (parent && !(await isCupEventsTable(parent))) {
        await connection.execute('DROP TABLE event_teams');
        console.log('[migrate] 已删除旧版 event_teams');
      }
    }
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        description TEXT,
        status ENUM('draft', 'registration', 'locked', 'scoring', 'finished') NOT NULL DEFAULT 'draft',
        team_count INT NOT NULL DEFAULT 16,
        slots_per_team INT NOT NULL DEFAULT 5,
        registration_open_at DATETIME NULL,
        registration_close_at DATETIME NULL,
        locked_at DATETIME NULL,
        finished_at DATETIME NULL,
        scoring_config JSON NULL,
        require_pubg_binding TINYINT(1) NOT NULL DEFAULT 1,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_events_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS event_teams (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_id INT NOT NULL,
        team_number INT NOT NULL,
        team_name VARCHAR(64) NOT NULL,
        captain_user_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_event_team_number (event_id, team_number),
        KEY idx_event_teams_event_id (event_id),
        CONSTRAINT fk_event_teams_event_id FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS event_team_slots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_id INT NOT NULL,
        event_team_id INT NOT NULL,
        slot_index INT NOT NULL,
        user_id INT NULL,
        display_name VARCHAR(64) NULL,
        pubg_player_name VARCHAR(64) NULL,
        joined_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_event_team_slot (event_team_id, slot_index),
        UNIQUE KEY uniq_event_user (event_id, user_id),
        KEY idx_event_slots_event_id (event_id),
        CONSTRAINT fk_event_slots_event_id FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        CONSTRAINT fk_event_slots_team_id FOREIGN KEY (event_team_id) REFERENCES event_teams(id) ON DELETE CASCADE,
        CONSTRAINT fk_event_slots_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await ensureColumn(
      'event_team_slots',
      'spark_score',
      'ALTER TABLE event_team_slots ADD COLUMN spark_score INT NULL AFTER pubg_player_name'
    );
    await ensureIndex(
      'event_team_slots',
      'uniq_event_team_slot',
      'ALTER TABLE event_team_slots ADD UNIQUE KEY uniq_event_team_slot (event_team_id, slot_index)'
    );
    try {
      const EventModel = require('./models/eventModel');
      const deduped = await EventModel.dedupeOccupiedSlots();
      if (deduped > 0) {
        console.log(`[migrate] 已清理重复报名槽位：${deduped} 名用户`);
      }
    } catch (error) {
      console.warn('[migrate] 清理重复报名槽位失败:', error?.message || error);
    }
    await ensureIndex(
      'event_team_slots',
      'uniq_event_user',
      'ALTER TABLE event_team_slots ADD UNIQUE KEY uniq_event_user (event_id, user_id)'
    );
    await ensureIndex(
      'event_team_slots',
      'uniq_event_team_user',
      'ALTER TABLE event_team_slots ADD UNIQUE KEY uniq_event_team_user (event_team_id, user_id)'
    );
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS event_rounds (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_id INT NOT NULL,
        round_no INT NOT NULL,
        map_name VARCHAR(80) NULL,
        status ENUM('pending', 'completed') NOT NULL DEFAULT 'pending',
        completed_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_event_round_no (event_id, round_no),
        KEY idx_event_rounds_event_id (event_id),
        CONSTRAINT fk_cup_event_rounds_event_id FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS event_round_results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_id INT NOT NULL,
        round_id INT NOT NULL,
        event_team_id INT NOT NULL,
        placement INT NOT NULL,
        kills INT NOT NULL DEFAULT 0,
        placement_points INT NOT NULL DEFAULT 0,
        kill_points INT NOT NULL DEFAULT 0,
        total_points INT NOT NULL DEFAULT 0,
        updated_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_round_team (round_id, event_team_id),
        KEY idx_round_results_event_id (event_id),
        KEY idx_round_results_round_id (round_id),
        CONSTRAINT fk_cup_round_results_event_id FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        CONSTRAINT fk_cup_round_results_round_id FOREIGN KEY (round_id) REFERENCES event_rounds(id) ON DELETE CASCADE,
        CONSTRAINT fk_cup_round_results_team_id FOREIGN KEY (event_team_id) REFERENCES event_teams(id) ON DELETE CASCADE,
        CONSTRAINT fk_cup_round_results_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS event_basic_info (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_id INT NOT NULL,
        content TEXT NOT NULL,
        placement_points JSON NOT NULL,
        points_per_kill INT NOT NULL DEFAULT 1,
        updated_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_event_basic_info_event_id (event_id),
        KEY idx_event_basic_info_event_id (event_id),
        CONSTRAINT fk_event_basic_info_event_id FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        CONSTRAINT fk_event_basic_info_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    const {
      getDefaultBasicInfoContent,
      getDefaultScoringConfig,
      normalizePlacementPoints,
    } = require('./services/eventScoring');
    const [eventsWithoutBasicInfo] = await connection.execute(`
      SELECT e.id, e.description, e.scoring_config
      FROM events e
      LEFT JOIN event_basic_info b ON b.event_id = e.id
      WHERE b.id IS NULL
    `);
    const defaultScoring = getDefaultScoringConfig();
    for (const eventRow of eventsWithoutBasicInfo) {
      let placementPoints = { ...defaultScoring.placementPoints };
      let pointsPerKill = defaultScoring.pointsPerKill;
      if (eventRow.scoring_config) {
        try {
          const cfg = typeof eventRow.scoring_config === 'string'
            ? JSON.parse(eventRow.scoring_config)
            : eventRow.scoring_config;
          if (cfg?.placementPoints) placementPoints = cfg.placementPoints;
          if (cfg?.pointsPerKill != null) pointsPerKill = cfg.pointsPerKill;
        } catch (_) {}
      }
      const content = String(eventRow.description || '').trim() || getDefaultBasicInfoContent();
      await connection.execute(
        `INSERT INTO event_basic_info (event_id, content, placement_points, points_per_kill)
         VALUES (?, ?, ?, ?)`,
        [
          eventRow.id,
          content,
          JSON.stringify(normalizePlacementPoints(placementPoints)),
          Number(pointsPerKill) || 1,
        ]
      );
    }
    if (eventsWithoutBasicInfo.length) {
      console.log(`[migrate] 已补齐 event_basic_info：${eventsWithoutBasicInfo.length} 条`);
    }
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS event_round_member_results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_id INT NOT NULL,
        round_id INT NOT NULL,
        event_team_id INT NOT NULL,
        slot_index INT NOT NULL,
        user_id INT NULL,
        display_name VARCHAR(64) NULL,
        kills INT NOT NULL DEFAULT 0,
        updated_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_round_team_slot (round_id, event_team_id, slot_index),
        KEY idx_round_member_results_event_id (event_id),
        KEY idx_round_member_results_round_id (round_id),
        KEY idx_round_member_results_team_id (event_team_id),
        CONSTRAINT fk_round_member_results_event_id FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        CONSTRAINT fk_round_member_results_round_id FOREIGN KEY (round_id) REFERENCES event_rounds(id) ON DELETE CASCADE,
        CONSTRAINT fk_round_member_results_team_id FOREIGN KEY (event_team_id) REFERENCES event_teams(id) ON DELETE CASCADE,
        CONSTRAINT fk_round_member_results_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_round_member_results_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS bean_tables (
        id INT AUTO_INCREMENT PRIMARY KEY,
        table_name VARCHAR(64) NOT NULL,
        owner_user_id INT NULL,
        status ENUM('waiting', 'playing', 'settling') NOT NULL DEFAULT 'waiting',
        seat_count INT NOT NULL DEFAULT 4,
        soft_locked TINYINT(1) NOT NULL DEFAULT 0,
        current_session_id INT NULL,
        is_archived TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_bean_tables_status (status),
        KEY idx_bean_tables_owner (owner_user_id),
        CONSTRAINT fk_bean_tables_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    try {
      await connection.execute('ALTER TABLE bean_tables MODIFY COLUMN owner_user_id INT NULL');
    } catch (e) {
      console.warn('[warn] 调整 bean_tables.owner_user_id 为可空失败:', e?.message || e);
    }
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS bean_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        table_id INT NOT NULL,
        status ENUM('started', 'matching', 'matched', 'preview', 'settled', 'failed') NOT NULL DEFAULT 'started',
        started_by INT NOT NULL,
        started_at DATETIME NOT NULL,
        settled_at DATETIME NULL,
        resolved_match_id VARCHAR(128) NULL,
        random_seed BIGINT NULL,
        summary_json JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_bean_sessions_table (table_id),
        KEY idx_bean_sessions_status (status),
        CONSTRAINT fk_bean_sessions_table FOREIGN KEY (table_id) REFERENCES bean_tables(id) ON DELETE CASCADE,
        CONSTRAINT fk_bean_sessions_started_by FOREIGN KEY (started_by) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await ensureColumn(
      'bean_tables',
      'current_session_id',
      'ALTER TABLE bean_tables ADD COLUMN current_session_id INT NULL AFTER soft_locked'
    );
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS bean_table_players (
        id INT AUTO_INCREMENT PRIMARY KEY,
        table_id INT NOT NULL,
        user_id INT NOT NULL,
        seat_no INT NOT NULL,
        player_role ENUM('owner', 'player') NOT NULL DEFAULT 'player',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        is_substitute TINYINT(1) NOT NULL DEFAULT 0,
        replaced_user_id INT NULL,
        joined_at DATETIME NULL,
        left_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_bean_table_players_table (table_id),
        KEY idx_bean_table_players_user (user_id),
        KEY idx_bean_table_players_active (table_id, is_active),
        CONSTRAINT fk_bean_table_players_table FOREIGN KEY (table_id) REFERENCES bean_tables(id) ON DELETE CASCADE,
        CONSTRAINT fk_bean_table_players_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_bean_table_players_replaced_user FOREIGN KEY (replaced_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await ensureIndex(
      'bean_table_players',
      'uniq_bean_table_active_seat',
      'CREATE UNIQUE INDEX uniq_bean_table_active_seat ON bean_table_players(table_id, seat_no, is_active)'
    );
    await ensureIndex(
      'bean_table_players',
      'uniq_bean_table_active_user',
      'CREATE UNIQUE INDEX uniq_bean_table_active_user ON bean_table_players(table_id, user_id, is_active)'
    );
    await connection.execute(`
      UPDATE bean_tables t
      SET t.owner_user_id = NULL
      WHERE t.table_name REGEXP '^豆子桌-[0-9]{2}$'
        AND t.status = 'waiting'
        AND NOT EXISTS (
          SELECT 1
          FROM bean_table_players p
          WHERE p.table_id = t.id AND p.is_active = 1
        )
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS bean_session_players (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id INT NOT NULL,
        user_id INT NOT NULL,
        seat_no INT NOT NULL,
        display_name VARCHAR(100) NULL,
        pubg_platform VARCHAR(20) NULL,
        pubg_player_id VARCHAR(64) NULL,
        pubg_player_name VARCHAR(64) NULL,
        damage DOUBLE NULL,
        kills INT NULL,
        win_place INT NULL,
        tail INT NULL,
        team_no TINYINT NULL,
        net_beans INT NULL,
        source_confidence DOUBLE NULL DEFAULT 0,
        manual_override TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_bean_session_user (session_id, user_id),
        UNIQUE KEY uniq_bean_session_seat (session_id, seat_no),
        KEY idx_bean_session_players_session (session_id),
        CONSTRAINT fk_bean_session_players_session FOREIGN KEY (session_id) REFERENCES bean_sessions(id) ON DELETE CASCADE,
        CONSTRAINT fk_bean_session_players_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS bean_settlement_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id INT NOT NULL,
        action VARCHAR(64) NOT NULL,
        operator_user_id INT NULL,
        detail_json JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY idx_bean_logs_session (session_id),
        CONSTRAINT fk_bean_logs_session FOREIGN KEY (session_id) REFERENCES bean_sessions(id) ON DELETE CASCADE,
        CONSTRAINT fk_bean_logs_operator FOREIGN KEY (operator_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await ensureColumn(
      'bean_sessions',
      'last_polled_at',
      'ALTER TABLE bean_sessions ADD COLUMN last_polled_at DATETIME NULL AFTER summary_json'
    );
    await ensureColumn(
      'bean_sessions',
      'round_count',
      'ALTER TABLE bean_sessions ADD COLUMN round_count INT NOT NULL DEFAULT 0 AFTER last_polled_at'
    );
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS bean_session_rounds (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id INT NOT NULL,
        round_no INT NOT NULL,
        match_id VARCHAR(128) NOT NULL,
        match_created_at DATETIME NULL,
        game_mode VARCHAR(32) NULL,
        match_type VARCHAR(32) NULL,
        map_name VARCHAR(64) NULL,
        summary_json JSON NOT NULL,
        players_json JSON NOT NULL,
        source ENUM('auto', 'manual') NOT NULL DEFAULT 'auto',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_session_match (session_id, match_id),
        KEY idx_session_rounds_session (session_id),
        CONSTRAINT fk_bean_session_rounds_session FOREIGN KEY (session_id) REFERENCES bean_sessions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
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
  const eventRoutes = require('./routes/event');
  const shareRoutes = require('./routes/share');
  const inviteCodeRoutes = require('./routes/inviteCodes');
  const notificationRoutes = require('./routes/notification');
  const beanLobbyRoutes = require('./routes/beanLobby');

  app.use('/api/auth', authRoutes);
  app.use('/api/invite-codes', inviteCodeRoutes);
  app.use('/api/user', userRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/carousel', carouselRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/bean-lobby', beanLobbyRoutes);
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
    try {
      const { startBeanPollScheduler } = require('./services/beanPollService');
      startBeanPollScheduler();
    } catch (error) {
      console.warn('[warn] 豆子局轮询调度启动失败:', error?.message || error);
    }
  });
}

startServer();

module.exports = app;