const EventModel = require('../models/eventModel');
const UserModel = require('../models/userModel');
const {
  buildPlacementTable,
  getDefaultBasicInfoContent,
  getDefaultScoringConfig,
} = require('../services/eventScoring');

const EDITABLE_EVENT_STATUSES = ['draft', 'registration'];
const EDITABLE_BASIC_INFO_STATUSES = ['draft', 'registration'];

const STATUS_LABELS = {
  draft: '筹备中',
  registration: '报名中',
  locked: '名单已锁定',
  scoring: '录入成绩',
  finished: '已结束',
};

class EventController {
  static resolveRealName(user) {
    const realName = String(user?.real_name || '').trim();
    if (realName) return realName;
    return '';
  }

  /** @deprecated use resolveRealName */
  static resolveDisplayName(user) {
    return EventController.resolveRealName(user);
  }

  static toPublicBasicInfo(row) {
    if (!row) {
      const defaults = getDefaultScoringConfig();
      return {
        content: getDefaultBasicInfoContent(),
        pointsPerKill: defaults.pointsPerKill,
        placementTable: buildPlacementTable(defaults.placementPoints),
      };
    }
    return {
      content: row.content || '',
      pointsPerKill: Number(row.points_per_kill ?? 1),
      placementTable: buildPlacementTable(row.placement_points),
    };
  }

  static toAdminBasicInfo(row) {
    if (!row) {
      const defaults = getDefaultScoringConfig();
      return {
        content: getDefaultBasicInfoContent(),
        pointsPerKill: defaults.pointsPerKill,
        placementPoints: { ...defaults.placementPoints },
      };
    }
    const placementPoints = row.placement_points || getDefaultScoringConfig().placementPoints;
    return {
      content: row.content || '',
      pointsPerKill: Number(row.points_per_kill ?? 1),
      placementPoints: Object.fromEntries(
        Array.from({ length: 16 }, (_, index) => {
          const rank = index + 1;
          return [rank, Number(placementPoints[rank] ?? placementPoints[String(rank)] ?? 0)];
        })
      ),
    };
  }

  static async withBasicInfo(event) {
    if (!event) return null;
    const basicInfoRow = await EventModel.ensureBasicInfo(event.id);
    return {
      ...EventController.toPublicEvent(event),
      basicInfo: EventController.toPublicBasicInfo(basicInfoRow),
    };
  }

  static toPublicEvent(event) {
    if (!event) return null;
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      status: event.status,
      statusLabel: STATUS_LABELS[event.status] || event.status,
      teamCount: event.team_count,
      slotsPerTeam: event.slots_per_team,
      registrationOpenAt: event.registration_open_at,
      registrationCloseAt: event.registration_close_at,
      lockedAt: event.locked_at,
      finishedAt: event.finished_at,
      requirePubgBinding: Boolean(event.require_pubg_binding),
      createdAt: event.created_at,
    };
  }

  static mapJoinError(code) {
    const map = {
      NOT_REGISTRATION: { status: 400, message: '当前不在报名阶段' },
      ALREADY_JOINED: { status: 400, message: '你已在队伍中，请先离队再换队' },
      SLOT_NOT_FOUND: { status: 404, message: '槽位不存在' },
      SLOT_TAKEN: { status: 400, message: '该槽位已被占用' },
      PUBG_REQUIRED: { status: 400, message: '请先绑定 PUBG 账号后再报名' },
      NOT_IN_TEAM: { status: 400, message: '你当前未加入任何队伍' },
    };
    return map[code] || { status: 400, message: '操作失败' };
  }

  static async getCurrent(req, res) {
    try {
      const event = await EventModel.getCurrentForUser();
      if (!event) {
        return res.json({ event: null, mySlot: null });
      }
      const mySlot = await EventModel.getUserSlot(event.id, req.user.id);
      res.json({
        event: await EventController.withBasicInfo(event),
        mySlot: mySlot
          ? {
              teamId: mySlot.event_team_id,
              teamNumber: mySlot.team_number,
              teamName: mySlot.team_name,
              slotIndex: mySlot.slot_index,
              role: mySlot.slot_index === 0 ? 'captain' : 'member',
            }
          : null,
      });
    } catch (error) {
      console.error('获取当前杯赛失败:', error);
      res.status(500).json({ error: '获取杯赛信息失败' });
    }
  }

  static async getLobby(req, res) {
    try {
      const event = await EventModel.getCurrentForUser();
      if (!event) {
        return res.json({ event: null, teams: [] });
      }
      const [teams, slots] = await Promise.all([
        EventModel.getTeams(event.id),
        EventModel.refreshSlotSparkScores(event.id).then(() => EventModel.getSlotsByEvent(event.id)),
      ]);
      const mySlot = await EventModel.getUserSlot(event.id, req.user.id);
      res.json({
        event: await EventController.withBasicInfo(event),
        teams: EventModel.buildLobby(teams, slots),
        mySlot: mySlot
          ? {
              teamId: mySlot.event_team_id,
              teamNumber: mySlot.team_number,
              teamName: mySlot.team_name,
              slotIndex: mySlot.slot_index,
            }
          : null,
      });
    } catch (error) {
      console.error('获取报名大厅失败:', error);
      res.status(500).json({ error: '获取报名大厅失败' });
    }
  }

  static async getTeam(req, res) {
    try {
      const event = await EventModel.getCurrentForUser();
      if (!event) {
        return res.status(404).json({ error: '暂无杯赛' });
      }
      const teamId = Number(req.params.teamId);
      await EventModel.refreshSlotSparkScores(event.id);
      const data = await EventModel.getTeamWithSlots(event.id, teamId);
      if (!data) {
        return res.status(404).json({ error: '队伍不存在' });
      }
      res.json({
        event: await EventController.withBasicInfo(event),
        team: data.team,
        slots: data.slots.map((s) => {
          const realName = EventModel.resolveSlotRealName(s);
          return {
            id: s.id,
            slotIndex: s.slot_index,
            role: s.slot_index === 0 ? 'captain' : 'member',
            userId: s.user_id,
            realName,
            displayName: realName,
            avatar: s.avatar,
            pubgPlayerName: EventModel.resolveSlotPubgName(s),
            sparkScore: EventModel.resolveSparkScore(s),
            occupied: Boolean(s.user_id),
          };
        }),
      });
    } catch (error) {
      console.error('获取队伍详情失败:', error);
      res.status(500).json({ error: '获取队伍详情失败' });
    }
  }

  static async joinSlot(req, res) {
    try {
      const event = await EventModel.getActiveEvent();
      if (!event || event.status !== 'registration') {
        return res.status(400).json({ error: '当前不在报名阶段' });
      }
      const teamId = Number(req.params.teamId);
      const slotIndex = Number(req.params.slotIndex);
      if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 4) {
        return res.status(400).json({ error: '槽位无效' });
      }
      const user = await UserModel.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ error: '用户不存在' });
      }
      const powerCache = await UserModel.getPubgPowerCache(req.user.id);
      const sparkScore = EventModel.parsePowerCacheScore(powerCache?.pubg_power_cached_json);
      const result = await EventModel.joinSlot({
        eventId: event.id,
        teamId,
        slotIndex,
        userId: req.user.id,
        displayName: EventController.resolveRealName(user) || user.username,
        pubgPlayerName: user.pubg_player_name || '',
        sparkScore,
      });
      if (!result.ok) {
        const mapped = EventController.mapJoinError(result.code);
        return res.status(mapped.status).json({ error: mapped.message });
      }
      const mySlot = await EventModel.getUserSlot(event.id, req.user.id);
      res.json({
        message: '加入成功',
        mySlot: mySlot
          ? {
              teamId: mySlot.event_team_id,
              teamNumber: mySlot.team_number,
              teamName: mySlot.team_name,
              slotIndex: mySlot.slot_index,
            }
          : null,
      });
    } catch (error) {
      console.error('加入队伍失败:', error);
      res.status(500).json({ error: '加入队伍失败' });
    }
  }

  static async leave(req, res) {
    try {
      const event = await EventModel.getActiveEvent();
      if (!event) {
        return res.status(404).json({ error: '暂无进行中的杯赛' });
      }
      const result = await EventModel.leave(event.id, req.user.id);
      if (!result.ok) {
        const mapped = EventController.mapJoinError(result.code);
        return res.status(mapped.status).json({ error: mapped.message });
      }
      res.json({ message: '已离队' });
    } catch (error) {
      console.error('离队失败:', error);
      res.status(500).json({ error: '离队失败' });
    }
  }

  // —— 管理端 ——

  static async listAll(req, res) {
    try {
      const events = await EventModel.listAll();
      const rows = await Promise.all(
        events.map(async (event) => {
          const basicInfoRow = await EventModel.ensureBasicInfo(event.id);
          return {
            ...EventController.toPublicEvent(event),
            basicInfo: EventController.toAdminBasicInfo(basicInfoRow),
            basicInfoEditable: EDITABLE_BASIC_INFO_STATUSES.includes(event.status),
          };
        })
      );
      res.json(rows);
    } catch (error) {
      console.error('获取杯赛列表失败:', error);
      res.status(500).json({ error: '获取杯赛列表失败' });
    }
  }

  static async create(req, res) {
    try {
      const title = String(req.body?.title || '').trim();
      if (!title) {
        return res.status(400).json({ error: '杯赛标题不能为空' });
      }
      const id = await EventModel.create({
        title,
        description: req.body?.description || '',
        registration_open_at: req.body?.registration_open_at || null,
        registration_close_at: req.body?.registration_close_at || null,
        require_pubg_binding: req.body?.require_pubg_binding !== false,
        created_by: req.user.id,
      });
      const event = await EventModel.findById(id);
      res.status(201).json({
        message: '杯赛已创建',
        event: await EventController.withBasicInfo(event),
      });
    } catch (error) {
      console.error('创建杯赛失败:', error);
      res.status(500).json({ error: '创建杯赛失败' });
    }
  }

  static async update(req, res) {
    try {
      const id = Number(req.params.id);
      const event = await EventModel.findById(id);
      if (!event) {
        return res.status(404).json({ error: '杯赛不存在' });
      }
      if (!EDITABLE_EVENT_STATUSES.includes(event.status)) {
        return res.status(400).json({ error: '仅筹备中或报名中的杯赛可编辑' });
      }
      await EventModel.update(id, {
        title: req.body?.title,
        description: req.body?.description,
        registration_open_at: req.body?.registration_open_at,
        registration_close_at: req.body?.registration_close_at,
        require_pubg_binding: req.body?.require_pubg_binding,
      });
      const updated = await EventModel.findById(id);
      res.json({
        message: '更新成功',
        event: await EventController.withBasicInfo(updated),
      });
    } catch (error) {
      console.error('更新杯赛失败:', error);
      res.status(500).json({ error: '更新杯赛失败' });
    }
  }

  static async getBasicInfo(req, res) {
    try {
      const id = Number(req.params.id);
      const event = await EventModel.findById(id);
      if (!event) return res.status(404).json({ error: '杯赛不存在' });
      const basicInfoRow = await EventModel.ensureBasicInfo(id);
      res.json({
        eventId: id,
        status: event.status,
        editable: EDITABLE_BASIC_INFO_STATUSES.includes(event.status),
        basicInfo: EventController.toAdminBasicInfo(basicInfoRow),
      });
    } catch (error) {
      console.error('获取杯赛基础信息失败:', error);
      res.status(500).json({ error: '获取杯赛基础信息失败' });
    }
  }

  static async updateBasicInfo(req, res) {
    try {
      const id = Number(req.params.id);
      const event = await EventModel.findById(id);
      if (!event) return res.status(404).json({ error: '杯赛不存在' });
      if (!EDITABLE_BASIC_INFO_STATUSES.includes(event.status)) {
        return res.status(400).json({ error: '名单锁定后不可修改基础信息' });
      }
      const body = req.body || {};
      const result = await EventModel.upsertBasicInfo(
        id,
        {
          content: body.content,
          placementPoints: body.placementPoints ?? body.placement_points,
          pointsPerKill: body.pointsPerKill ?? body.points_per_kill,
        },
        req.user.id
      );
      if (!result.ok) {
        return res.status(400).json({ error: result.message || '保存失败' });
      }
      res.json({
        message: '基础信息已保存',
        basicInfo: EventController.toAdminBasicInfo(result.basicInfo),
      });
    } catch (error) {
      console.error('更新杯赛基础信息失败:', error);
      res.status(500).json({ error: '更新杯赛基础信息失败' });
    }
  }

  static async publish(req, res) {
    try {
      const id = Number(req.params.id);
      const result = await EventModel.publish(id);
      if (!result.ok) {
        if (result.code === 'NOT_FOUND') return res.status(404).json({ error: '杯赛不存在' });
        if (result.code === 'NOT_DRAFT') return res.status(400).json({ error: '仅筹备中的杯赛可发布' });
        if (result.code === 'ACTIVE_EXISTS') {
          return res.status(400).json({ error: '已有进行中的杯赛，请先结束或锁定当前杯赛' });
        }
        return res.status(400).json({ error: '发布失败' });
      }
      const event = await EventModel.findById(id);
      res.json({ message: '杯赛已发布，报名开放', event: EventController.toPublicEvent(event) });
    } catch (error) {
      console.error('发布杯赛失败:', error);
      res.status(500).json({ error: '发布杯赛失败' });
    }
  }

  static async lock(req, res) {
    try {
      const id = Number(req.params.id);
      const ok = await EventModel.lock(id);
      if (!ok) {
        return res.status(400).json({ error: '仅报名中的杯赛可锁定名单' });
      }
      const event = await EventModel.findById(id);
      res.json({ message: '名单已锁定', event: EventController.toPublicEvent(event) });
    } catch (error) {
      console.error('锁定名单失败:', error);
      res.status(500).json({ error: '锁定名单失败' });
    }
  }

  static async clearSlot(req, res) {
    try {
      const slotId = Number(req.params.slotId);
      const result = await EventModel.clearSlot(slotId);
      if (!result.ok) {
        return res.status(404).json({ error: '槽位不存在' });
      }
      res.json({ message: '已清空该槽位' });
    } catch (error) {
      console.error('清空槽位失败:', error);
      res.status(500).json({ error: '清空槽位失败' });
    }
  }

  static toPublicRound(round) {
    return {
      id: round.id,
      roundNo: round.round_no,
      mapName: round.map_name,
      status: round.status,
      completedAt: round.completed_at,
    };
  }

  static toPublicResult(row, members = []) {
    return {
      teamId: row.event_team_id,
      teamNumber: row.team_number,
      teamName: row.team_name,
      placement: row.placement,
      kills: row.kills,
      placementPoints: row.placement_points,
      killPoints: row.kill_points,
      totalPoints: row.total_points,
      hasMemberDetails: Boolean(row.has_member_details),
      members: members.map((member) => EventModel.mapPublicMemberResult(member)),
    };
  }

  static async getCurrentTeamRoundDetails(req, res) {
    try {
      const event = await EventModel.getCurrentForUser();
      if (!event) {
        return res.status(404).json({ error: '暂无杯赛' });
      }
      const teamId = Number(req.params.teamId);
      const data = await EventModel.getTeamRoundDetails(event.id, teamId);
      if (!data) {
        return res.status(404).json({ error: '队伍不存在' });
      }
      res.json({
        event: await EventController.withBasicInfo(event),
        ...data,
      });
    } catch (error) {
      console.error('获取队伍局次详情失败:', error);
      res.status(500).json({ error: '获取队伍局次详情失败' });
    }
  }

  static async getEventTeamRoundDetails(req, res) {
    try {
      const eventId = Number(req.params.id);
      const teamId = Number(req.params.teamId);
      const event = await EventModel.findById(eventId);
      if (!event) return res.status(404).json({ error: '杯赛不存在' });
      const data = await EventModel.getTeamRoundDetails(eventId, teamId);
      if (!data) return res.status(404).json({ error: '队伍不存在' });
      res.json(data);
    } catch (error) {
      console.error('获取队伍局次详情失败:', error);
      res.status(500).json({ error: '获取队伍局次详情失败' });
    }
  }

  static async getCurrentRounds(req, res) {
    try {
      const event = await EventModel.getCurrentForUser();
      if (!event) {
        return res.json({ event: null, rounds: [] });
      }
      const rounds = await EventModel.getRounds(event.id);
      res.json({
        event: await EventController.withBasicInfo(event),
        rounds: rounds.map(EventController.toPublicRound),
      });
    } catch (error) {
      console.error('获取局次列表失败:', error);
      res.status(500).json({ error: '获取局次列表失败' });
    }
  }

  static async getCurrentStandings(req, res) {
    try {
      const event = await EventModel.getCurrentForUser();
      if (!event) {
        return res.json({ event: null, standings: [], rounds: [] });
      }
      const data = await EventModel.getStandingsData(event.id);
      res.json({
        event: await EventController.withBasicInfo(data.event),
        rounds: data.rounds.map(EventController.toPublicRound),
        standings: data.standings,
      });
    } catch (error) {
      console.error('获取积分榜失败:', error);
      res.status(500).json({ error: '获取积分榜失败' });
    }
  }

  static async getCurrentMemberKillLeaderboard(req, res) {
    try {
      const event = await EventModel.getCurrentForUser();
      if (!event) {
        return res.json({ event: null, leaderboard: [] });
      }
      const leaderboard = await EventModel.getMemberKillLeaderboard(event.id);
      res.json({
        event: await EventController.withBasicInfo(event),
        leaderboard,
      });
    } catch (error) {
      console.error('获取个人击杀榜失败:', error);
      res.status(500).json({ error: '获取个人击杀榜失败' });
    }
  }

  static async listHistory(req, res) {
    try {
      const items = await EventModel.listFinishedEvents();
      res.json({ items });
    } catch (error) {
      console.error('获取历史赛季列表失败:', error);
      res.status(500).json({ error: '获取历史赛季列表失败' });
    }
  }

  static async getHistoryArchive(req, res) {
    try {
      const eventId = Number(req.params.id);
      const archive = await EventModel.getEventArchive(eventId);
      if (!archive) {
        return res.status(404).json({ error: '赛季不存在或未结束' });
      }
      res.json({
        event: {
          ...EventController.toPublicEvent(archive.event),
          basicInfo: EventController.toPublicBasicInfo(archive.basicInfo),
        },
        rounds: archive.rounds.map(EventController.toPublicRound),
        standings: archive.standings,
        leaderboard: archive.leaderboard,
        summary: archive.summary,
      });
    } catch (error) {
      console.error('获取历史赛季详情失败:', error);
      res.status(500).json({ error: '获取历史赛季详情失败' });
    }
  }

  static async getHistoryTeamRoundDetails(req, res) {
    try {
      const eventId = Number(req.params.id);
      const event = await EventModel.findById(eventId);
      if (!event || event.status !== 'finished') {
        return res.status(404).json({ error: '赛季不存在或未结束' });
      }
      const teamId = Number(req.params.teamId);
      const data = await EventModel.getTeamRoundDetails(eventId, teamId);
      if (!data) {
        return res.status(404).json({ error: '队伍不存在' });
      }
      res.json({
        team: {
          id: data.team.id,
          teamNumber: data.team.team_number,
          teamName: data.team.team_name,
        },
        rounds: data.rounds,
      });
    } catch (error) {
      console.error('获取历史队伍详情失败:', error);
      res.status(500).json({ error: '获取历史队伍详情失败' });
    }
  }

  static async getCurrentRoundResults(req, res) {
    try {
      const event = await EventModel.getCurrentForUser();
      if (!event) {
        return res.status(404).json({ error: '暂无杯赛' });
      }
      const roundId = Number(req.params.roundId);
      const round = await EventModel.getRoundById(roundId, event.id);
      if (!round) {
        return res.status(404).json({ error: '局次不存在' });
      }
      const results = await EventModel.getRoundResults(roundId);
      const memberMap = await EventModel.getRoundMemberResultsMap(roundId);
      res.json({
        event: await EventController.withBasicInfo(event),
        round: EventController.toPublicRound(round),
        results: results.map((row) => EventController.toPublicResult(
          row,
          memberMap.get(row.event_team_id) || []
        )),
      });
    } catch (error) {
      console.error('获取局次成绩失败:', error);
      res.status(500).json({ error: '获取局次成绩失败' });
    }
  }

  static async startScoring(req, res) {
    try {
      const id = Number(req.params.id);
      const ok = await EventModel.startScoring(id);
      if (!ok) {
        return res.status(400).json({ error: '仅名单已锁定的杯赛可开始录分' });
      }
      const event = await EventModel.findById(id);
      res.json({ message: '已进入录分阶段', event: EventController.toPublicEvent(event) });
    } catch (error) {
      console.error('开始录分失败:', error);
      res.status(500).json({ error: '开始录分失败' });
    }
  }

  static async finish(req, res) {
    try {
      const id = Number(req.params.id);
      const result = await EventModel.finish(id);
      if (!result.ok) {
        const status = result.code === 'NOT_FOUND' ? 404 : 400;
        return res.status(status).json({ error: result.message || '结束杯赛失败' });
      }
      const event = await EventModel.findById(id);
      res.json({ message: '杯赛已结束', event: EventController.toPublicEvent(event) });
    } catch (error) {
      console.error('结束杯赛失败:', error);
      res.status(500).json({ error: '结束杯赛失败' });
    }
  }

  static async createRound(req, res) {
    try {
      const eventId = Number(req.params.id);
      const rounds = await EventModel.getRounds(eventId);
      const roundNo = Number(req.body?.round_no ?? req.body?.roundNo) || rounds.length + 1;
      const mapName = req.body?.map_name ?? req.body?.mapName ?? null;
      const result = await EventModel.createRound(eventId, { roundNo, mapName });
      if (!result.ok) {
        if (result.code === 'NOT_FOUND') return res.status(404).json({ error: '杯赛不存在' });
        if (result.code === 'INVALID_STATUS') {
          return res.status(400).json({ error: '当前状态不可新建局次' });
        }
        return res.status(400).json({ error: '新建局次失败' });
      }
      const round = await EventModel.getRoundById(result.roundId, eventId);
      res.status(201).json({
        message: '局次已创建',
        round: EventController.toPublicRound(round),
      });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ error: '局次编号已存在' });
      }
      console.error('新建局次失败:', error);
      res.status(500).json({ error: '新建局次失败' });
    }
  }

  static async getEventRounds(req, res) {
    try {
      const eventId = Number(req.params.id);
      const event = await EventModel.findById(eventId);
      if (!event) return res.status(404).json({ error: '杯赛不存在' });
      const [rounds, teams, roster] = await Promise.all([
        EventModel.getRounds(eventId),
        EventModel.getTeams(eventId),
        EventModel.getEventRoster(eventId),
      ]);
      res.json({
        event: await EventController.withBasicInfo(event),
        rounds: rounds.map(EventController.toPublicRound),
        teams: teams.map((t) => ({
          id: t.id,
          teamNumber: t.team_number,
          teamName: t.team_name,
        })),
        roster,
      });
    } catch (error) {
      console.error('获取局次失败:', error);
      res.status(500).json({ error: '获取局次失败' });
    }
  }

  static async saveRoundResults(req, res) {
    try {
      const eventId = Number(req.params.id);
      const roundId = Number(req.params.roundId);
      const raw = req.body?.results || [];
      const results = raw.map((row) => ({
        eventTeamId: row.eventTeamId ?? row.event_team_id,
        placement: row.placement,
        kills: row.kills ?? 0,
        members: Array.isArray(row.members)
          ? row.members.map((member) => ({
            slotIndex: member.slotIndex ?? member.slot_index,
            kills: member.kills ?? 0,
          }))
          : [],
      }));
      const result = await EventModel.saveRoundResults({
        eventId,
        roundId,
        results,
        updatedBy: req.user.id,
      });
      if (!result.ok) {
        if (result.code === 'NOT_FOUND') return res.status(404).json({ error: '杯赛不存在' });
        if (result.code === 'ROUND_NOT_FOUND') return res.status(404).json({ error: '局次不存在' });
        if (result.code === 'VALIDATION') return res.status(400).json({ error: result.message });
        if (result.code === 'INVALID_STATUS') return res.status(400).json({ error: '当前状态不可录分' });
        return res.status(400).json({ error: '保存失败' });
      }
      const saved = await EventModel.getRoundResults(roundId);
      const memberMap = await EventModel.getRoundMemberResultsMap(roundId);
      res.json({
        message: '成绩已保存',
        results: saved.map((row) => EventController.toPublicResult(
          row,
          memberMap.get(row.event_team_id) || []
        )),
      });
    } catch (error) {
      console.error('保存局次成绩失败:', error);
      res.status(500).json({ error: '保存局次成绩失败' });
    }
  }

  static async completeRound(req, res) {
    try {
      const eventId = Number(req.params.id);
      const roundId = Number(req.params.roundId);
      const result = await EventModel.completeRound(eventId, roundId);
      if (!result.ok) {
        if (result.code === 'ROUND_NOT_FOUND') return res.status(404).json({ error: '局次不存在' });
        if (result.code === 'INCOMPLETE') return res.status(400).json({ error: result.message });
        return res.status(400).json({ error: '完成局次失败' });
      }
      const round = await EventModel.getRoundById(roundId, eventId);
      res.json({ message: '局次已完成', round: EventController.toPublicRound(round) });
    } catch (error) {
      console.error('完成局次失败:', error);
      res.status(500).json({ error: '完成局次失败' });
    }
  }

  static async getEventStandings(req, res) {
    try {
      const eventId = Number(req.params.id);
      const data = await EventModel.getStandingsData(eventId);
      if (!data) return res.status(404).json({ error: '杯赛不存在' });
      res.json({
        event: await EventController.withBasicInfo(data.event),
        rounds: data.rounds.map(EventController.toPublicRound),
        standings: data.standings,
      });
    } catch (error) {
      console.error('获取积分榜失败:', error);
      res.status(500).json({ error: '获取积分榜失败' });
    }
  }

  static async getEventRoundResults(req, res) {
    try {
      const eventId = Number(req.params.id);
      const roundId = Number(req.params.roundId);
      const round = await EventModel.getRoundById(roundId, eventId);
      if (!round) return res.status(404).json({ error: '局次不存在' });
      const results = await EventModel.getRoundResults(roundId);
      const memberMap = await EventModel.getRoundMemberResultsMap(roundId);
      res.json({
        round: EventController.toPublicRound(round),
        results: results.map((row) => EventController.toPublicResult(
          row,
          memberMap.get(row.event_team_id) || []
        )),
      });
    } catch (error) {
      console.error('获取局次成绩失败:', error);
      res.status(500).json({ error: '获取局次成绩失败' });
    }
  }
}

module.exports = EventController;
