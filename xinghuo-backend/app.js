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
    await ensureColumn('users', 'real_name', 'ALTER TABLE users ADD COLUMN real_name VARCHAR(100) NULL AFTER username');
    await ensureColumn('users', 'phone', 'ALTER TABLE users ADD COLUMN phone VARCHAR(30) NULL AFTER real_name');
    await ensureColumn('users', 'address', 'ALTER TABLE users ADD COLUMN address VARCHAR(255) NULL AFTER phone');
    await ensureColumn('users', 'pubg_player_name', 'ALTER TABLE users ADD COLUMN pubg_player_name VARCHAR(64) NULL AFTER address');
    await ensureColumn('users', 'pubg_platform', 'ALTER TABLE users ADD COLUMN pubg_platform VARCHAR(20) NULL AFTER pubg_player_name');
    await ensureColumn('users', 'pubg_player_id', 'ALTER TABLE users ADD COLUMN pubg_player_id VARCHAR(64) NULL AFTER pubg_platform');
    await ensureColumn('users', 'pubg_bound_at', 'ALTER TABLE users ADD COLUMN pubg_bound_at DATETIME NULL AFTER pubg_player_id');
    await ensureColumn('users', 'pubg_power_cached_json', 'ALTER TABLE users ADD COLUMN pubg_power_cached_json LONGTEXT NULL AFTER pubg_bound_at');
    await ensureColumn('users', 'pubg_power_cached_at', 'ALTER TABLE users ADD COLUMN pubg_power_cached_at DATETIME NULL AFTER pubg_power_cached_json');
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
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS match_registrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        match_id INT NOT NULL,
        user_id INT NOT NULL,
        team_name VARCHAR(100) NOT NULL,
        player_name VARCHAR(64) NOT NULL,
        game_id VARCHAR(64) NOT NULL,
        phone VARCHAR(30) NOT NULL,
        address VARCHAR(255) NOT NULL,
        status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
        review_note VARCHAR(255) DEFAULT '',
        reviewed_by INT NULL,
        reviewed_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_match_user (match_id, user_id),
        KEY idx_match_status (match_id, status),
        CONSTRAINT fk_match_reg_match_id FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
        CONSTRAINT fk_match_reg_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS match_teams (
        id INT AUTO_INCREMENT PRIMARY KEY,
        match_id INT NOT NULL,
        team_number INT NOT NULL,
        team_name VARCHAR(255) NOT NULL,
        captain_user_id VARCHAR(255) NULL,
        locked BOOLEAN DEFAULT TRUE,
        status ENUM('locked', 'unlocked', 'completed') DEFAULT 'locked',
        updated_by VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_match_team_number (match_id, team_number),
        KEY idx_match_teams_match_id (match_id),
        CONSTRAINT fk_match_teams_match_id FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
      )
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS match_team_players (
        id INT AUTO_INCREMENT PRIMARY KEY,
        match_id INT NOT NULL,
        match_team_id INT NOT NULL,
        player_index INT NOT NULL,
        user_id VARCHAR(255) NULL,
        name VARCHAR(255) NULL,
        game_id VARCHAR(255) NULL,
        company VARCHAR(255) NULL,
        is_current_user BOOLEAN DEFAULT FALSE,
        player_card_uuid VARCHAR(36) NULL,
        joined_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_match_team_player (match_team_id, player_index),
        KEY idx_match_team_players_match_id (match_id),
        KEY idx_match_team_players_team_id (match_team_id),
        CONSTRAINT fk_match_team_players_match_id FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
        CONSTRAINT fk_match_team_players_team_id FOREIGN KEY (match_team_id) REFERENCES match_teams(id) ON DELETE CASCADE
      )
    `);
    if (await tableExists('match_team_players')) {
      await connection.execute("UPDATE match_team_players SET user_id = NULL WHERE user_id IS NOT NULL AND TRIM(user_id) = ''");
      await connection.execute(`
        UPDATE match_team_players mtp
        JOIN (
          SELECT match_id, user_id, MIN(id) AS keep_id
          FROM match_team_players
          WHERE user_id IS NOT NULL AND TRIM(user_id) <> ''
          GROUP BY match_id, user_id
          HAVING COUNT(*) > 1
        ) dup ON dup.match_id = mtp.match_id AND dup.user_id = mtp.user_id AND mtp.id <> dup.keep_id
        SET mtp.user_id = NULL,
            mtp.name = NULL,
            mtp.game_id = NULL,
            mtp.company = NULL,
            mtp.is_current_user = false,
            mtp.player_card_uuid = NULL
      `);
      await ensureIndex(
        'match_team_players',
        'uniq_match_team_players_match_user',
        'ALTER TABLE match_team_players ADD UNIQUE KEY uniq_match_team_players_match_user (match_id, user_id(191))'
      );
    }
    await ensureColumn('matches', 'registration_open_at', 'ALTER TABLE matches ADD COLUMN registration_open_at DATETIME NULL AFTER end_time');
    await ensureColumn('matches', 'registration_close_at', 'ALTER TABLE matches ADD COLUMN registration_close_at DATETIME NULL AFTER registration_open_at');
    await ensureColumn('matches', 'roster_frozen_at', 'ALTER TABLE matches ADD COLUMN roster_frozen_at DATETIME NULL AFTER registration_close_at');
    await ensureColumn('matches', 'phase', "ALTER TABLE matches ADD COLUMN phase ENUM('draft', 'registration', 'frozen', 'live', 'completed', 'archived') NOT NULL DEFAULT 'draft' AFTER status");
    await ensureColumn('matches', 'is_active_registration', 'ALTER TABLE matches ADD COLUMN is_active_registration TINYINT(1) NOT NULL DEFAULT 0 AFTER roster_frozen_at');
    await ensureColumn('matches', 'started_at', 'ALTER TABLE matches ADD COLUMN started_at DATETIME NULL AFTER is_active_registration');
    await ensureColumn('matches', 'completed_at', 'ALTER TABLE matches ADD COLUMN completed_at DATETIME NULL AFTER started_at');
    await ensureColumn('matches', 'archived_at', 'ALTER TABLE matches ADD COLUMN archived_at DATETIME NULL AFTER completed_at');
    await ensureIndex(
      'matches',
      'idx_matches_active_registration',
      'CREATE INDEX idx_matches_active_registration ON matches (is_active_registration, status, start_time)'
    );
    if (await tableExists('team_players')) {
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
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS match_roster_snapshots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        match_id INT NOT NULL,
        match_team_id INT NOT NULL,
        team_number INT NOT NULL,
        team_name VARCHAR(255) NOT NULL,
        player_index INT NOT NULL,
        user_id VARCHAR(255) NULL,
        player_name VARCHAR(255) NULL,
        game_id VARCHAR(255) NULL,
        platform VARCHAR(255) NULL,
        real_name VARCHAR(100) NULL,
        phone VARCHAR(30) NULL,
        address VARCHAR(255) NULL,
        power_score INT NULL,
        snapshotted_at DATETIME NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_snapshot_match_team_slot (match_id, match_team_id, player_index),
        KEY idx_snapshot_match_id (match_id),
        CONSTRAINT fk_snapshot_match_id FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
        CONSTRAINT fk_snapshot_team_id FOREIGN KEY (match_team_id) REFERENCES match_teams(id) ON DELETE CASCADE
      )
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS match_operation_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        match_id INT NULL,
        match_team_id INT NULL,
        operator_user_id INT NULL,
        action VARCHAR(80) NOT NULL,
        payload_json LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY idx_match_operation_match_id (match_id),
        KEY idx_match_operation_team_id (match_team_id),
        KEY idx_match_operation_operator (operator_user_id)
      )
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS match_rounds (
        id INT AUTO_INCREMENT PRIMARY KEY,
        match_id INT NOT NULL,
        round_no INT NOT NULL,
        map_name VARCHAR(80) NULL,
        status ENUM('pending', 'live', 'completed', 'voided') NOT NULL DEFAULT 'pending',
        started_at DATETIME NULL,
        ended_at DATETIME NULL,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_match_round_no (match_id, round_no),
        KEY idx_match_rounds_match_id (match_id),
        CONSTRAINT fk_match_rounds_match_id FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
      )
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS match_round_results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        match_id INT NOT NULL,
        round_id INT NOT NULL,
        match_team_id INT NOT NULL,
        team_number INT NOT NULL,
        team_name VARCHAR(255) NOT NULL,
        placement INT NOT NULL,
        kills INT NOT NULL DEFAULT 0,
        placement_points INT NOT NULL DEFAULT 0,
        kill_points INT NOT NULL DEFAULT 0,
        total_points INT NOT NULL DEFAULT 0,
        penalty_points INT NOT NULL DEFAULT 0,
        remark VARCHAR(255) NULL,
        is_locked TINYINT(1) NOT NULL DEFAULT 0,
        created_by INT NULL,
        updated_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_round_team_result (round_id, match_team_id),
        KEY idx_round_results_match_id (match_id),
        KEY idx_round_results_round_id (round_id),
        CONSTRAINT fk_round_results_match_id FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
        CONSTRAINT fk_round_results_round_id FOREIGN KEY (round_id) REFERENCES match_rounds(id) ON DELETE CASCADE,
        CONSTRAINT fk_round_results_team_id FOREIGN KEY (match_team_id) REFERENCES match_teams(id) ON DELETE CASCADE
      )
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
  const matchRoutes = require('./routes/match');
  const carouselRoutes = require('./routes/carousel');
  const shareRoutes = require('./routes/share');
  const inviteCodeRoutes = require('./routes/inviteCodes');
  const notificationRoutes = require('./routes/notification');

  app.use('/api/auth', authRoutes);
  app.use('/api/invite-codes', inviteCodeRoutes);
  app.use('/api/user', userRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/match', matchRoutes);
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