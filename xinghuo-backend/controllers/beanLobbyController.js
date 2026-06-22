const BeanLobbyModel = require('../models/beanLobbyModel');
const { buildSettlement } = require('../services/beanRuleEngine');
const { autoSettleSession } = require('../services/beanSettlementService');
const { pollSession } = require('../services/beanPollService');

function mapBeanError(code) {
  const map = {
    TABLE_NOT_FOUND: { status: 404, message: '桌子不存在' },
    TABLE_NOT_JOINABLE: { status: 400, message: '当前桌子不可加入' },
    TABLE_NOT_LEAVABLE: { status: 400, message: '当前桌子不可离开' },
    ALREADY_IN_TABLE: { status: 400, message: '你已在该桌内' },
    TABLE_FULL: { status: 400, message: '桌子已满员' },
    NOT_IN_TABLE: { status: 400, message: '你不在该桌内' },
    OWNER_CANNOT_LEAVE: { status: 400, message: '桌主不能直接离桌' },
    ONLY_OWNER: { status: 403, message: '仅桌主可执行该操作' },
    TABLE_BUSY: { status: 400, message: '当前桌子已有进行中的会话' },
    PLAYER_COUNT_INVALID: { status: 400, message: '开局前必须 4 人满桌' },
    PUBG_BIND_REQUIRED: { status: 400, message: '存在未绑定 PUBG 的玩家，无法开局' },
    PLATFORM_MISMATCH: { status: 400, message: '4 名玩家 PUBG 平台不一致，无法自动结算' },
    FIXED_TABLES_ONLY: { status: 400, message: '大厅固定 12 桌，不支持手动创建' },
    NOT_SOFT_LOCKED: { status: 400, message: '当前不在软锁替补阶段' },
    SEAT_NOT_FOUND: { status: 404, message: '座位不存在' },
    SEAT_OCCUPIED: { status: 400, message: '该座位已被占用' },
    SAME_USER: { status: 400, message: '替补用户不能与当前用户相同' },
    OWNER_TRANSFER_TARGET_INVALID: { status: 400, message: '目标用户不在当前桌内' },
    SESSION_NOT_FOUND: { status: 404, message: '会话不存在' },
    ROUND_NOT_FOUND: { status: 404, message: '局记录不存在' },
    NO_ROUNDS: { status: 400, message: '至少完成一局结算后可确认' },
    MATCH_NOT_FOUND: { status: 400, message: '未匹配到 4 人同一场四排对局，请稍后重试或手动修正' },
    MATCH_ALREADY_SETTLED: { status: 400, message: '该对局已结算' },
    MATCH_DATA_INCOMPLETE: { status: 400, message: '匹配到对局但数据不完整，请手动修正' },
    INVALID_STATUS: { status: 400, message: '当前状态不允许该操作' },
  };
  return map[code] || { status: 400, message: '操作失败' };
}

async function buildSessionPayload(sessionId) {
  const session = await BeanLobbyModel.getSessionById(sessionId);
  if (!session) return null;
  const [players, logs, rounds] = await Promise.all([
    BeanLobbyModel.getSessionPlayers(sessionId),
    BeanLobbyModel.listLogs(sessionId),
    BeanLobbyModel.listSessionRounds(sessionId),
  ]);
  return {
    id: session.id,
    tableId: session.table_id,
    tableName: session.table_name,
    ownerUserId: session.owner_user_id,
    status: session.status,
    startedBy: session.started_by,
    startedAt: session.started_at,
    settledAt: session.settled_at,
    resolvedMatchId: session.resolved_match_id,
    randomSeed: session.random_seed,
    summaryJson: session.summary_json,
    lastPolledAt: session.last_polled_at,
    roundCount: Number(session.round_count || 0),
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    players,
    logs,
    rounds,
  };
}

class BeanLobbyController {
  static async listTables(req, res) {
    try {
      const tables = await BeanLobbyModel.listTables();
      res.json({ tables });
    } catch (error) {
      console.error('获取豆子局大厅失败:', error);
      res.status(500).json({ error: '获取豆子局大厅失败' });
    }
  }

  static async createTable(req, res) {
    try {
      const tableName = String(req.body?.tableName || '').trim() || `豆子桌-${Date.now().toString().slice(-4)}`;
      const result = await BeanLobbyModel.createTable({
        tableName,
        ownerUserId: req.user.id,
      });
      if (!result.ok) {
        const mapped = mapBeanError(result.code);
        return res.status(mapped.status).json({ error: result.message || mapped.message });
      }
      const table = await BeanLobbyModel.findTableById(result.tableId);
      res.status(201).json({ message: '桌子已创建', table });
    } catch (error) {
      console.error('创建豆子桌失败:', error);
      res.status(500).json({ error: '创建豆子桌失败' });
    }
  }

  static async getTable(req, res) {
    try {
      const table = await BeanLobbyModel.findTableById(Number(req.params.id));
      if (!table) return res.status(404).json({ error: '桌子不存在' });
      res.json({ table });
    } catch (error) {
      console.error('获取桌子详情失败:', error);
      res.status(500).json({ error: '获取桌子详情失败' });
    }
  }

  static async joinTable(req, res) {
    try {
      const seatNoRaw = Number(req.body?.seatNo);
      const seatNo = Number.isInteger(seatNoRaw) && seatNoRaw >= 1 && seatNoRaw <= 4 ? seatNoRaw : undefined;
      const result = await BeanLobbyModel.joinTable({
        tableId: Number(req.params.id),
        userId: req.user.id,
        preferredSeatNo: seatNo,
      });
      if (!result.ok) {
        const mapped = mapBeanError(result.code);
        return res.status(mapped.status).json({ error: result.message || mapped.message });
      }
      const table = await BeanLobbyModel.findTableById(Number(req.params.id));
      res.json({ message: '加入成功', table });
    } catch (error) {
      console.error('加入桌子失败:', error);
      res.status(500).json({ error: '加入桌子失败' });
    }
  }

  static async leaveTable(req, res) {
    try {
      const result = await BeanLobbyModel.leaveTable({
        tableId: Number(req.params.id),
        userId: req.user.id,
      });
      if (!result.ok) {
        const mapped = mapBeanError(result.code);
        return res.status(mapped.status).json({ error: result.message || mapped.message });
      }
      const table = await BeanLobbyModel.findTableById(Number(req.params.id));
      res.json({ message: '已离桌', table });
    } catch (error) {
      console.error('离开桌子失败:', error);
      res.status(500).json({ error: '离开桌子失败' });
    }
  }

  static async startSession(req, res) {
    try {
      const result = await BeanLobbyModel.startSession({
        tableId: Number(req.params.id),
        ownerUserId: req.user.id,
      });
      if (!result.ok) {
        const mapped = mapBeanError(result.code);
        return res.status(mapped.status).json({ error: result.message || mapped.message });
      }
      const [table, session] = await Promise.all([
        BeanLobbyModel.findTableById(Number(req.params.id)),
        buildSessionPayload(result.sessionId),
      ]);
      res.json({
        message: '开局成功，系统将每 10 分钟自动同步四排战绩',
        table,
        session,
      });
    } catch (error) {
      console.error('开始豆子局失败:', error);
      res.status(500).json({ error: '开始豆子局失败' });
    }
  }

  static async substitute(req, res) {
    try {
      const seatNo = Number(req.body?.seatNo);
      const newUserId = Number(req.body?.newUserId);
      if (!Number.isInteger(seatNo) || seatNo < 1 || seatNo > 4) {
        return res.status(400).json({ error: 'seatNo 必须在 1-4 之间' });
      }
      if (!Number.isInteger(newUserId) || newUserId <= 0) {
        return res.status(400).json({ error: 'newUserId 无效' });
      }
      const result = await BeanLobbyModel.substitutePlayer({
        tableId: Number(req.params.id),
        ownerUserId: req.user.id,
        seatNo,
        newUserId,
      });
      if (!result.ok) {
        const mapped = mapBeanError(result.code);
        return res.status(mapped.status).json({ error: result.message || mapped.message });
      }
      const [table, session] = await Promise.all([
        BeanLobbyModel.findTableById(Number(req.params.id)),
        buildSessionPayload(result.sessionId),
      ]);
      res.json({ message: '替补成功', table, session });
    } catch (error) {
      console.error('替补失败:', error);
      res.status(500).json({ error: '替补失败' });
    }
  }

  static async transferOwner(req, res) {
    try {
      const targetUserId = Number(req.body?.targetUserId);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return res.status(400).json({ error: 'targetUserId 无效' });
      }
      const result = await BeanLobbyModel.transferOwner({
        tableId: Number(req.params.id),
        currentOwnerUserId: req.user.id,
        targetUserId,
      });
      if (!result.ok) {
        const mapped = mapBeanError(result.code);
        return res.status(mapped.status).json({ error: result.message || mapped.message });
      }
      const table = await BeanLobbyModel.findTableById(Number(req.params.id));
      res.json({ message: '桌主移交成功', table });
    } catch (error) {
      console.error('桌主移交失败:', error);
      res.status(500).json({ error: '桌主移交失败' });
    }
  }

  static async getSession(req, res) {
    try {
      const sessionId = Number(req.params.id);
      const session = await buildSessionPayload(sessionId);
      if (!session) return res.status(404).json({ error: '会话不存在' });
      res.json({ session });
    } catch (error) {
      console.error('获取会话失败:', error);
      res.status(500).json({ error: '获取会话失败' });
    }
  }

  static async pollSession(req, res) {
    try {
      const sessionId = Number(req.params.id);
      const result = await pollSession(sessionId, { operatorUserId: req.user.id });
      if (!result.ok) {
        const mapped = mapBeanError(result.code);
        return res.status(mapped.status).json({ error: result.message || mapped.message });
      }
      const session = await buildSessionPayload(sessionId);
      res.json({
        message: result.message || '同步完成',
        newRounds: result.newRounds || 0,
        session,
      });
    } catch (error) {
      console.error('同步战绩失败:', error);
      res.status(500).json({ error: error?.message || '同步战绩失败' });
    }
  }

  static async refreshAuto(req, res) {
    try {
      const sessionId = Number(req.params.id);
      const matchId = String(req.body?.matchId || '').trim();
      const result = await autoSettleSession(sessionId, {
        operatorUserId: req.user.id,
        matchId,
      });
      if (!result.ok) {
        const mapped = mapBeanError(result.code);
        return res.status(mapped.status).json({ error: result.message || mapped.message });
      }
      const session = await buildSessionPayload(sessionId);
      res.json({
        message: result.message || '战绩同步完成',
        newRounds: result.newRounds ?? (result.roundNo ? 1 : 0),
        session,
      });
    } catch (error) {
      console.error('自动结算失败:', error);
      res.status(500).json({ error: error?.message || '自动结算失败' });
    }
  }

  static async updateManualPlayers(req, res) {
    try {
      const sessionId = Number(req.params.id);
      const roundId = Number(req.body?.roundId);
      const players = Array.isArray(req.body?.players) ? req.body.players : [];
      const sanitized = players
        .map((p) => ({
          userId: Number(p.userId),
          damage: Number(p.damage),
          kills: Number(p.kills),
          winPlace: Number(p.winPlace),
        }))
        .filter((p) => Number.isInteger(p.userId) && p.userId > 0);
      if (!sanitized.length) {
        return res.status(400).json({ error: '请传入有效玩家数据' });
      }

      let targetRoundId = roundId;
      if (!targetRoundId) {
        const rounds = await BeanLobbyModel.listSessionRounds(sessionId);
        const latest = rounds[rounds.length - 1];
        if (!latest) {
          return res.status(400).json({ error: '暂无可修正的对局，请先同步战绩' });
        }
        targetRoundId = latest.id;
      }

      const currentPlayers = await BeanLobbyModel.getSessionPlayers(sessionId);
      const targetRound = await BeanLobbyModel.getSessionRoundById(targetRoundId, sessionId);
      if (!targetRound) {
        return res.status(404).json({ error: '局记录不存在' });
      }
      const roundPlayers = targetRound.players || [];
      const settlement = buildSettlement(currentPlayers.map((p) => {
        const roundP = roundPlayers.find((item) => Number(item.userId) === Number(p.userId));
        const manual = sanitized.find((item) => item.userId === p.userId);
        return {
          userId: p.userId,
          seatNo: p.seatNo,
          displayName: p.displayName,
          damage: manual ? manual.damage : Number(roundP?.damage || 0),
          kills: manual ? manual.kills : Number(roundP?.kills || 0),
          winPlace: manual ? manual.winPlace : Number(roundP?.winPlace || 0),
        };
      }));
      if (!settlement.ok) {
        return res.status(400).json({ error: settlement.message || '手工计算失败' });
      }

      const summary = {
        strategy: settlement.strategy,
        needsRandom: settlement.needsRandom,
        rollPoints: settlement.rollPoints || [],
        winner: settlement.beanResult.winner,
        killsA: settlement.beanResult.killsA,
        killsB: settlement.beanResult.killsB,
        beanBase: settlement.beanResult.beanBase,
        beanTotal: settlement.beanResult.beanTotal,
        multiplied: settlement.beanResult.multiplied,
        teamAUserIds: settlement.teamA.map((p) => p.userId),
        teamBUserIds: settlement.teamB.map((p) => p.userId),
      };
      const playersToSave = settlement.players.map((p) => ({
        userId: p.userId,
        damage: p.damage,
        kills: p.kills,
        winPlace: p.winPlace,
        tail: p.tail,
        teamNo: p.teamNo,
        netBeans: p.netBeans,
        sourceConfidence: 0.5,
        manualOverride: true,
      }));

      const manualResult = await BeanLobbyModel.updateSessionRoundManual({
        sessionId,
        roundId: targetRoundId,
        players: playersToSave,
        summary,
        operatorUserId: req.user.id,
      });
      if (!manualResult.ok) {
        const mapped = mapBeanError(manualResult.code);
        return res.status(mapped.status).json({ error: manualResult.message || mapped.message });
      }

      await BeanLobbyModel.appendLog({
        sessionId,
        action: 'manual_preview_ready',
        operatorUserId: req.user.id,
        detail: { roundId: targetRoundId, summary },
      });

      const session = await buildSessionPayload(sessionId);
      res.json({ message: '已根据手工数据更新该局并重算累计', session });
    } catch (error) {
      console.error('手工修正失败:', error);
      res.status(500).json({ error: '手工修正失败' });
    }
  }

  static async confirm(req, res) {
    try {
      const sessionId = Number(req.params.id);
      const result = await BeanLobbyModel.confirmSession({
        sessionId,
        operatorUserId: req.user.id,
      });
      if (!result.ok) {
        const mapped = mapBeanError(result.code);
        return res.status(mapped.status).json({ error: result.message || mapped.message });
      }
      const session = await buildSessionPayload(sessionId);
      res.json({ message: '豆子局已确认结算', session });
    } catch (error) {
      console.error('确认结算失败:', error);
      res.status(500).json({ error: '确认结算失败' });
    }
  }

  static async reopen(req, res) {
    try {
      const sessionId = Number(req.params.id);
      const result = await BeanLobbyModel.reopenSession({
        sessionId,
        operatorUserId: req.user.id,
      });
      if (!result.ok) {
        const mapped = mapBeanError(result.code);
        return res.status(mapped.status).json({ error: result.message || mapped.message });
      }
      const session = await buildSessionPayload(sessionId);
      res.json({ message: '会话已重开', session });
    } catch (error) {
      console.error('重开会话失败:', error);
      res.status(500).json({ error: '重开会话失败' });
    }
  }
}

module.exports = BeanLobbyController;
