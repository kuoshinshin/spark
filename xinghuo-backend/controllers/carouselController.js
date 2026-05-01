const CarouselModel = require('../models/carouselModel');

class CarouselController {
  // 创建轮播
  static async createCarousel(req, res) {
    try {
      const { title, subtitle, content, type, buttons } = req.body;
      
      if (!title) {
        return res.status(400).json({ error: '标题不能为空' });
      }
      
      const result = await CarouselModel.create(title, subtitle, content, type, buttons);
      
      res.status(201).json({ message: '轮播创建成功', carouselId: result.insertId });
    } catch (error) {
      console.error('创建轮播失败:', error);
      res.status(500).json({ error: '创建轮播失败，请联系管理员' });
    }
  }
  
  // 获取所有轮播
  static async getAllCarousels(req, res) {
    try {
      const carousels = await CarouselModel.getAll();
      res.json(carousels);
    } catch (error) {
      console.error('获取轮播失败:', error);
      res.status(500).json({ error: '获取轮播失败，请联系管理员' });
    }
  }
  
  // 获取轮播详情
  static async getCarouselById(req, res) {
    try {
      const carouselId = req.params.id;
      const carousel = await CarouselModel.getById(carouselId);
      
      if (!carousel) {
        return res.status(404).json({ error: '轮播不存在' });
      }
      
      res.json(carousel);
    } catch (error) {
      console.error('获取轮播详情失败:', error);
      res.status(500).json({ error: '获取轮播详情失败，请联系管理员' });
    }
  }
  
  // 更新轮播信息
  static async updateCarousel(req, res) {
    try {
      const carouselId = req.params.id;
      const data = req.body;
      
      // 移除不需要更新的字段
      delete data.created_at;
      delete data.updated_at;
      
      const result = await CarouselModel.update(carouselId, data);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: '轮播不存在' });
      }
      
      res.json({ message: '轮播更新成功' });
    } catch (error) {
      console.error('更新轮播失败:', error);
      res.status(500).json({ error: '更新轮播失败，请联系管理员' });
    }
  }
  
  // 删除轮播
  static async deleteCarousel(req, res) {
    try {
      const carouselId = req.params.id;
      const result = await CarouselModel.delete(carouselId);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: '轮播不存在' });
      }
      
      res.json({ message: '轮播删除成功' });
    } catch (error) {
      console.error('删除轮播失败:', error);
      res.status(500).json({ error: '删除轮播失败，请联系管理员' });
    }
  }
}

module.exports = CarouselController;