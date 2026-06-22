const express = require('express');
const BeanLobbyController = require('../controllers/beanLobbyController');
const { verifyToken, verifyUser, verifyAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/tables', verifyToken, verifyUser, BeanLobbyController.listTables);
router.post('/tables', verifyToken, verifyUser, BeanLobbyController.createTable);
router.get('/tables/:id', verifyToken, verifyUser, BeanLobbyController.getTable);
router.post('/tables/:id/join', verifyToken, verifyUser, BeanLobbyController.joinTable);
router.post('/tables/:id/leave', verifyToken, verifyUser, BeanLobbyController.leaveTable);
router.post('/tables/:id/start', verifyToken, verifyUser, BeanLobbyController.startSession);
router.post('/tables/:id/substitute', verifyToken, verifyUser, BeanLobbyController.substitute);
router.post('/tables/:id/transfer-owner', verifyToken, verifyUser, BeanLobbyController.transferOwner);

router.get('/sessions/:id', verifyToken, verifyUser, BeanLobbyController.getSession);
router.post('/sessions/:id/poll', verifyToken, verifyUser, BeanLobbyController.pollSession);
router.post('/sessions/:id/refresh-auto', verifyToken, verifyUser, BeanLobbyController.refreshAuto);
router.put('/sessions/:id/players', verifyToken, verifyUser, BeanLobbyController.updateManualPlayers);
router.post('/sessions/:id/confirm', verifyToken, verifyUser, BeanLobbyController.confirm);
router.post('/sessions/:id/reopen', verifyToken, verifyAdmin, BeanLobbyController.reopen);

module.exports = router;
