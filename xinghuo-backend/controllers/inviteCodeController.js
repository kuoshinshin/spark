const InviteCodeModel = require('../models/inviteCodeModel');

class InviteCodeController {
  static async list(req, res) {
    try {
      const list = await InviteCodeModel.listAll();
      res.json(list);
    } catch (error) {
      console.error('邀请码列表失败:', error);
      res.status(500).json({ error: '获取邀请码列表失败' });
    }
  }

  static async create(req, res) {
    try {
      const { code, remark, max_uses, is_active } = req.body || {};
      if (!code || !String(code).trim()) {
        return res.status(400).json({ error: '邀请码不能为空' });
      }
      await InviteCodeModel.create({ code, remark, max_uses, is_active });
      res.status(201).json({ message: '创建成功' });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ error: '该邀请码已存在' });
      }
      console.error('创建邀请码失败:', error);
      res.status(500).json({ error: '创建邀请码失败' });
    }
  }

  static async update(req, res) {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: '无效的 ID' });
      const row = await InviteCodeModel.findById(id);
      if (!row) return res.status(404).json({ error: '邀请码不存在' });
      const { code, remark, max_uses, is_active } = req.body || {};
      await InviteCodeModel.update(id, { code, remark, max_uses, is_active });
      res.json({ message: '更新成功' });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ error: '该邀请码已存在' });
      }
      console.error('更新邀请码失败:', error);
      res.status(500).json({ error: '更新邀请码失败' });
    }
  }

  static async remove(req, res) {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: '无效的 ID' });
      const result = await InviteCodeModel.delete(id);
      if (!result.affectedRows) return res.status(404).json({ error: '邀请码不存在' });
      res.json({ message: '已删除' });
    } catch (error) {
      console.error('删除邀请码失败:', error);
      res.status(500).json({ error: '删除邀请码失败' });
    }
  }
}

module.exports = InviteCodeController;
