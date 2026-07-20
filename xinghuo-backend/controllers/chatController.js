const ChatModel = require('../models/chatModel');
const NotificationModel = require('../models/notificationModel');
const fs = require('fs');

class ChatController {
  static formatChatRow(row) {
    if (!row) return row;
    const media = row.media || null;
    const mediaType = row.media_type || row.mediaType || (media ? 'image' : null);
    return {
      ...row,
      media,
      mediaType,
      userId: row.user_id ?? row.userId,
      createdAt: row.created_at || row.createdAt,
    };
  }

  static formatChatList(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => ChatController.formatChatRow(row));
  }

  // 上传圈子帖子图片
  static async uploadMedia(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: '请选择要上传的图片' });
      }
      const publicPath = `/uploads/posts/${req.file.filename}`;
      res.json({ message: '上传成功', url: publicPath, media: publicPath });
    } catch (error) {
      console.error('上传帖子图片失败:', error);
      if (req.file?.path) {
        try {
          await fs.promises.unlink(req.file.path);
        } catch (_) {}
      }
      res.status(500).json({ error: '上传帖子图片失败，请稍后重试' });
    }
  }

  // 发送消息（支持媒体）
  static async sendMessage(req, res) {
    try {
      const userId = req.user.id;
      const { content, media, mediaType } = req.body;
      
      if (!content || content.trim() === '') {
        return res.status(400).json({ error: '消息内容不能为空' });
      }
      
      const result = await ChatModel.create(userId, content, media, mediaType);
      
      // 获取新创建的消息（包含完整信息）
      const [newMessage] = await ChatModel.getAll();

      res.status(201).json(ChatController.formatChatRow(newMessage));
    } catch (error) {
      console.error('发送消息失败:', error);
      res.status(500).json({ error: '发送消息失败，请联系管理员' });
    }
  }
  
  // 获取所有消息（最新）
  static async getAllMessages(req, res) {
    try {
      const messages = await ChatModel.getAll();
      res.json(ChatController.formatChatList(messages));
    } catch (error) {
      console.error('获取消息失败:', error);
      res.status(500).json({ error: '获取消息失败，请联系管理员' });
    }
  }
  
  // 获取热门消息
  static async getHottestMessages(req, res) {
    try {
      const messages = await ChatModel.getHottest();
      res.json(ChatController.formatChatList(messages));
    } catch (error) {
      console.error('获取热门消息失败:', error);
      res.status(500).json({ error: '获取热门消息失败，请联系管理员' });
    }
  }
  
  // 获取用户的消息
  static async getUserMessages(req, res) {
    try {
      const userId = req.user.id;
      const messages = await ChatModel.getByUserId(userId);
      res.json(ChatController.formatChatList(messages));
    } catch (error) {
      console.error('获取用户消息失败:', error);
      res.status(500).json({ error: '获取用户消息失败，请联系管理员' });
      res.status(500).json({ error: '获取用户消息失败，请联系管理员' });
    }
  }
  
  // 点赞消息
  static async likeMessage(req, res) {
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

      const recipientUserId = await ChatModel.getPostOwnerId(postId);
      await NotificationModel.create({
        recipientUserId,
        actorUserId: userId,
        postId,
        type: 'post_like',
      });
      
      res.json({ message: '点赞成功' });
    } catch (error) {
      console.error('点赞失败:', error);
      res.status(500).json({ error: '点赞失败，请联系管理员' });
    }
  }
  
  // 取消点赞
  static async unlikeMessage(req, res) {
    try {
      const userId = req.user.id;
      const { postId } = req.body;
      
      if (!postId) {
        return res.status(400).json({ error: '帖子ID不能为空' });
      }
      
      const result = await ChatModel.removeLike(postId, userId);
      
      res.json({ message: result.removed ? '取消点赞成功' : '未点赞' });
    } catch (error) {
      console.error('取消点赞失败:', error);
      res.status(500).json({ error: '取消点赞失败，请联系管理员' });
    }
  }
  
  // 检查是否已点赞
  static async checkLike(req, res) {
    try {
      const userId = req.user.id;
      const { postId } = req.query;
      
      if (!postId) {
        return res.status(400).json({ error: '帖子ID不能为空' });
      }
      
      const isLiked = await ChatModel.checkLike(postId, userId);
      res.json({ isLiked });
    } catch (error) {
      console.error('检查点赞状态失败:', error);
      res.status(500).json({ error: '检查点赞状态失败，请联系管理员' });
    }
  }
  
  // 创建评论
  static async createComment(req, res) {
    try {
      const userId = req.user.id;
      const { postId, content } = req.body;
      const trimmed = typeof content === 'string' ? content.trim() : '';
      
      if (!postId || !trimmed) {
        return res.status(400).json({ error: '帖子ID和评论内容不能为空' });
      }

      const duplicate = await ChatModel.findRecentDuplicateComment(postId, userId, trimmed, 20);
      if (duplicate) {
        return res.status(200).json({ ...duplicate, duplicated: true });
      }
      
      const result = await ChatModel.createComment(postId, userId, trimmed);
      const newComment = await ChatModel.getCommentById(result.insertId);
      if (!newComment) {
        return res.status(500).json({ error: '创建评论失败，请联系管理员' });
      }

      const recipientUserId = await ChatModel.getPostOwnerId(postId);
      await NotificationModel.create({
        recipientUserId,
        actorUserId: userId,
        postId,
        commentId: newComment.id,
        type: 'post_comment',
      });
      
      res.status(201).json(newComment);
    } catch (error) {
      console.error('创建评论失败:', error);
      res.status(500).json({ error: '创建评论失败，请联系管理员' });
    }
  }
  
  // 获取帖子的评论
  static async getComments(req, res) {
    try {
      const { postId } = req.query;
      
      if (!postId) {
        return res.status(400).json({ error: '帖子ID不能为空' });
      }
      
      const comments = await ChatModel.getComments(postId);
      res.json(comments);
    } catch (error) {
      console.error('获取评论失败:', error);
      res.status(500).json({ error: '获取评论失败，请联系管理员' });
    }
  }
  
  // 回复评论
  static async replyToComment(req, res) {
    try {
      const userId = req.user.id;
      const { postId, commentId, content } = req.body;
      
      if (!postId || !commentId || !content || content.trim() === '') {
        return res.status(400).json({ error: '帖子ID、评论ID和回复内容不能为空' });
      }
      
      const result = await ChatModel.replyToComment(postId, commentId, userId, content);
      
      // 获取新创建的回复（包含完整信息）
      const comments = await ChatModel.getComments(postId);
      const newReply = comments[comments.length - 1];
      
      res.status(201).json(newReply);
    } catch (error) {
      console.error('回复评论失败:', error);
      res.status(500).json({ error: '回复评论失败，请联系管理员' });
    }
  }
  
  // 点赞评论
  static async likeComment(req, res) {
    try {
      const userId = req.user.id;
      const { commentId } = req.body;
      
      if (!commentId) {
        return res.status(400).json({ error: '评论ID不能为空' });
      }
      
      const result = await ChatModel.likeComment(commentId, userId);
      
      if (result.alreadyLiked) {
        return res.status(400).json({ error: '已经点赞过了' });
      }
      
      res.json({ message: '点赞成功' });
    } catch (error) {
      console.error('点赞评论失败:', error);
      res.status(500).json({ error: '点赞评论失败，请联系管理员' });
    }
  }
  
  // 点踩评论
  static async dislikeComment(req, res) {
    try {
      const userId = req.user.id;
      const { commentId } = req.body;
      
      if (!commentId) {
        return res.status(400).json({ error: '评论ID不能为空' });
      }
      
      const result = await ChatModel.dislikeComment(commentId, userId);
      
      if (result.alreadyDisliked) {
        return res.status(400).json({ error: '已经点踩过了' });
      }
      
      res.json({ message: '点踩成功' });
    } catch (error) {
      console.error('点踩评论失败:', error);
      res.status(500).json({ error: '点踩评论失败，请联系管理员' });
    }
  }
  
  // 取消点赞评论
  static async unlikeComment(req, res) {
    try {
      const userId = req.user.id;
      const { commentId } = req.body;
      
      if (!commentId) {
        return res.status(400).json({ error: '评论ID不能为空' });
      }
      
      const result = await ChatModel.unlikeComment(commentId, userId);
      
      res.json({ message: result.removed ? '取消点赞成功' : '未点赞' });
    } catch (error) {
      console.error('取消点赞评论失败:', error);
      res.status(500).json({ error: '取消点赞评论失败，请联系管理员' });
    }
  }
  
  // 取消点踩评论
  static async undislikeComment(req, res) {
    try {
      const userId = req.user.id;
      const { commentId } = req.body;
      
      if (!commentId) {
        return res.status(400).json({ error: '评论ID不能为空' });
      }
      
      const result = await ChatModel.undislikeComment(commentId, userId);
      
      res.json({ message: result.removed ? '取消点踩成功' : '未点踩' });
    } catch (error) {
      console.error('取消点踩评论失败:', error);
      res.status(500).json({ error: '取消点踩评论失败，请联系管理员' });
    }
  }
  
  // 删除消息
  static async deleteMessage(req, res) {
    try {
      const userId = req.user.id;
      const messageId = req.params.id;
      
      // 这里可以添加权限检查，确保用户只能删除自己的消息
      // 简化处理，直接删除
      const result = await ChatModel.delete(messageId);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: '消息不存在' });
      }
      
      res.json({ message: '消息删除成功' });
    } catch (error) {
      console.error('删除消息失败:', error);
      res.status(500).json({ error: '删除消息失败，请联系管理员' });
    }
  }
}

module.exports = ChatController;