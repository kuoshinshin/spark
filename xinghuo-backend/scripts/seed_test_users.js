require('dotenv').config();
const { guardNotProduction } = require('./_guardNotProduction');
guardNotProduction('seed_test_users');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function toInt(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return n;
}

function pad3(num) {
  return String(num).padStart(3, '0');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const count = toInt(args.count, 80);
  const startIndex = toInt(args.start, 1);
  const prefix = String(args.prefix || 'test_user_');
  const password = String(args.password || '123456');
  const role = String(args.role || 'user');
  const withPubg = String(args.withPubg || 'true').toLowerCase() !== 'false';

  if (count <= 0) {
    console.log('count <= 0，无需创建');
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const conn = await pool.getConnection();
  let created = 0;
  let skipped = 0;

  try {
    for (let i = 0; i < count; i += 1) {
      const idx = startIndex + i;
      const suffix = pad3(idx);
      const account = `${prefix}${suffix}`;
      const username = `测试用户${suffix}`;
      const email = `${prefix}${suffix}@seed.local`;
      const realName = `测试姓名${suffix}`;
      const phone = `1380000${String(idx).padStart(4, '0').slice(-4)}`;
      const address = `测试地址-${suffix}`;

      const [existing] = await conn.execute('SELECT id FROM users WHERE account = ? LIMIT 1', [account]);
      let userId;

      if (existing.length > 0) {
        skipped += 1;
        userId = existing[0].id;
      } else {
        const [result] = await conn.execute(
          `INSERT INTO users
          (account, username, email, real_name, phone, address, password, role)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [account, username, email, realName, phone, address, hashedPassword, role]
        );
        userId = result.insertId;
        created += 1;
      }

      if (withPubg) {
        const platform = idx % 2 === 0 ? 'steam' : 'kakao';
        const playerId = `seed-${platform}-${suffix}`;
        const playerName = `PUBG_${suffix}`;
        const score = 1200 + (idx % 600);
        const payloadJson = JSON.stringify({
          score,
          tier: score >= 1600 ? 'diamond' : score >= 1400 ? 'platinum' : 'gold',
          source: 'seed_test_users',
          updatedAt: new Date().toISOString(),
        });
        const cacheKey = `${platform}:${playerId}:power`;

        await conn.execute(
          `UPDATE users
           SET pubg_player_name = ?, pubg_platform = ?, pubg_player_id = ?, pubg_bound_at = NOW()
           WHERE id = ?`,
          [playerName, platform, playerId, userId]
        );

        await conn.execute(
          `INSERT INTO pubg_api_cache (user_id, cache_key, payload_json, fetched_at)
           VALUES (?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             payload_json = VALUES(payload_json),
             fetched_at = NOW()`,
          [userId, cacheKey, payloadJson]
        );
      }
    }
  } finally {
    conn.release();
    await pool.end();
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        count,
        startIndex,
        prefix,
        created,
        skipped,
        withPubg,
        defaultPassword: password,
      },
      null,
      2
    )
  );
}

main().catch(async (error) => {
  console.error('[seed_test_users] 执行失败:', error?.message || error);
  try {
    await pool.end();
  } catch (e) {
    // ignore
  }
  process.exit(1);
});
