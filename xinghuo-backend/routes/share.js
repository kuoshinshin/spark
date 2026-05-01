const express = require('express');
const ShareController = require('../controllers/shareController');
const { verifyToken } = require('../middleware/auth');
const router = express.Router();

// 获取帖子列表（需要认证）
router.get('/all', verifyToken, ShareController.getPosts);

// 创建新帖子（需要认证）
router.post('/create', verifyToken, ShareController.createPost);

// 点赞帖子（需要认证）
router.post('/like', verifyToken, ShareController.likePost);

module.exports = router;