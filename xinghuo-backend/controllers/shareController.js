const ChatModel = require('../models/chatModel');

class ShareController {
  // 获取帖子列表
  static async getPosts(req, res) {
    try {
      const posts = await ChatModel.getAll();
      res.json(posts);
    } catch (error) {
      console.error('获取帖子失败:', error);
      res.status(500).json({ error: '获取帖子失败，请联系管理员' });
    }
  }
  
  // 创建新帖子
  static async createPost(req, res) {
    try {
      const userId = req.user.id;
      const { content, media, mediaType, postId } = req.body;
      
      // 如果是分享现有帖子
      if (postId) {
        // 获取被分享的帖子
        const originalPosts = await ChatModel.getAll();
        const postToShare = originalPosts.find(p => p.id === parseInt(postId));
        
        if (!postToShare) {
          return res.status(404).json({ error: '被分享的帖子不存在' });
        }
        
        // 创建分享帖子
        const shareContent = `分享了: ${postToShare.content}`;
        const result = await ChatModel.create(userId, shareContent, postToShare.media, postToShare.media_type);
        
        // 获取新创建的帖子（包含完整信息）
        const newPosts = await ChatModel.getAll();
        
        res.status(201).json(newPosts[0]);
      } else if (content && content.trim() !== '') {
        // 创建普通帖子
        const result = await ChatModel.create(userId, content, media, mediaType);
        
        // 获取新创建的帖子（包含完整信息）
        const newPosts = await ChatModel.getAll();
        
        res.status(201).json(newPosts[0]);
      } else {
        return res.status(400).json({ error: '帖子内容不能为空' });
      }
    } catch (error) {
      console.error('创建帖子失败:', error);
      res.status(500).json({ error: '创建帖子失败，请联系管理员' });
    }
  }
  
  // 点赞帖子
  static async likePost(req, res) {
    try {
      const userId = req.user.id;
      const { postId } = req.body;
      
      if (!postId) {
        return res.status(400).json({ error: '帖子ID不能为空' });
      }
      
      const result = await ChatModel.addLike(postId, userId);
      
      if (result.alreadyLiked) {
        return res.status(400).json({ error: '已经点赞过了' });
      }
      
      res.json({ message: '点赞成功' });
    } catch (error) {
      console.error('点赞失败:', error);
      res.status(500).json({ error: '点赞失败，请联系管理员' });
    }
  }
}

module.exports = ShareController;