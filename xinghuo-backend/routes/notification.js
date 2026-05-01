const express = require('express');
const NotificationController = require('../controllers/notificationController');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.get('/my', verifyToken, NotificationController.listMyNotifications);
router.get('/unread-count', verifyToken, NotificationController.getUnreadCount);
router.post('/:id/read', verifyToken, NotificationController.markRead);
router.post('/read-all', verifyToken, NotificationController.markAllRead);

module.exports = router;
