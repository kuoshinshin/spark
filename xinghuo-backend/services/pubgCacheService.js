const pool = require('../config/db');

const inflightMap = new Map();

function makeInflightKey(userId, cacheKey) {
  return `${userId}:${cacheKey}`;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getCacheEntry(userId, cacheKey) {
  const [rows] = await pool.execute(
    `SELECT id, payload_json, fetched_at
     FROM pubg_api_cache
     WHERE user_id = ? AND cache_key = ?
     LIMIT 1`,
    [userId, cacheKey]
  );
  return rows[0] || null;
}

async function saveCacheEntry(userId, cacheKey, payload) {
  await pool.execute(
    `INSERT INTO pubg_api_cache (user_id, cache_key, payload_json, fetched_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       payload_json = VALUES(payload_json),
       fetched_at = NOW(),
       updated_at = NOW()`,
    [userId, cacheKey, JSON.stringify(payload || {})]
  );
}

async function getOrRefresh({
  userId,
  cacheKey,
  ttlMs,
  fetcher,
  allowStaleOnError = true,
}) {
  const entry = await getCacheEntry(userId, cacheKey);
  const now = Date.now();
  if (entry?.fetched_at) {
    const age = now - new Date(entry.fetched_at).getTime();
    if (!Number.isNaN(age) && age < ttlMs) {
      const parsed = safeJsonParse(entry.payload_json);
      if (parsed !== null) return parsed;
    }
  }

  const inflightKey = makeInflightKey(userId, cacheKey);
  const existing = inflightMap.get(inflightKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const fresh = await fetcher();
      await saveCacheEntry(userId, cacheKey, fresh);
      return fresh;
    } catch (error) {
      if (allowStaleOnError && entry?.payload_json) {
        const parsed = safeJsonParse(entry.payload_json);
        if (parsed !== null) return parsed;
      }
      throw error;
    } finally {
      inflightMap.delete(inflightKey);
    }
  })();

  inflightMap.set(inflightKey, promise);
  return promise;
}

async function invalidateUserCache(userId) {
  await pool.execute('DELETE FROM pubg_api_cache WHERE user_id = ?', [userId]);
}

module.exports = {
  getOrRefresh,
  invalidateUserCache,
};

