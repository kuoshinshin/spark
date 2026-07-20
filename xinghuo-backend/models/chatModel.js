const pool = require('../config/db');

class ChatModel {
  // 创建聊天消息（支持媒体）
  static async create(userId, content, media = null, mediaType = null) {
    const [result] = await pool.execute(
      'INSERT INTO chats (user_id, content, media, media_type) VALUES (?, ?, ?, ?)',
      [userId, content, media, mediaType]
    );
    return result;
  }

  // 获取所有聊天消息（包含用户信息、点赞数、评论数）
  static async getAll() {
    const [rows] = await pool.execute(`
      SELECT 
        chats.*, 
        users.username, 
        users.avatar,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = chats.id) as likes
      FROM chats 
      JOIN users ON chats.user_id = users.id 
      ORDER BY chats.created_at DESC
    `);
    
    // 为每条消息添加评论列表
    for (const row of rows) {
      const [comments] = await pool.execute(`
        SELECT 
          post_comments.*, 
          users.username, 
          users.avatar 
        FROM post_comments 
        JOIN users ON post_comments.user_id = users.id 
        WHERE post_id = ? 
        ORDER BY post_comments.created_at ASC
      `, [row.id]);
      row.comments = comments;
    }
    
    return rows;
  }

  // 获取热门聊天消息（按点赞数排序）
  static async getHottest() {
    const [rows] = await pool.execute(`
      SELECT 
        chats.*, 
        users.username, 
        users.avatar,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = chats.id) as likes
      FROM chats 
      JOIN users ON chats.user_id = users.id 
      ORDER BY likes DESC, chats.created_at DESC
    `);
    
    // 为每条消息添加评论列表
    for (const row of rows) {
      const [comments] = await pool.execute(`
        SELECT 
          post_comments.*, 
          users.username, 
          users.avatar 
        FROM post_comments 
        JOIN users ON post_comments.user_id = users.id 
        WHERE post_id = ? 
        ORDER BY post_comments.created_at ASC
      `, [row.id]);
      row.comments = comments;
    }
    
    return rows;
  }

  // 获取用户的聊天消息
  static async getByUserId(userId) {
    const [rows] = await pool.execute(`
      SELECT 
        chats.*, 
        users.username, 
        users.avatar,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = chats.id) as likes
      FROM chats 
      JOIN users ON chats.user_id = users.id 
      WHERE chats.user_id = ? 
      ORDER BY chats.created_at DESC
    `, [userId]);
    
    // 为每条消息添加评论列表
    for (const row of rows) {
      const [comments] = await pool.execute(`
        SELECT 
          post_comments.*, 
          users.username, 
          users.avatar 
        FROM post_comments 
        JOIN users ON post_comments.user_id = users.id 
        WHERE post_id = ? 
        ORDER BY post_comments.created_at ASC
      `, [row.id]);
      row.comments = comments;
    }
    
    return rows;
  }

  // 添加点赞
  static async addLike(postId, userId) {
    try {
      // 先检查是否已点赞
      const [existingLike] = await pool.execute(
        'SELECT * FROM post_likes WHERE post_id = ? AND user_id = ?',
        [postId, userId]
      );
      
      if (existingLike.length > 0) {
        return { alreadyLiked: true };
      }
      
      // 添加点赞
      await pool.execute(
        'INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)',
        [postId, userId]
      );
      
      // 点赞数通过子查询实时计算，不需要直接更新
      
      return { success: true };
    } catch (error) {
      // 唯一约束冲突（重复点赞）
      if (error.code === 'ER_DUP_ENTRY') {
        return { alreadyLiked: true };
      }
      throw error;
    }
  }

  // 取消点赞
  static async removeLike(postId, userId) {
    const [result] = await pool.execute(
      'DELETE FROM post_likes WHERE post_id = ? AND user_id = ?',
      [postId, userId]
    );
    
    if (result.affectedRows > 0) {
      // 点赞数通过子查询实时计算，不需要直接更新
      return { success: true, removed: true };
    }
    
    return { success: true, removed: false };
  }

  // 检查用户是否已点赞
  static async checkLike(postId, userId) {
    const [rows] = await pool.execute(
      'SELECT * FROM post_likes WHERE post_id = ? AND user_id = ?',
      [postId, userId]
    );
    return rows.length > 0;
  }

  static async getPostOwnerId(postId) {
    const [rows] = await pool.execute(
      'SELECT user_id FROM chats WHERE id = ? LIMIT 1',
      [postId]
    );
    return rows.length ? Number(rows[0].user_id) : 0;
  }

  // 创建评论
  static async createComment(postId, userId, content) {
    const [result] = await pool.execute(
      'INSERT INTO post_comments (post_id, user_id, content) VALUES (?, ?, ?)',
      [postId, userId, content]
    );
    return result;
  }

  /** 短时内同帖同用户同内容视为重复提交 */
  static async findRecentDuplicateComment(postId, userId, content, withinSeconds = 20) {
    const windowSec = Math.max(1, Math.min(120, Number(withinSeconds) || 20));
    const [rows] = await pool.execute(
      `SELECT post_comments.*, users.username, users.avatar
       FROM post_comments
       JOIN users ON post_comments.user_id = users.id
       WHERE post_comments.post_id = ?
         AND post_comments.user_id = ?
         AND post_comments.parent_id IS NULL
         AND post_comments.content = ?
         AND post_comments.created_at >= DATE_SUB(NOW(), INTERVAL ${windowSec} SECOND)
       ORDER BY post_comments.id DESC
       LIMIT 1`,
      [postId, userId, content]
    );
    return rows[0] || null;
  }

  static async getCommentById(commentId) {
    const [rows] = await pool.execute(
      `SELECT post_comments.*, users.username, users.avatar
       FROM post_comments
       JOIN users ON post_comments.user_id = users.id
       WHERE post_comments.id = ?
       LIMIT 1`,
      [commentId]
    );
    return rows[0] || null;
  }

  // 获取帖子的评论
  static async getComments(postId) {
    const [rows] = await pool.execute(
      'SELECT post_comments.*, users.username, users.avatar FROM post_comments JOIN users ON post_comments.user_id = users.id WHERE post_id = ? ORDER BY post_comments.created_at ASC',
      [postId]
    );
    return rows;
  }

  // 回复评论
  static async replyToComment(postId, parentId, userId, content) {
    const [result] = await pool.execute(
      'INSERT INTO post_comments (post_id, parent_id, user_id, content) VALUES (?, ?, ?, ?)',
      [postId, parentId, userId, content]
    );
    return result;
  }

  // 点赞评论
  static async likeComment(commentId, userId) {
    try {
      // 先检查是否已点赞
      const [existingLike] = await pool.execute(
        'SELECT * FROM comment_likes WHERE comment_id = ? AND user_id = ?',
        [commentId, userId]
      );
      
      if (existingLike.length > 0) {
        return { alreadyLiked: true };
      }
      
      // 添加点赞
      await pool.execute(
        'INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)',
        [commentId, userId]
      );
      
      return { success: true };
    } catch (error) {
      // 唯一约束冲突（重复点赞）
      if (error.code === 'ER_DUP_ENTRY') {
        return { alreadyLiked: true };
      }
      throw error;
    }
  }

  // 点踩评论
  static async dislikeComment(commentId, userId) {
    try {
      // 先检查是否已点踩
      const [existingDislike] = await pool.execute(
        'SELECT * FROM comment_dislikes WHERE comment_id = ? AND user_id = ?',
        [commentId, userId]
      );
      
      if (existingDislike.length > 0) {
        return { alreadyDisliked: true };
      }
      
      // 添加点踩
      await pool.execute(
        'INSERT INTO comment_dislikes (comment_id, user_id) VALUES (?, ?)',
        [commentId, userId]
      );
      
      return { success: true };
    } catch (error) {
      // 唯一约束冲突（重复点踩）
      if (error.code === 'ER_DUP_ENTRY') {
        return { alreadyDisliked: true };
      }
      throw error;
    }
  }

  // 取消点赞评论
  static async unlikeComment(commentId, userId) {
    const [result] = await pool.execute(
      'DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?',
      [commentId, userId]
    );
    
    if (result.affectedRows > 0) {
      return { success: true, removed: true };
    }
    
    return { success: true, removed: false };
  }

  // 取消点踩评论
  static async undislikeComment(commentId, userId) {
    const [result] = await pool.execute(
      'DELETE FROM comment_dislikes WHERE comment_id = ? AND user_id = ?',
      [commentId, userId]
    );
    
    if (result.affectedRows > 0) {
      return { success: true, removed: true };
    }
    
    return { success: true, removed: false };
  }

  // 删除聊天消息
  static async delete(id) {
    const [result] = await pool.execute('DELETE FROM chats WHERE id = ?', [id]);
    return result;
  }
}

module.exports = ChatModel;