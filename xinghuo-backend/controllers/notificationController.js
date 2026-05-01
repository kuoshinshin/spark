const NotificationModel = require('../models/notificationModel');

class NotificationController {
  static async listMyNotifications(req, res) {
    try {
      const userId = req.user.id;
      const { limit } = req.query;
      const notifications = await NotificationModel.listByRecipient(userId, limit);
      res.json(notifications);
    } catch (error) {
      console.error('获取通知列表失败:', error);
      res.status(500).json({ error: '获取通知列表失败，请联系管理员' });
    }
  }

  static async getUnreadCount(req, res) {
    try {
      const userId = req.user.id;
      const unreadCount = await NotificationModel.unreadCount(userId);
      res.json({ unreadCount });
    } catch (error) {
      console.error('获取未读通知数失败:', error);
      res.status(500).json({ error: '获取未读通知数失败，请联系管理员' });
    }
  }

  static async markRead(req, res) {
    try {
      const userId = req.user.id;
      const notificationId = Number(req.params.id);
      if (!notificationId) {
        return res.status(400).json({ error: '通知ID不能为空' });
      }
      const ok = await NotificationModel.markRead(notificationId, userId);
      if (!ok) {
        return res.status(404).json({ error: '通知不存在或无权限' });
      }
      res.json({ message: '标记已读成功' });
    } catch (error) {
      console.error('标记通知已读失败:', error);
      res.status(500).json({ error: '标记通知已读失败，请联系管理员' });
    }
  }

  static async markAllRead(req, res) {
    try {
      const userId = req.user.id;
      await NotificationModel.markAllRead(userId);
      res.json({ message: '全部标记已读成功' });
    } catch (error) {
      console.error('全部标记已读失败:', error);
      res.status(500).json({ error: '全部标记已读失败，请联系管理员' });
    }
  }
}

module.exports = NotificationController;
