const express = require('express');
const MatchController = require('../controllers/matchController');
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const router = express.Router();

// 创建比赛（管理员）
router.post('/create', verifyToken, verifyAdmin, MatchController.createMatch);

// 获取所有比赛
router.get('/all', MatchController.getAllMatches);

// 获取即将开始的比赛
router.get('/status/upcoming', MatchController.getUpcomingMatches);

// 获取正在进行的比赛
router.get('/status/ongoing', MatchController.getOngoingMatches);

// 获取个人比赛数据
router.get('/personal', verifyToken, MatchController.getPersonalData);

// 获取赛季数据
router.get('/season/:seasonId', MatchController.getSeasonData);



// 获取规则数据
router.get('/rules', MatchController.getRulesData);

// 比赛阶段：计算积分（管理员）
router.post('/stage/score', verifyToken, verifyAdmin, MatchController.calculateStageScore);

// 赛前：提交报名
router.post('/:id/register', verifyToken, MatchController.registerForMatch);

// 单赛季报名大厅（登录后查看）
router.get('/registration/lobby', verifyToken, MatchController.getRegistrationLobby);
router.get('/registration/eligibility', verifyToken, MatchController.getMyRegistrationEligibility);
router.get('/registration/stream', verifyToken, MatchController.subscribeRegistrationStream);
router.get('/registration/teams/:teamId', verifyToken, MatchController.getRegistrationTeam);
router.post('/registration/teams/:teamId/captain', verifyToken, MatchController.claimCaptainSlot);
router.post('/registration/teams/:teamId/slots/:playerIndex/join', verifyToken, MatchController.joinTeamSlot);
router.delete('/registration/teams/:teamId/slots/:playerIndex', verifyToken, MatchController.kickTeamMember);
router.patch('/registration/teams/:teamId/name', verifyToken, MatchController.updateTeamNameByCaptain);
router.post('/registration/teams/:teamId/transfer-captain', verifyToken, MatchController.transferCaptain);
router.post('/registration/my/leave', verifyToken, MatchController.leaveMyTeam);

// 赛前：报名列表（管理员）
router.get('/:id/registrations', verifyToken, verifyAdmin, MatchController.getMatchRegistrations);

// 赛前：审核报名（管理员）
router.patch('/:id/registrations/:registrationId/review', verifyToken, verifyAdmin, MatchController.reviewMatchRegistration);

// 赛前：冻结名单（管理员）
router.post('/:id/freeze', verifyToken, verifyAdmin, MatchController.freezeRoster);

// 赛前：运营控制（管理员）
router.post('/:id/active-registration', verifyToken, verifyAdmin, MatchController.setActiveRegistration);
router.post('/:id/close-registration', verifyToken, verifyAdmin, MatchController.closeRegistration);

// 赛中：运营控制与成绩管理（管理员）
router.post('/:id/start', verifyToken, verifyAdmin, MatchController.startMatch);
router.post('/:id/complete', verifyToken, verifyAdmin, MatchController.completeMatch);
router.post('/:id/rounds', verifyToken, verifyAdmin, MatchController.createRound);
router.get('/:id/rounds', verifyToken, MatchController.getRounds);
router.post('/:id/rounds/:roundId/start', verifyToken, verifyAdmin, MatchController.startRound);
router.put('/:id/rounds/:roundId/results', verifyToken, verifyAdmin, MatchController.saveRoundResults);
router.post('/:id/rounds/:roundId/complete', verifyToken, verifyAdmin, MatchController.completeRound);
router.post('/:id/rounds/:roundId/void', verifyToken, verifyAdmin, MatchController.voidRound);
router.get('/:id/leaderboard', verifyToken, MatchController.getLeaderboard);

// 更新选手名称
router.put('/player/update', MatchController.updatePlayerName);

// 获取选手卡数据
router.get('/player-card', MatchController.getPlayerCardData);

// 保存选手卡数据
router.post('/player-card', MatchController.savePlayerCardData);





// 获取比赛详情（放在最后，避免拦截其他路由）
router.get('/:id', MatchController.getMatchById);

// 更新比赛信息（管理员）（放在最后，避免拦截其他路由）
router.put('/:id', verifyToken, verifyAdmin, MatchController.updateMatch);

// 删除比赛（管理员）（放在最后，避免拦截其他路由）
router.delete('/:id', verifyToken, verifyAdmin, MatchController.deleteMatch);

module.exports = router;