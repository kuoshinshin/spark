const MatchModel = require('../models/matchModel');
const UserModel = require('../models/userModel');
const { calculateStageScores, getRuleSummary } = require('../services/pgsScoring');

class MatchController {
  static registrationStreamClients = new Set();

  static sendSse(res, event, payload) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  static broadcastRegistrationChange(payload = {}) {
    for (const client of MatchController.registrationStreamClients) {
      try {
        MatchController.sendSse(client, 'registration:update', {
          ts: Date.now(),
          ...payload,
        });
      } catch (e) {
        // ignore broken pipes; close handler会清理
      }
    }
  }

  static normalizeSeasonTitle(match) {
    if (!match) return '暂无赛事';
    const title = match.title || '当前赛季';
    switch (match.phase) {
      case 'registration':
        return `${title}·火热报名中`;
      case 'frozen':
        return `${title}·名单已冻结`;
      case 'live':
        return `${title}·比赛进行中`;
      case 'completed':
        return `${title}·赛事已结束`;
      case 'archived':
        return `${title}·已归档`;
      default:
        return title;
    }
  }

  static async resolveRegistrationTeam(matchId, teamId, currentMatch) {
    const phase = currentMatch?.phase;
    const snap =
      phase && ['frozen', 'live', 'completed'].includes(phase)
        ? await MatchModel.hasRosterSnapshots(matchId)
        : false;
    if (snap) return MatchModel.getRegistrationTeamFromSnapshots(matchId, teamId);
    return MatchModel.getRegistrationTeam(matchId, teamId);
  }

  static isRegistrationOpen(match) {
    if (!match || match.status !== 'upcoming' || match.roster_frozen_at) return false;
    const now = Date.now();
    if (match.registration_open_at && now < new Date(match.registration_open_at).getTime()) return false;
    if (match.registration_close_at && now > new Date(match.registration_close_at).getTime()) return false;
    return true;
  }

  static async getCurrentRegistrationContext() {
    const currentMatch = await MatchModel.getActiveRegistrationMatch();
    return {
      currentMatch,
      registrationOpen: MatchController.isRegistrationOpen(currentMatch),
      seasonTitle: MatchController.normalizeSeasonTitle(currentMatch),
    };
  }

  static validateUserForRegistration(user) {
    if (!user?.pubg_player_name || !user?.pubg_platform || !user?.pubg_player_id) {
      throw new Error('请先在个人页面绑定游戏角色后再报名');
    }
    if (!String(user.real_name || '').trim() || !String(user.phone || '').trim() || !String(user.address || '').trim()) {
      throw new Error('请先在个人页面完善姓名、电话和地址后再报名');
    }
  }

  static async getChangedRegistrationTeam(matchId, teamId, currentMatch) {
    const team = await MatchController.resolveRegistrationTeam(matchId, teamId, currentMatch);
    return team ? { team } : {};
  }
  // 创建比赛
  static async createMatch(req, res) {
    try {
      const {
        title,
        description,
        start_time,
        end_time,
        location,
        status = 'upcoming',
        registration_open_at = null,
        registration_close_at = null,
        roster_frozen_at = null,
        is_active_registration = false
      } = req.body;
      
      if (!title || !start_time || !end_time) {
        return res.status(400).json({ error: '标题、开始时间和结束时间不能为空' });
      }

      if (!['upcoming', 'ongoing', 'completed'].includes(String(status))) {
        return res.status(400).json({ error: '状态无效，仅支持 upcoming/ongoing/completed' });
      }
      
      const result = await MatchModel.create(
        title,
        description,
        start_time,
        end_time,
        location,
        status,
        registration_open_at || null,
        registration_close_at || null,
        roster_frozen_at || null,
        Boolean(is_active_registration)
      );
      await MatchModel.logOperation(result.insertId, null, req.user?.id, 'match.create', {
        title,
        status,
        is_active_registration,
      });
      
      res.status(201).json({ message: '比赛创建成功', matchId: result.insertId });
    } catch (error) {
      console.error('创建比赛失败:', error);
      res.status(500).json({ error: '创建比赛失败，请联系管理员' });
    }
  }
  
  // 获取所有比赛
  static async getAllMatches(req, res) {
    try {
      const matches = await MatchModel.getAll();
      res.json(matches);
    } catch (error) {
      console.error('获取比赛失败:', error);
      res.status(500).json({ error: '获取比赛失败，请联系管理员' });
    }
  }
  
  // 获取比赛详情
  static async getMatchById(req, res) {
    try {
      const matchId = req.params.id;
      const match = await MatchModel.getById(matchId);
      
      if (!match) {
        return res.status(404).json({ error: '比赛不存在' });
      }
      
      res.json(match);
    } catch (error) {
      console.error('获取比赛详情失败:', error);
      res.status(500).json({ error: '获取比赛详情失败，请联系管理员' });
    }
  }
  
  // 更新比赛信息
  static async updateMatch(req, res) {
    try {
      const matchId = req.params.id;
      const data = req.body;
      
      // 移除不需要更新的字段
      delete data.created_at;
      delete data.updated_at;
      
      const result = await MatchModel.update(matchId, data);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: '比赛不存在' });
      }
      
      await MatchModel.logOperation(matchId, null, req.user?.id, 'match.update', data);
      res.json({ message: '比赛更新成功' });
    } catch (error) {
      console.error('更新比赛失败:', error);
      res.status(500).json({ error: '更新比赛失败，请联系管理员' });
    }
  }
  
  // 删除比赛
  static async deleteMatch(req, res) {
    try {
      const matchId = req.params.id;
      const result = await MatchModel.delete(matchId);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: '比赛不存在' });
      }
      
      await MatchModel.logOperation(matchId, null, req.user?.id, 'match.delete', {});
      res.json({ message: '比赛删除成功' });
    } catch (error) {
      console.error('删除比赛失败:', error);
      res.status(500).json({ error: '删除比赛失败，请联系管理员' });
    }
  }
  
  // 获取即将开始的比赛
  static async getUpcomingMatches(req, res) {
    try {
      const matches = await MatchModel.getUpcoming();
      res.json(matches);
    } catch (error) {
      console.error('获取即将开始的比赛失败:', error);
      res.status(500).json({ error: '获取即将开始的比赛失败，请联系管理员' });
    }
  }
  
  // 获取正在进行的比赛
  static async getOngoingMatches(req, res) {
    try {
      const matches = await MatchModel.getOngoing();
      res.json(matches);
    } catch (error) {
      console.error('获取正在进行的比赛失败:', error);
      res.status(500).json({ error: '获取正在进行的比赛失败，请联系管理员' });
    }
  }
  
  static async registerForMatch(req, res) {
    try {
      const matchId = Number(req.params.id);
      const userId = Number(req.user.id);
      const { teamName, playerName, gameId, phone, address } = req.body || {};

      if (!matchId || !teamName || !playerName || !gameId || !phone || !address) {
        return res.status(400).json({ error: '报名信息不完整，请填写队伍名、游戏ID、手机号和地址' });
      }

      const match = await MatchModel.getById(matchId);
      if (!match) return res.status(404).json({ error: '比赛不存在' });
      if (match.status !== 'upcoming') return res.status(400).json({ error: '当前比赛不在报名阶段' });
      if (match.roster_frozen_at) return res.status(400).json({ error: '报名名单已冻结' });

      const now = Date.now();
      if (match.registration_open_at && now < new Date(match.registration_open_at).getTime()) {
        return res.status(400).json({ error: '报名尚未开始' });
      }
      if (match.registration_close_at && now > new Date(match.registration_close_at).getTime()) {
        return res.status(400).json({ error: '报名已截止' });
      }

      await MatchModel.createRegistration(matchId, userId, {
        teamName: String(teamName).trim(),
        playerName: String(playerName).trim(),
        gameId: String(gameId).trim(),
        phone: String(phone).trim(),
        address: String(address).trim()
      });
      return res.status(201).json({ message: '报名提交成功，等待审核' });
    } catch (error) {
      console.error('提交报名失败:', error);
      return res.status(500).json({ error: '提交报名失败，请稍后重试' });
    }
  }

  static async getMatchRegistrations(req, res) {
    try {
      const matchId = Number(req.params.id);
      const list = await MatchModel.getRegistrationsByMatch(matchId);
      return res.json({ list });
    } catch (error) {
      console.error('获取报名列表失败:', error);
      return res.status(500).json({ error: '获取报名列表失败，请稍后重试' });
    }
  }

  static async reviewMatchRegistration(req, res) {
    try {
      const matchId = Number(req.params.id);
      const registrationId = Number(req.params.registrationId);
      const reviewerId = Number(req.user.id);
      const status = String(req.body?.status || '').trim();
      const reviewNote = String(req.body?.reviewNote || '').trim();

      if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'status 仅支持 approved/rejected' });
      }

      const result = await MatchModel.reviewRegistration(matchId, registrationId, status, reviewNote, reviewerId);
      if (!result?.affectedRows) return res.status(404).json({ error: '报名记录不存在' });
      return res.json({ message: status === 'approved' ? '报名已通过' : '报名已驳回' });
    } catch (error) {
      console.error('审核报名失败:', error);
      return res.status(500).json({ error: '审核报名失败，请稍后重试' });
    }
  }

  static async freezeRoster(req, res) {
    try {
      const matchId = Number(req.params.id);
      const result = await MatchModel.freezeMatchRoster(matchId);
      if (!result?.affectedRows) return res.status(404).json({ error: '比赛不存在' });
      await MatchModel.logOperation(matchId, null, req.user?.id, 'match.freeze_roster', {});
      return res.json({ message: '名单已冻结' });
    } catch (error) {
      console.error('冻结名单失败:', error);
      return res.status(500).json({ error: '冻结名单失败，请稍后重试' });
    }
  }

  static async setActiveRegistration(req, res) {
    try {
      const matchId = Number(req.params.id);
      const result = await MatchModel.setActiveRegistration(matchId);
      if (!result?.affectedRows) return res.status(404).json({ error: '比赛不存在' });
      await MatchModel.logOperation(matchId, null, req.user?.id, 'match.set_active_registration', {});
      MatchController.broadcastRegistrationChange({ type: 'activeRegistrationChanged', teamId: null });
      return res.json({ message: '已设为当前报名赛事' });
    } catch (error) {
      console.error('设置当前报名赛事失败:', error);
      return res.status(500).json({ error: '设置当前报名赛事失败，请稍后重试' });
    }
  }

  static async closeRegistration(req, res) {
    try {
      const matchId = Number(req.params.id);
      const result = await MatchModel.closeRegistration(matchId);
      if (!result?.affectedRows) return res.status(404).json({ error: '比赛不存在' });
      await MatchModel.logOperation(matchId, null, req.user?.id, 'match.close_registration', {});
      MatchController.broadcastRegistrationChange({ type: 'activeRegistrationClosed', teamId: null });
      return res.json({ message: '报名已关闭' });
    } catch (error) {
      console.error('关闭报名失败:', error);
      return res.status(500).json({ error: '关闭报名失败，请稍后重试' });
    }
  }

  static async startMatch(req, res) {
    try {
      const matchId = Number(req.params.id);
      const result = await MatchModel.startMatch(matchId);
      if (!result?.affectedRows) return res.status(404).json({ error: '比赛不存在' });
      await MatchModel.logOperation(matchId, null, req.user?.id, 'match.start', {});
      return res.json({ message: '比赛已开赛' });
    } catch (error) {
      console.error('开赛失败:', error);
      return res.status(400).json({ error: error.message || '开赛失败' });
    }
  }

  static async completeMatch(req, res) {
    try {
      const matchId = Number(req.params.id);
      const result = await MatchModel.completeMatch(matchId);
      if (!result?.affectedRows) return res.status(404).json({ error: '比赛不存在' });
      await MatchModel.logOperation(matchId, null, req.user?.id, 'match.complete', {});
      return res.json({ message: '比赛已完成' });
    } catch (error) {
      console.error('完成比赛失败:', error);
      return res.status(400).json({ error: error.message || '完成比赛失败' });
    }
  }

  static async createRound(req, res) {
    try {
      const matchId = Number(req.params.id);
      const roundNo = Number(req.body?.roundNo || req.body?.round_no);
      const mapName = String(req.body?.mapName || req.body?.map_name || '').trim();
      const result = await MatchModel.createRound(matchId, roundNo, mapName, Number(req.user.id));
      await MatchModel.logOperation(matchId, null, req.user?.id, 'round.create', { roundNo, mapName });
      return res.status(201).json({ message: '局次已创建', roundId: result.insertId });
    } catch (error) {
      console.error('创建局次失败:', error);
      return res.status(400).json({ error: error.message || '创建局次失败' });
    }
  }

  static async getRounds(req, res) {
    try {
      const matchId = Number(req.params.id);
      const rounds = await MatchModel.getRounds(matchId);
      return res.json({ rounds });
    } catch (error) {
      console.error('获取局次失败:', error);
      return res.status(500).json({ error: '获取局次失败，请稍后重试' });
    }
  }

  static async startRound(req, res) {
    try {
      const matchId = Number(req.params.id);
      const roundId = Number(req.params.roundId);
      const result = await MatchModel.startRound(matchId, roundId);
      if (!result?.affectedRows) return res.status(404).json({ error: '局次不存在' });
      await MatchModel.logOperation(matchId, null, req.user?.id, 'round.start', { roundId });
      return res.json({ message: '局次已开始' });
    } catch (error) {
      console.error('开始局次失败:', error);
      return res.status(400).json({ error: error.message || '开始局次失败' });
    }
  }

  static async saveRoundResults(req, res) {
    try {
      const matchId = Number(req.params.id);
      const roundId = Number(req.params.roundId);
      const results = req.body?.results;
      await MatchModel.saveRoundResults(matchId, roundId, results, Number(req.user.id));
      const saved = await MatchModel.getRoundResults(matchId, roundId);
      await MatchModel.logOperation(matchId, null, req.user?.id, 'round.save_results', {
        roundId,
        count: Array.isArray(results) ? results.length : 0,
      });
      return res.json({ message: '成绩已保存', results: saved });
    } catch (error) {
      console.error('保存成绩失败:', error);
      return res.status(400).json({ error: error.message || '保存成绩失败' });
    }
  }

  static async completeRound(req, res) {
    try {
      const matchId = Number(req.params.id);
      const roundId = Number(req.params.roundId);
      const result = await MatchModel.completeRound(matchId, roundId);
      if (!result?.affectedRows) return res.status(404).json({ error: '局次不存在' });
      await MatchModel.logOperation(matchId, null, req.user?.id, 'round.complete', { roundId });
      return res.json({ message: '局次已锁定' });
    } catch (error) {
      console.error('锁定局次失败:', error);
      return res.status(400).json({ error: error.message || '锁定局次失败' });
    }
  }

  static async voidRound(req, res) {
    try {
      const matchId = Number(req.params.id);
      const roundId = Number(req.params.roundId);
      const result = await MatchModel.voidRound(matchId, roundId);
      if (!result?.affectedRows) return res.status(404).json({ error: '局次不存在' });
      await MatchModel.logOperation(matchId, null, req.user?.id, 'round.void', { roundId });
      return res.json({ message: '局次已作废' });
    } catch (error) {
      console.error('作废局次失败:', error);
      return res.status(400).json({ error: error.message || '作废局次失败' });
    }
  }

  static async getLeaderboard(req, res) {
    try {
      const matchId = Number(req.params.id);
      const teams = await MatchModel.getLeaderboard(matchId);
      const rounds = await MatchModel.getRounds(matchId);
      const roundsCompleted = rounds.filter((r) => r.status === 'completed').length;
      return res.json({ matchId, roundsCompleted, teams });
    } catch (error) {
      console.error('获取积分榜失败:', error);
      return res.status(500).json({ error: '获取积分榜失败，请稍后重试' });
    }
  }

  static async getRegistrationLobby(req, res) {
    try {
      const context = await MatchController.getCurrentRegistrationContext();
      if (!context.currentMatch?.id) {
        return res.json({
          ...context,
          teams: [],
        });
      }
      const mid = context.currentMatch.id;
      const phase = context.currentMatch.phase;
      const useSnap =
        phase && ['frozen', 'live', 'completed'].includes(phase) && (await MatchModel.hasRosterSnapshots(mid));
      const teams = useSnap
        ? await MatchModel.getRegistrationMapFromSnapshots(mid)
        : await MatchModel.getRegistrationMap(mid);
      return res.json({
        ...context,
        teams,
      });
    } catch (error) {
      console.error('获取报名大厅失败:', error);
      return res.status(500).json({ error: '获取报名大厅失败，请稍后重试' });
    }
  }

  static async getRegistrationTeam(req, res) {
    try {
      const teamId = Number(req.params.teamId);
      if (!teamId) return res.status(400).json({ error: 'teamId 无效' });
      const context = await MatchController.getCurrentRegistrationContext();
      if (!context.currentMatch?.id) return res.status(404).json({ error: '当前无可报名赛事' });
      const team = await MatchController.resolveRegistrationTeam(
        context.currentMatch.id,
        teamId,
        context.currentMatch
      );
      if (!team) return res.status(404).json({ error: '队伍不存在' });
      return res.json({ team });
    } catch (error) {
      console.error('获取队伍详情失败:', error);
      return res.status(500).json({ error: '获取队伍详情失败，请稍后重试' });
    }
  }

  static async subscribeRegistrationStream(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    MatchController.registrationStreamClients.add(res);
    MatchController.sendSse(res, 'connected', { ts: Date.now() });

    const keepAlive = setInterval(() => {
      try {
        MatchController.sendSse(res, 'ping', { ts: Date.now() });
      } catch (e) {
        // handled by close
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      MatchController.registrationStreamClients.delete(res);
      try {
        res.end();
      } catch (e) {
        // ignore
      }
    });
  }

  static async getMyRegistrationEligibility(req, res) {
    try {
      const userId = Number(req.user.id);
      const user = await UserModel.findById(userId);
      if (!user) return res.status(404).json({ error: '用户不存在' });

      const missing = [];
      if (!user.pubg_player_name || !user.pubg_platform || !user.pubg_player_id) {
        missing.push('pubgBinding');
      }
      if (!String(user.real_name || '').trim()) missing.push('realName');
      if (!String(user.phone || '').trim()) missing.push('phone');
      if (!String(user.address || '').trim()) missing.push('address');

      // 不在此接口请求 PUBG 战力（外部 API 很慢），由前端按需调 /api/user/pubg/power
      return res.json({
        canRegister: missing.length === 0,
        missing,
        userProfile: {
          userId,
          playerName: user.pubg_player_name || '',
          platform: user.pubg_platform || '',
          playerId: user.pubg_player_id || '',
          realName: user.real_name || '',
          phone: user.phone || '',
          address: user.address || '',
          powerScore: null,
          powerTier: '',
        },
      });
    } catch (error) {
      console.error('获取报名资格失败:', error);
      return res.status(500).json({ error: '获取报名资格失败，请稍后重试' });
    }
  }

  static async claimCaptainSlot(req, res) {
    try {
      const teamId = Number(req.params.teamId);
      const userId = Number(req.user.id);
      const context = await MatchController.getCurrentRegistrationContext();
      if (!context.registrationOpen) {
        return res.status(400).json({ error: '当前不在报名阶段，无法加入队伍' });
      }

      const user = await UserModel.findById(userId);
      if (!user) return res.status(404).json({ error: '用户不存在' });
      MatchController.validateUserForRegistration(user);

      await MatchModel.takeCaptainSlot(context.currentMatch.id, teamId, userId, {
        name: user.pubg_player_name,
        gameId: user.pubg_player_id,
        company: user.pubg_platform,
        uuid: null,
      });
      const payload = await MatchController.getChangedRegistrationTeam(
        context.currentMatch.id,
        teamId,
        context.currentMatch
      );
      await MatchModel.logOperation(context.currentMatch.id, teamId, userId, 'registration.claim_captain', {});
      MatchController.broadcastRegistrationChange({ type: 'claimCaptain', teamId, userId });
      return res.json({ message: '已成为队长', ...payload });
    } catch (error) {
      console.error('成为队长失败:', error);
      return res.status(400).json({ error: error.message || '成为队长失败' });
    }
  }

  static async joinTeamSlot(req, res) {
    try {
      const teamId = Number(req.params.teamId);
      const playerIndex = Number(req.params.playerIndex);
      const userId = Number(req.user.id);
      const context = await MatchController.getCurrentRegistrationContext();
      if (!context.registrationOpen) {
        return res.status(400).json({ error: '当前不在报名阶段，无法加入队伍' });
      }
      if (!Number.isInteger(playerIndex) || playerIndex < 1 || playerIndex > 4) {
        return res.status(400).json({ error: '只能加入队员/替补位置（1-4）' });
      }

      const user = await UserModel.findById(userId);
      if (!user) return res.status(404).json({ error: '用户不存在' });
      MatchController.validateUserForRegistration(user);

      await MatchModel.joinSlot(context.currentMatch.id, teamId, playerIndex, userId, {
        name: user.pubg_player_name,
        gameId: user.pubg_player_id,
        company: user.pubg_platform,
        uuid: null,
      });
      const payload = await MatchController.getChangedRegistrationTeam(
        context.currentMatch.id,
        teamId,
        context.currentMatch
      );
      await MatchModel.logOperation(context.currentMatch.id, teamId, userId, 'registration.join_slot', { playerIndex });
      MatchController.broadcastRegistrationChange({ type: 'joinSlot', teamId, playerIndex, userId });
      return res.json({ message: '加入队伍成功', ...payload });
    } catch (error) {
      console.error('加入队伍失败:', error);
      return res.status(400).json({ error: error.message || '加入队伍失败' });
    }
  }

  static async kickTeamMember(req, res) {
    try {
      const teamId = Number(req.params.teamId);
      const playerIndex = Number(req.params.playerIndex);
      const userId = Number(req.user.id);
      const context = await MatchController.getCurrentRegistrationContext();
      if (!context.registrationOpen) {
        return res.status(400).json({ error: '当前不在报名阶段，无法编辑队伍' });
      }

      await MatchModel.removeTeamMember(context.currentMatch.id, teamId, playerIndex, userId);
      const payload = await MatchController.getChangedRegistrationTeam(
        context.currentMatch.id,
        teamId,
        context.currentMatch
      );
      await MatchModel.logOperation(context.currentMatch.id, teamId, userId, 'registration.kick_member', { playerIndex });
      MatchController.broadcastRegistrationChange({ type: 'kickMember', teamId, playerIndex, userId });
      return res.json({ message: '已移除队员', ...payload });
    } catch (error) {
      console.error('移除队员失败:', error);
      return res.status(400).json({ error: error.message || '移除队员失败' });
    }
  }

  static async updateTeamNameByCaptain(req, res) {
    try {
      const teamId = Number(req.params.teamId);
      const userId = Number(req.user.id);
      const teamName = String(req.body?.teamName || '').trim();
      if (!teamName) return res.status(400).json({ error: '队名不能为空' });

      const context = await MatchController.getCurrentRegistrationContext();
      if (!context.registrationOpen) {
        return res.status(400).json({ error: '当前不在报名阶段，无法编辑队伍' });
      }

      const result = await MatchModel.updateTeamNameByCaptain(context.currentMatch.id, teamId, teamName, userId);
      if (!result?.affectedRows) return res.status(403).json({ error: '仅队长可编辑队名' });
      const payload = await MatchController.getChangedRegistrationTeam(
        context.currentMatch.id,
        teamId,
        context.currentMatch
      );
      await MatchModel.logOperation(context.currentMatch.id, teamId, userId, 'registration.update_team_name', { teamName });
      MatchController.broadcastRegistrationChange({ type: 'updateTeamName', teamId, userId });
      return res.json({ message: '队名更新成功', ...payload });
    } catch (error) {
      console.error('更新队名失败:', error);
      return res.status(500).json({ error: '更新队名失败，请稍后重试' });
    }
  }

  static async transferCaptain(req, res) {
    try {
      const teamId = Number(req.params.teamId);
      const userId = Number(req.user.id);
      const targetPlayerIndex = Number(req.body?.targetPlayerIndex);
      const context = await MatchController.getCurrentRegistrationContext();
      if (!context.registrationOpen) {
        return res.status(400).json({ error: '当前不在报名阶段，无法编辑队伍' });
      }

      await MatchModel.transferCaptain(context.currentMatch.id, teamId, userId, targetPlayerIndex);
      const payload = await MatchController.getChangedRegistrationTeam(
        context.currentMatch.id,
        teamId,
        context.currentMatch
      );
      await MatchModel.logOperation(context.currentMatch.id, teamId, userId, 'registration.transfer_captain', { targetPlayerIndex });
      MatchController.broadcastRegistrationChange({ type: 'transferCaptain', teamId, targetPlayerIndex, userId });
      return res.json({ message: '队长已转让', ...payload });
    } catch (error) {
      console.error('转让队长失败:', error);
      return res.status(400).json({ error: error.message || '转让队长失败' });
    }
  }

  static async leaveMyTeam(req, res) {
    try {
      const userId = Number(req.user.id);
      const context = await MatchController.getCurrentRegistrationContext();
      if (!context.registrationOpen) {
        return res.status(400).json({ error: '当前不在报名阶段，无法退出队伍' });
      }

      const result = await MatchModel.leaveMyTeam(context.currentMatch.id, userId);
      const payload = result?.teamId
        ? await MatchController.getChangedRegistrationTeam(
            context.currentMatch.id,
            result.teamId,
            context.currentMatch
          )
        : {};
      await MatchModel.logOperation(context.currentMatch.id, result?.teamId || null, userId, 'registration.leave_team', {});
      MatchController.broadcastRegistrationChange({ type: 'leaveTeam', userId, teamId: result?.teamId || null });
      return res.json({ message: '已退出队伍', ...payload });
    } catch (error) {
      console.error('退出队伍失败:', error);
      return res.status(400).json({ error: error.message || '退出队伍失败' });
    }
  }
  
  // 获取个人比赛数据
  static async getPersonalData(req, res) {
    try {
      const userId = req.user.id;
      const completedTeams = await MatchModel.getUserCompletedTeams(userId);

      // 当前数据库结构里没有比赛“击杀/胜负/排名”维度，
      // 这里用已完成队伍数量做统计，历史明细留空/基础字段展示。
      res.json({
        totalMatches: completedTeams.length,
        totalKills: 0,
        totalWins: 0,
        kdRatio: 0,
        bestRank: '',
        matchHistory: completedTeams.map((t) => ({
          id: t.id,
          name: t.team_name,
          date: t.updated_at || t.created_at || '',
          rank: '',
          kills: 0,
        })),
      });
    } catch (error) {
      console.error('获取个人比赛数据失败:', error);
      res.status(500).json({ error: '获取个人比赛数据失败，请联系管理员' });
    }
  }
  
  // 获取赛季数据
  static async getSeasonData(req, res) {
    try {
      // 当前实现：忽略 seasonId，基于数据库 teams/team_players 组织返回结构。
      const allTeams = await MatchModel.getAllTeams();
      const completedTeams = (allTeams || []).filter((t) => t.status === 'completed');

      const top3 = completedTeams.slice(0, 3);

      res.json({
        champions: top3.map((t, idx) => ({
          rank: idx + 1,
          team: t.team_name,
          points: 0,
        })),
        teams: (allTeams || []).map((t) => ({
          id: t.id,
          name: t.team_name,
          players: (t.players || []).map((p) => ({
            id: p.id,
            name: p.name || '',
            kills: p.kills ?? 0,
          })),
        })),
      });
    } catch (error) {
      console.error('获取赛季数据失败:', error);
      res.status(500).json({ error: '获取赛季数据失败，请联系管理员' });
    }
  }
  

  
  // 获取规则数据
  static async getRulesData(req, res) {
    try {
      res.json(getRuleSummary());
    } catch (error) {
      console.error('获取规则数据失败:', error);
      res.status(500).json({ error: '获取规则数据失败，请联系管理员' });
    }
  }

  // 比赛阶段：按 PGS 规则计算队伍积分
  static async calculateStageScore(req, res) {
    try {
      const teams = req.body?.teams;
      if (!Array.isArray(teams) || teams.length === 0) {
        return res.status(400).json({ error: 'teams 不能为空，且必须是数组' });
      }

      const scores = calculateStageScores(teams);
      return res.json({
        rule: getRuleSummary(),
        scores,
      });
    } catch (error) {
      console.error('计算阶段积分失败:', error);
      return res.status(400).json({ error: error.message || '计算阶段积分失败' });
    }
  }
  
  // 更新选手名称
  static async updatePlayerName(req, res) {
    try {
      const { teamId, playerId, name } = req.body;
      if (!teamId || !playerId || name === undefined) {
        return res.status(400).json({ error: 'teamId、playerId 和 name 为必填项' });
      }

      const result = await MatchModel.updatePlayerName(teamId, playerId, name);
      if (!result || result.affectedRows === 0) {
        return res.status(404).json({ error: '选手不存在' });
      }

      res.json({ message: '选手名称更新成功' });
    } catch (error) {
      console.error('更新选手名称失败:', error);
      res.status(500).json({ error: '更新选手名称失败，请联系管理员' });
    }
  }
  
  // 获取选手卡数据
  static async getPlayerCardData(req, res) {
    try {
      // 从数据库获取选手卡数据
      const playerCard = await MatchModel.getPlayerCard();
      // 转换数据库字段名
      const playerCardData = playerCard ? {
        name: playerCard.name,
        gameId: playerCard.game_id,
        phone: playerCard.phone,
        address: playerCard.address,
        company: playerCard.company,
        uuid: playerCard.uuid
      } : {
        name: '',
        gameId: '',
        phone: '',
        address: '',
        company: '',
        uuid: ''
      };
      res.json(playerCardData);
    } catch (error) {
      console.error('获取选手卡数据失败:', error);
      res.status(500).json({ error: '获取选手卡数据失败，请联系管理员' });
    }
  }
  
  // 保存选手卡数据
  static async savePlayerCardData(req, res) {
    try {
      const playerCardData = req.body;
      // 保存到数据库（带唯一标识）
      const result = await MatchModel.savePlayerCardWithUUID(playerCardData);
      res.json({ message: '选手卡数据保存成功', uuid: result.uuid });
    } catch (error) {
      console.error('保存选手卡数据失败:', error);
      res.status(500).json({ error: '保存选手卡数据失败，请联系管理员' });
    }
  }
  

};

module.exports = MatchController;