const express = require('express');
const CarouselController = require('../controllers/carouselController');
const { verifyToken } = require('../middleware/auth');
const router = express.Router();

// 创建轮播（需要认证）
router.post('/create', verifyToken, CarouselController.createCarousel);

// 获取所有轮播
router.get('/all', CarouselController.getAllCarousels);

// 获取轮播详情
router.get('/:id', CarouselController.getCarouselById);

// 更新轮播信息（需要认证）
router.put('/:id', verifyToken, CarouselController.updateCarousel);

// 删除轮播（需要认证）
router.delete('/:id', verifyToken, CarouselController.deleteCarousel);

module.exports = router;