const express = require('express');
const UserController = require('../controllers/userController');
const { verifyToken, verifyUser, verifyAdmin, verifySuperAdmin } = require('../middleware/auth');
const router = express.Router();

// 获取用户信息（需要认证）
router.get('/info', verifyToken, verifyUser, UserController.getUserInfo);

// 更新用户信息（需要认证）
router.put('/info', verifyToken, verifyUser, UserController.updateUserInfo);

// 更新用户深色模式设置（需要认证）
router.put('/dark-mode', verifyToken, verifyUser, UserController.updateDarkMode);

// 获取用户统计信息（需要认证）
router.get('/stats', verifyToken, verifyUser, UserController.getUserStats);

// 获取用户帖子（需要认证）
router.get('/posts', verifyToken, verifyUser, UserController.getUserPosts);

// 获取用户收到的回复（需要认证）
router.get('/replies', verifyToken, verifyUser, UserController.getUserReplies);

// 获取用户比赛数据（需要认证）
router.get('/matches', verifyToken, verifyUser, UserController.getUserMatches);

// 绑定 PUBG 账号（需要认证）
router.post('/pubg/bind', verifyToken, verifyUser, UserController.bindPubgAccount);

// 解绑 PUBG 账号（需要认证）
router.post('/pubg/unbind', verifyToken, verifyUser, UserController.unbindPubgAccount);

// PUBG 总览数据（需要认证）
router.get('/pubg/overview', verifyToken, verifyUser, UserController.getPubgOverview);

// PUBG 比赛记录（需要认证）
router.get('/pubg/matches', verifyToken, verifyUser, UserController.getPubgMatches);

// PUBG 赛季列表（需要认证）
router.get('/pubg/seasons', verifyToken, verifyUser, UserController.getPubgSeasons);

// PUBG 星火战力（需要认证）
router.get('/pubg/power', verifyToken, verifyUser, UserController.getPubgPower);

// PUBG 单场详情（需要认证）
router.get('/pubg/matches/:matchId', verifyToken, verifyUser, UserController.getPubgMatchDetail);

// 获取所有用户（需要管理员权限）
router.get('/all', verifyToken, verifyAdmin, UserController.getAllUsers);

// 更新用户角色（需要系统管理员权限）
router.put('/role', verifyToken, verifySuperAdmin, UserController.updateUserRole);

// 获取用户角色列表
router.get('/roles', verifyToken, verifyAdmin, UserController.getRoles);

// 删除用户（需要系统管理员权限）
router.delete('/:id', verifyToken, verifySuperAdmin, UserController.deleteUser);

// 更新用户信息（管理员功能）
router.put('/:id', verifyToken, verifyAdmin, UserController.updateOtherUser);

module.exports = router;