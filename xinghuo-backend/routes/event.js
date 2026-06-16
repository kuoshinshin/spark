const express = require('express');
const EventController = require('../controllers/eventController');
const { verifyToken, verifyUser, verifyAdmin } = require('../middleware/auth');

const router = express.Router();

// 用户端（需登录）
router.get('/current', verifyToken, verifyUser, EventController.getCurrent);
router.get('/current/lobby', verifyToken, verifyUser, EventController.getLobby);
router.get('/current/teams/:teamId', verifyToken, verifyUser, EventController.getTeam);
router.post(
  '/current/teams/:teamId/slots/:slotIndex/join',
  verifyToken,
  verifyUser,
  EventController.joinSlot
);
router.post('/current/leave', verifyToken, verifyUser, EventController.leave);
router.get('/current/teams/:teamId/round-details', verifyToken, verifyUser, EventController.getCurrentTeamRoundDetails);
router.get('/current/rounds', verifyToken, verifyUser, EventController.getCurrentRounds);
router.get('/current/standings', verifyToken, verifyUser, EventController.getCurrentStandings);
router.get('/current/member-kills', verifyToken, verifyUser, EventController.getCurrentMemberKillLeaderboard);
router.get('/history', verifyToken, verifyUser, EventController.listHistory);
router.get('/history/:id', verifyToken, verifyUser, EventController.getHistoryArchive);
router.get('/history/:id/teams/:teamId/round-details', verifyToken, verifyUser, EventController.getHistoryTeamRoundDetails);
router.get('/current/rounds/:roundId/results', verifyToken, verifyUser, EventController.getCurrentRoundResults);

// 管理端
router.get('/', verifyToken, verifyAdmin, EventController.listAll);
router.post('/', verifyToken, verifyAdmin, EventController.create);
router.put('/:id/basic-info', verifyToken, verifyAdmin, EventController.updateBasicInfo);
router.get('/:id/basic-info', verifyToken, verifyAdmin, EventController.getBasicInfo);
router.put('/:id', verifyToken, verifyAdmin, EventController.update);
router.post('/:id/publish', verifyToken, verifyAdmin, EventController.publish);
router.post('/:id/lock', verifyToken, verifyAdmin, EventController.lock);
router.post('/:id/start-scoring', verifyToken, verifyAdmin, EventController.startScoring);
router.post('/:id/finish', verifyToken, verifyAdmin, EventController.finish);
router.get('/:id/teams/:teamId/round-details', verifyToken, verifyAdmin, EventController.getEventTeamRoundDetails);
router.get('/:id/rounds', verifyToken, verifyAdmin, EventController.getEventRounds);
router.post('/:id/rounds', verifyToken, verifyAdmin, EventController.createRound);
router.get('/:id/standings', verifyToken, verifyAdmin, EventController.getEventStandings);
router.get('/:id/rounds/:roundId/results', verifyToken, verifyAdmin, EventController.getEventRoundResults);
router.put('/:id/rounds/:roundId/results', verifyToken, verifyAdmin, EventController.saveRoundResults);
router.post('/:id/rounds/:roundId/complete', verifyToken, verifyAdmin, EventController.completeRound);
router.delete('/slots/:slotId', verifyToken, verifyAdmin, EventController.clearSlot);

module.exports = router;
