const pool = require('../config/db');

class NotificationModel {
  static initialized = false;

  static async ensureTable() {
    if (NotificationModel.initialized) return;

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS post_notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        recipient_user_id INT NOT NULL,
        actor_user_id INT NOT NULL,
        post_id INT NOT NULL,
        comment_id INT NULL,
        type ENUM('post_like', 'post_comment') NOT NULL,
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_notifications_recipient_read_created (recipient_user_id, is_read, created_at),
        INDEX idx_notifications_post (post_id),
        CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_notifications_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_notifications_post FOREIGN KEY (post_id) REFERENCES chats(id) ON DELETE CASCADE,
        CONSTRAINT fk_notifications_comment FOREIGN KEY (comment_id) REFERENCES post_comments(id) ON DELETE CASCADE
      )
    `);

    NotificationModel.initialized = true;
  }

  static async create({ recipientUserId, actorUserId, postId, type, commentId = null }) {
    await NotificationModel.ensureTable();
    if (!recipientUserId || !actorUserId || !postId || !type) return;
    if (Number(recipientUserId) === Number(actorUserId)) return;

    await pool.execute(
      `INSERT INTO post_notifications
       (recipient_user_id, actor_user_id, post_id, comment_id, type)
       VALUES (?, ?, ?, ?, ?)`,
      [recipientUserId, actorUserId, postId, commentId, type]
    );
  }

  static async listByRecipient(recipientUserId, limit = 50) {
    await NotificationModel.ensureTable();
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);

    const [rows] = await pool.execute(
      `SELECT
         n.id,
         n.type,
         n.post_id AS postId,
         n.comment_id AS commentId,
         n.is_read AS isRead,
         n.created_at AS createdAt,
         u.username AS actorName,
         u.avatar AS actorAvatar,
         c.content AS postContent
       FROM post_notifications n
       JOIN users u ON u.id = n.actor_user_id
       JOIN chats c ON c.id = n.post_id
       WHERE n.recipient_user_id = ?
       ORDER BY n.created_at DESC
       LIMIT ${safeLimit}`,
      [recipientUserId]
    );

    return rows;
  }

  static async unreadCount(recipientUserId) {
    await NotificationModel.ensureTable();
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM post_notifications
       WHERE recipient_user_id = ? AND is_read = 0`,
      [recipientUserId]
    );
    return Number(rows?.[0]?.total || 0);
  }

  static async markRead(notificationId, recipientUserId) {
    await NotificationModel.ensureTable();
    const [result] = await pool.execute(
      `UPDATE post_notifications
       SET is_read = 1
       WHERE id = ? AND recipient_user_id = ?`,
      [notificationId, recipientUserId]
    );
    return result.affectedRows > 0;
  }

  static async markAllRead(recipientUserId) {
    await NotificationModel.ensureTable();
    await pool.execute(
      `UPDATE post_notifications
       SET is_read = 1
       WHERE recipient_user_id = ? AND is_read = 0`,
      [recipientUserId]
    );
  }
}

module.exports = NotificationModel;
