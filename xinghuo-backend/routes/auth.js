const express = require('express');
const AuthController = require('../controllers/authController');
const router = express.Router();

// 注册
router.post('/register', AuthController.register);

// 登录
router.post('/login', AuthController.login);

module.exports = router;