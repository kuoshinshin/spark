const express = require('express');
const ChatController = require('../controllers/chatController');
const { verifyToken } = require('../middleware/auth');
const { postMediaUpload } = require('../middleware/uploadPostMedia');
const router = express.Router();

const handlePostMediaUpload = (req, res, next) => {
  postMediaUpload.single('media')(req, res, (err) => {
    if (err) {
      let msg = err.message || '上传失败';
      if (err.code === 'LIMIT_FILE_SIZE') msg = '图片大小不能超过 5MB';
      return res.status(400).json({ error: msg });
    }
    next();
  });
};

// 上传帖子图片（需要认证）
router.post('/media', verifyToken, handlePostMediaUpload, ChatController.uploadMedia);

// 发送消息（需要认证）
router.post('/send', verifyToken, ChatController.sendMessage);

// 获取所有消息（需要认证）
router.get('/all', verifyToken, ChatController.getAllMessages);

// 获取热门消息（需要认证）
router.get('/hottest', verifyToken, ChatController.getHottestMessages);

// 获取用户的消息（需要认证）
router.get('/user', verifyToken, ChatController.getUserMessages);

// 点赞消息（需要认证）
router.post('/like', verifyToken, ChatController.likeMessage);

// 取消点赞（需要认证）
router.post('/unlike', verifyToken, ChatController.unlikeMessage);

// 检查是否已点赞（需要认证）
router.get('/check-like', verifyToken, ChatController.checkLike);

// 创建评论（需要认证）
router.post('/comment', verifyToken, ChatController.createComment);

// 获取评论（需要认证）
router.get('/comments', verifyToken, ChatController.getComments);

// 回复评论（需要认证）
router.post('/reply', verifyToken, ChatController.replyToComment);

// 点赞评论（需要认证）
router.post('/comment/like', verifyToken, ChatController.likeComment);

// 取消点赞评论（需要认证）
router.post('/comment/unlike', verifyToken, ChatController.unlikeComment);

// 点踩评论（需要认证）
router.post('/comment/dislike', verifyToken, ChatController.dislikeComment);

// 取消点踩评论（需要认证）
router.post('/comment/undislike', verifyToken, ChatController.undislikeComment);

// 删除消息（需要认证）
router.delete('/:id', verifyToken, ChatController.deleteMessage);

module.exports = router;