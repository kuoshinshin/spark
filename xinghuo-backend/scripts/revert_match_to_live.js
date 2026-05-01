require('dotenv').config();
const { guardNotProduction } = require('./_guardNotProduction');
guardNotProduction('revert_match_to_live');
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const matchId = Number(args.matchId || 7);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    throw new Error('请传合法 --matchId');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT id, phase, status FROM matches WHERE id = ? LIMIT 1', [matchId]);
    if (!rows.length) throw new Error(`比赛 ${matchId} 不存在`);

    await conn.execute('DELETE FROM match_round_results WHERE match_id = ?', [matchId]);
    await conn.execute('DELETE FROM match_rounds WHERE match_id = ?', [matchId]);

    await conn.execute(
      `UPDATE matches
       SET phase = 'live',
           status = 'ongoing',
           completed_at = NULL,
           started_at = IFNULL(started_at, NOW())
       WHERE id = ?`,
      [matchId]
    );

    await conn.commit();
    console.log(
      JSON.stringify(
        {
          ok: true,
          matchId,
          before: { phase: rows[0].phase, status: rows[0].status },
          after: { phase: 'live', status: 'ongoing' },
          note: '已删除该局所有局次与成绩，便于重新录入或继续测试',
        },
        null,
        2
      )
    );
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(async (err) => {
  console.error('[revert_match_to_live]', err?.message || err);
  try {
    await pool.end();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
