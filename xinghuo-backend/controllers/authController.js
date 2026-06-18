const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const UserModel = require('../models/userModel');
const InviteCodeModel = require('../models/inviteCodeModel');
const UserController = require('./userController');
require('dotenv').config();

class AuthController {
  // 用户注册（邀请码来自数据库，扣减使用次数）
  static async register(req, res) {
    const { account, username, password, inviteCode, realName, phone, address } = req.body || {};

    if (!account || !String(account).trim()) {
      return res.status(400).json({ error: '账号不能为空' });
    }
    if (!username || !String(username).trim()) {
      return res.status(400).json({ error: '昵称不能为空' });
    }
    if (!realName || !String(realName).trim()) {
      return res.status(400).json({ error: '真实姓名不能为空' });
    }
    if (!password) {
      return res.status(400).json({ error: '密码不能为空' });
    }
    if (!inviteCode || !String(inviteCode).trim()) {
      return res.status(400).json({ error: '请输入邀请码' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const invite = await InviteCodeModel.findActiveByCodeForUpdate(conn, inviteCode);
      if (!invite) {
        await conn.rollback();
        return res.status(400).json({ error: '邀请码无效' });
      }
      if (invite.max_uses != null && Number(invite.used_count) >= Number(invite.max_uses)) {
        await conn.rollback();
        return res.status(400).json({ error: '邀请码已达到使用上限' });
      }

      const existingAccount = await UserModel.findByAccountConn(conn, account.trim());
      if (existingAccount) {
        await conn.rollback();
        return res.status(400).json({ error: '账号已被注册' });
      }

      const existingUser = await UserModel.findByUsernameConn(conn, username.trim());
      if (existingUser) {
        await conn.rollback();
        return res.status(400).json({ error: '昵称已被注册' });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const result = await UserModel.createWithConnection(
        conn,
        account.trim(),
        username.trim(),
        hashedPassword,
        {
          realName,
          phone,
          address,
        }
      );

      await InviteCodeModel.incrementUsed(conn, invite.id);

      await conn.commit();
      res.status(201).json({ message: '注册成功', userId: result.insertId });
    } catch (error) {
      try {
        await conn.rollback();
      } catch (e) {
        /* ignore */
      }
      console.error('注册失败:', error);
      res.status(500).json({ error: '注册失败，请联系管理员' });
    } finally {
      conn.release();
    }
  }
  
  // 用户登录
  static async login(req, res) {
    try {
      const { account, password } = req.body;
      
      // 查找用户
      const user = await UserModel.findByAccount(account);
      if (!user) {
        return res.status(400).json({ error: '账号或密码错误' });
      }
      
      // 验证密码
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(400).json({ error: '账号或密码错误' });
      }
      
      // 生成JWT token
      const token = jwt.sign(
        { id: user.id, account: user.account, username: user.username, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );
      
      // 返回用户信息和token
      res.json({
        token,
        user: {
          id: user.id,
          account: user.account,
          username: user.username,
          avatar: user.avatar,
          role: user.role,
          real_name: user.real_name || '',
          phone: user.phone || '',
          address: user.address || '',
          dark_mode: user.dark_mode || false,
          pubgBinding: UserController.normalizePubgBinding(user)
        }
      });

      // 登录后异步预热常用 PUBG 数据（不阻塞登录响应）
      void UserController.prewarmPubgDataForUser(user.id);
    } catch (error) {
      console.error('登录失败:', error);
      res.status(500).json({ error: '登录失败，请联系管理员' });
    }
  }
}

module.exports = AuthController;