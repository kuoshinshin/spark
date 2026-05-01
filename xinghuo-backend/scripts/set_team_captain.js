require('dotenv').config();
const { guardNotProduction } = require('./_guardNotProduction');
guardNotProduction('set_team_captain');
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
  const account = String(args.account || '').trim();
  const matchId = Number(args.matchId || 0);
  const teamNumber = Number(args.teamNumber || 1);

  if (!account) throw new Error('请传 --account');
  if (!Number.isInteger(matchId) || matchId <= 0) throw new Error('请传合法 --matchId');
  if (!Number.isInteger(teamNumber) || teamNumber <= 0) throw new Error('请传合法 --teamNumber');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [uRows] = await conn.execute(
      'SELECT id, account, username, pubg_player_name, pubg_platform FROM users WHERE account = ? LIMIT 1',
      [account]
    );
    if (!uRows.length) throw new Error(`未找到账号: ${account}`);
    const user = uRows[0];

    const [tRows] = await conn.execute(
      'SELECT id FROM match_teams WHERE match_id = ? AND team_number = ? LIMIT 1 FOR UPDATE',
      [matchId, teamNumber]
    );
    if (!tRows.length) throw new Error(`未找到比赛${matchId}的队伍${teamNumber}`);
    const teamId = tRows[0].id;

    await conn.execute(
      "UPDATE match_teams SET captain_user_id = ?, team_name = ?, locked = 0, status = 'unlocked', updated_by = ? WHERE id = ?",
      [String(user.id), `${teamNumber}队`, String(user.id), teamId]
    );

    await conn.execute(
      `UPDATE match_team_players
       SET user_id = ?, name = ?, game_id = ?, company = ?, is_current_user = false, player_card_uuid = NULL
       WHERE match_id = ? AND match_team_id = ? AND player_index = 0`,
      [
        String(user.id),
        user.username || user.account,
        user.pubg_player_name || `PUBG_${user.id}`,
        user.pubg_platform || 'steam',
        matchId,
        teamId,
      ]
    );

    await conn.commit();
    console.log(
      JSON.stringify(
        {
          ok: true,
          account: user.account,
          userId: user.id,
          matchId,
          teamNumber,
          teamId,
        },
        null,
        2
      )
    );
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error('[set_team_captain] 执行失败:', error?.message || error);
  try {
    await pool.end();
  } catch (e) {
    // ignore
  }
  process.exit(1);
});
