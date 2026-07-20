const path = require('path');
const fs = require('fs').promises;
const UserModel = require('../models/userModel');
const EventModel = require('../models/eventModel');
const ChatModel = require('../models/chatModel');
const {
  getPlayerByName,
  getLifetimeStats,
  getRecentMatches,
  getMatchesBySeason,
  getCompetitivePowerScore,
  getWeaponMastery,
  getSurvivalMastery,
  getPlayerClan,
  getMatchById,
  getSeasons,
  parsePlayerStatsFromMatch,
  parseMatchDetailWithTeam,
} = require('../services/pubgApi');
const { getOrRefresh, invalidateUserCache } = require('../services/pubgCacheService');
const pubgStatsCache = new Map();
const PUBG_STATS_CACHE_TTL = 2 * 60 * 1000;
const pubgMatchesCache = new Map();
const PUBG_MATCHES_CACHE_TTL = 2 * 60 * 1000;
const PUBG_CACHE_TTL_POWER_MS = 20 * 60 * 1000;
const PUBG_CACHE_TTL_OVERVIEW_MS = 20 * 60 * 1000;
const PUBG_CACHE_TTL_SEASONS_MS = 20 * 60 * 1000;
const PUBG_CACHE_TTL_MATCHES_MS = 20 * 60 * 1000;
const PUBG_CACHE_TTL_MASTERY_MS = 20 * 60 * 1000;
const PUBG_CACHE_TTL_CLAN_MS = 20 * 60 * 1000;

const toPublicUser = (user) => {
  const {
    id,
    account,
    username,
    avatar: rawAvatar,
    role,
    dark_mode,
    real_name,
    phone,
    address,
    created_at,
    updated_at,
  } = user || {};
  let avatar = typeof rawAvatar === 'string' ? rawAvatar.trim() : '';
  if (!avatar || avatar.includes('trae-api-cn.mchost.guru')) {
    avatar = '/default-avatar.svg';
  }
  return {
    id,
    account,
    username,
    avatar,
    role,
    dark_mode,
    real_name,
    phone,
    address,
    created_at,
    updated_at,
  };
};

const pickUpdatableFields = (data = {}) => {
  const allowed = ['username', 'avatar', 'dark_mode', 'real_name', 'phone', 'address', 'role'];
  const out = {};
  allowed.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(data, key)) out[key] = data[key];
  });
  return out;
};

/** @returns {string|null} 错误文案；无 avatar 字段或合法时返回 null */
const validateAvatarForUpdate = (data) => {
  if (!data || typeof data.avatar !== 'string') return null;
  const a = data.avatar.trim();
  data.avatar = a;
  if (!a) return null;
  if (a.startsWith('data:')) return '请勿直接提交 base64 头像，请使用「上传头像」接口';
  if (a.length > 2048) return '头像地址过长';
  return null;
};

class UserController {
  static buildPubgCacheKey(binding, type, extra = '') {
    return `${binding.platform}:${binding.playerId}:${type}${extra ? `:${extra}` : ''}`;
  }

  static async prewarmPubgDataForUser(userId) {
    try {
      const user = await UserModel.findById(userId);
      if (!user) return;
      const binding = UserController.normalizePubgBinding(user);
      if (!binding.playerId || !binding.platform) return;

      await Promise.allSettled([
        getOrRefresh({
          userId,
          cacheKey: UserController.buildPubgCacheKey(binding, 'overview'),
          ttlMs: PUBG_CACHE_TTL_OVERVIEW_MS,
          fetcher: () => getLifetimeStats(binding.platform, binding.playerId),
        }),
        getOrRefresh({
          userId,
          cacheKey: UserController.buildPubgCacheKey(binding, 'power'),
          ttlMs: PUBG_CACHE_TTL_POWER_MS,
          fetcher: () => getCompetitivePowerScore(binding.platform, binding.playerId),
        }),
        getOrRefresh({
          userId,
          cacheKey: UserController.buildPubgCacheKey(binding, 'seasons'),
          ttlMs: PUBG_CACHE_TTL_SEASONS_MS,
          fetcher: async () => {
            const seasons = await getSeasons(binding.platform);
            return { seasons };
          },
        }),
        getOrRefresh({
          userId,
          cacheKey: UserController.buildPubgCacheKey(binding, 'matches', '1:10::'),
          ttlMs: PUBG_CACHE_TTL_MATCHES_MS,
          fetcher: async () => {
            const raw = await getRecentMatches(binding.platform, binding.playerId, 1, 10);
            return {
              total: raw.total,
              page: 1,
              pageSize: 10,
              list: raw.list || [],
            };
          },
        }),
      ]);
    } catch (error) {
      console.warn('预热 PUBG 数据失败:', error?.message || error);
    }
  }

  static mapPubgError(error) {
    const code = error?.code;
    const statusCode = Number(error?.statusCode || 500);

    if (code === 'PUBG_API_KEY_MISSING') {
      return { statusCode: 500, message: '服务器未配置 PUBG API Key，请联系管理员' };
    }

    if (statusCode === 401 || statusCode === 403) {
      return { statusCode: 502, message: 'PUBG API Key 无效或已过期，请联系管理员更新' };
    }

    if (statusCode === 429) {
      return { statusCode: 429, message: 'PUBG API 请求过于频繁，请稍后重试' };
    }

    if (statusCode === 404) {
      return { statusCode: 404, message: '未查询到该 PUBG 玩家，请确认平台与昵称' };
    }

    return { statusCode: 502, message: error?.message || 'PUBG 服务暂时不可用，请稍后重试' };
  }

  static getPubgStatsCache(cacheKey) {
    const cached = pubgStatsCache.get(cacheKey);
    if (!cached) return null;
    if (Date.now() > cached.expiry) {
      pubgStatsCache.delete(cacheKey);
      return null;
    }
    return cached.value;
  }

  static setPubgStatsCache(cacheKey, value) {
    pubgStatsCache.set(cacheKey, {
      value,
      expiry: Date.now() + PUBG_STATS_CACHE_TTL
    });
  }

  static getPubgMatchesCache(cacheKey) {
    const cached = pubgMatchesCache.get(cacheKey);
    if (!cached) return null;
    if (Date.now() > cached.expiry) {
      pubgMatchesCache.delete(cacheKey);
      return null;
    }
    return cached.value;
  }

  static setPubgMatchesCache(cacheKey, value) {
    pubgMatchesCache.set(cacheKey, {
      value,
      expiry: Date.now() + PUBG_MATCHES_CACHE_TTL
    });
  }

  static clearPubgCacheForUser(userId, platform, playerId) {
    if (!platform || !playerId) return;
    const prefix = `${userId}:${platform}:${playerId}`;
    for (const key of pubgStatsCache.keys()) {
      if (key.startsWith(prefix)) pubgStatsCache.delete(key);
    }
    for (const key of pubgMatchesCache.keys()) {
      if (key.startsWith(prefix)) pubgMatchesCache.delete(key);
    }
  }

  static normalizePubgBinding(user = {}) {
    return {
      playerName: user.pubg_player_name || '',
      platform: user.pubg_platform || '',
      playerId: user.pubg_player_id || '',
      boundAt: user.pubg_bound_at || null
    };
  }

  // 获取用户信息
  static async getUserInfo(req, res) {
    try {
      const userId = req.user.id;
      const user = await UserModel.findById(userId);
      
      if (!user) {
        return res.status(404).json({ error: '用户不存在' });
      }
      
      const userInfo = toPublicUser(user);
      
      // 确保返回的数据格式与前端期望的一致
      const responseData = {
        ...userInfo,
        pubgBinding: UserController.normalizePubgBinding(user),
        gameStats: {
          matches: 0,
          wins: 0,
          kills: 0,
          kdRatio: 0,
          bestRank: ''
        },
        preferences: {
          notifications: true,
          darkMode: user.dark_mode || false,
          language: 'zh-CN'
        }
      };
      
      res.json(responseData);
    } catch (error) {
      console.error('获取用户信息失败:', error);
      res.status(500).json({ error: '获取用户信息失败，请联系管理员' });
    }
  }

  /** 查看其他选手公开主页（不含电话/地址等隐私字段） */
  static async getPublicProfile(req, res) {
    try {
      const targetId = Number(req.params.id);
      if (!Number.isFinite(targetId) || targetId <= 0) {
        return res.status(400).json({ error: '无效的用户 ID' });
      }

      const user = await UserModel.findById(targetId);
      if (!user) {
        return res.status(404).json({ error: '用户不存在' });
      }

      const pubgBinding = UserController.normalizePubgBinding(user);
      let pubgStats = null;
      if (pubgBinding.playerId && pubgBinding.platform) {
        try {
          pubgStats = await getOrRefresh({
            userId: targetId,
            cacheKey: UserController.buildPubgCacheKey(pubgBinding, 'overview'),
            ttlMs: PUBG_CACHE_TTL_OVERVIEW_MS,
            fetcher: () => getLifetimeStats(pubgBinding.platform, pubgBinding.playerId),
          });
        } catch (error) {
          console.warn('公开主页获取 PUBG 战绩失败:', error?.message || error);
        }
      }

      const powerCacheRow = await UserModel.getPubgPowerCache(targetId);
      let pubgPower = EventModel.parsePowerCacheEntry(powerCacheRow?.pubg_power_cached_json);
      try {
        const raw = powerCacheRow?.pubg_power_cached_json;
        const full = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (full && Number(full.score) > 0) {
          pubgPower = { ...pubgPower, ...full };
        }
      } catch (_) {}

      let pubgMastery = null;
      let pubgClan = null;
      if (pubgBinding.playerId && pubgBinding.platform) {
        try {
          pubgMastery = await getOrRefresh({
            userId: targetId,
            cacheKey: UserController.buildPubgCacheKey(pubgBinding, 'mastery'),
            ttlMs: PUBG_CACHE_TTL_MASTERY_MS,
            fetcher: async () => {
              const [weapon, survival] = await Promise.all([
                getWeaponMastery(pubgBinding.platform, pubgBinding.playerId),
                getSurvivalMastery(pubgBinding.platform, pubgBinding.playerId),
              ]);
              return { weapon, survival };
            },
          });
        } catch (error) {
          console.warn('公开主页获取精通失败:', error?.message || error);
        }
        try {
          pubgClan = await getOrRefresh({
            userId: targetId,
            cacheKey: UserController.buildPubgCacheKey(pubgBinding, 'clan'),
            ttlMs: PUBG_CACHE_TTL_CLAN_MS,
            fetcher: async () => {
              const clan = await getPlayerClan(pubgBinding.platform, pubgBinding.playerId);
              return { clan };
            },
          });
        } catch (error) {
          console.warn('公开主页获取战队失败:', error?.message || error);
        }
      }

      let cupHistory = {
        summary: { seasonsPlayed: 0, championships: 0, bestRank: null, totalKills: 0 },
        seasons: [],
      };
      try {
        cupHistory = await EventModel.getUserCupHistory(targetId);
      } catch (error) {
        console.warn('公开主页获取杯赛战绩失败:', error?.message || error);
      }

      let avatar = typeof user.avatar === 'string' ? user.avatar.trim() : '';
      if (!avatar || avatar.includes('trae-api-cn.mchost.guru')) {
        avatar = '/default-avatar.svg';
      }

      return res.json({
        user: {
          id: user.id,
          username: user.username,
          avatar,
          role: user.role,
          real_name: user.real_name || '',
          created_at: user.created_at,
        },
        pubgBinding,
        pubgStats,
        pubgPower,
        pubgMastery,
        pubgClan: pubgClan?.clan || null,
        cupHistory,
      });
    } catch (error) {
      console.error('获取公开主页失败:', error);
      return res.status(500).json({ error: '获取公开主页失败' });
    }
  }
  
  // 更新用户信息
  static async updateUserInfo(req, res) {
    try {
      const userId = req.user.id;
      const data = pickUpdatableFields(req.body);
      const avatarErr = validateAvatarForUpdate(data);
      if (avatarErr) {
        return res.status(400).json({ error: avatarErr });
      }

      const result = await UserModel.update(userId, data);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: '用户不存在' });
      }
      
      // 获取更新后的用户信息
      const updatedUser = await UserModel.findById(userId);
      const userInfo = toPublicUser(updatedUser);
      
      res.json({ message: '更新成功', user: userInfo });
    } catch (error) {
      console.error('更新用户信息失败:', error);
      res.status(500).json({ error: '更新用户信息失败，请联系管理员' });
    }
  }

  static async uploadAvatar(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: '请选择要上传的图片' });
      }
      const userId = req.user.id;
      const publicPath = `/uploads/avatars/${req.file.filename}`;
      const user = await UserModel.findById(userId);
      if (!user) {
        try {
          await fs.unlink(req.file.path);
        } catch (_) {}
        return res.status(404).json({ error: '用户不存在' });
      }
      const prev = typeof user.avatar === 'string' ? user.avatar.trim() : '';
      await UserModel.update(userId, { avatar: publicPath });
      if (prev.startsWith('/uploads/avatars/') && !prev.includes('..')) {
        const rel = prev.replace(/^\/+/, '');
        const oldAbs = path.join(__dirname, '..', rel);
        if (oldAbs.startsWith(path.join(__dirname, '..', 'uploads', 'avatars'))) {
          try {
            await fs.unlink(oldAbs);
          } catch (_) {}
        }
      }
      const updatedUser = await UserModel.findById(userId);
      const userInfo = toPublicUser(updatedUser);
      res.json({ message: '头像上传成功', user: userInfo, avatar: userInfo.avatar });
    } catch (error) {
      console.error('上传头像失败:', error);
      if (req.file?.path) {
        try {
          await fs.unlink(req.file.path);
        } catch (_) {}
      }
      res.status(500).json({ error: '上传头像失败，请联系管理员' });
    }
  }
  
  // 获取所有用户（管理员功能）
  static async getAllUsers(req, res) {
    try {
      const users = await UserModel.getAll();
      
      // 移除密码字段
      const usersWithoutPassword = users.map(toPublicUser);
      
      res.json(usersWithoutPassword);
    } catch (error) {
      console.error('获取用户列表失败:', error);
      res.status(500).json({ error: '获取用户列表失败，请联系管理员' });
    }
  }

  // 更新用户深色模式设置
  static async updateDarkMode(req, res) {
    try {
      const userId = req.user.id;
      const { darkMode } = req.body;
      
      await UserModel.updateDarkMode(userId, darkMode);
      res.json({ message: '深色模式设置更新成功' });
    } catch (error) {
      console.error('更新深色模式设置失败:', error);
      res.status(500).json({ error: '更新深色模式设置失败' });
    }
  }
  
  // 获取用户统计信息
  static async getUserStats(req, res) {
    try {
      const userId = req.user.id;
      const user = await UserModel.findById(userId);
      const pubgBinding = UserController.normalizePubgBinding(user);

      const { stats: matchStats } = await UserModel.getUserMatches(userId);
      let pubgStats = null;

      if (pubgBinding.playerId && pubgBinding.platform) {
        try {
          pubgStats = await getOrRefresh({
            userId,
            cacheKey: UserController.buildPubgCacheKey(pubgBinding, 'overview'),
            ttlMs: PUBG_CACHE_TTL_OVERVIEW_MS,
            fetcher: () => getLifetimeStats(pubgBinding.platform, pubgBinding.playerId),
          });
        } catch (error) {
          console.warn('获取 PUBG 终身战绩失败:', error?.message || error);
        }
      }

      res.json({
        gameStats: {
          matches: matchStats.totalMatches,
          wins: matchStats.totalWins,
          kills: matchStats.totalKills,
          kdRatio: matchStats.kdRatio,
          bestRank: matchStats.bestRank,
        },
        pubgBinding,
        pubgStats
      });
    } catch (error) {
      console.error('获取用户统计信息失败:', error);
      res.status(500).json({ error: '获取用户统计信息失败' });
    }
  }

  static async getCupHistory(req, res) {
    try {
      const data = await EventModel.getUserCupHistory(req.user.id);
      res.json(data);
    } catch (error) {
      console.error('获取杯赛战绩失败:', error);
      res.status(500).json({ error: '获取杯赛战绩失败' });
    }
  }
  
  // 获取用户帖子
  static async getUserPosts(req, res) {
    try {
      const userId = req.user.id;

      const posts = await ChatModel.getByUserId(userId);
      res.json(posts);
    } catch (error) {
      console.error('获取用户帖子失败:', error);
      res.status(500).json({ error: '获取用户帖子失败' });
    }
  }

  // 获取用户收到的回复
  static async getUserReplies(req, res) {
    try {
      const userId = req.user.id;

      // 当前项目没有“收到的回复”专用查询；为了去除 mock，返回空列表。
      res.json([]);
    } catch (error) {
      console.error('获取用户回复失败:', error);
      res.status(500).json({ error: '获取用户回复失败' });
    }
  }

  // 更新用户角色（系统管理员功能）
  static async updateUserRole(req, res) {
    try {
      const { userId, role } = req.body;
      
      // 验证角色值是否有效
      const validRoles = ['user', 'admin', 'superadmin'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: '无效的角色值，有效值为：user, admin, superadmin' });
      }
      
      // 更新用户角色
      const result = await UserModel.updateRole(userId, role);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: '用户不存在' });
      }
      
      res.json({ message: '用户角色更新成功' });
    } catch (error) {
      console.error('更新用户角色失败:', error);
      res.status(500).json({ error: '更新用户角色失败，请联系管理员' });
    }
  }

  // 获取角色列表
  static async getRoles(req, res) {
    try {
      // 返回有效的角色列表
      const roles = [
        { value: 'user', label: '普通用户' },
        { value: 'admin', label: '管理员用户' },
        { value: 'superadmin', label: '系统管理员' }
      ];
      
      res.json(roles);
    } catch (error) {
      console.error('获取角色列表失败:', error);
      res.status(500).json({ error: '获取角色列表失败，请联系管理员' });
    }
  }

  // 删除用户（需要系统管理员权限）
  static async deleteUser(req, res) {
    try {
      const userId = req.params.id;
      
      // 删除用户
      const result = await UserModel.delete(userId);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: '用户不存在' });
      }
      
      res.json({ message: '用户删除成功' });
    } catch (error) {
      console.error('删除用户失败:', error);
      res.status(500).json({ error: '删除用户失败，请联系管理员' });
    }
  }

  // 更新其他用户信息（管理员功能）
  static async updateOtherUser(req, res) {
    try {
      const userId = req.params.id;
      const data = pickUpdatableFields(req.body);

      const avatarErr = validateAvatarForUpdate(data);
      if (avatarErr) {
        return res.status(400).json({ error: avatarErr });
      }
      
      // 验证角色值是否有效
      if (data.role) {
        const validRoles = ['user', 'admin', 'superadmin'];
        if (!validRoles.includes(data.role)) {
          return res.status(400).json({ error: '无效的角色值，有效值为：user, admin, superadmin' });
        }
      }
      
      // 更新用户信息
      const result = await UserModel.update(userId, data);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: '用户不存在' });
      }
      
      // 获取更新后的用户信息
      const updatedUser = await UserModel.findById(userId);
      const userInfo = toPublicUser(updatedUser);
      
      res.json({ message: '更新成功', user: userInfo });
    } catch (error) {
      console.error('更新用户信息失败:', error);
      res.status(500).json({ error: '更新用户信息失败，请联系管理员' });
    }
  }

  // 获取用户比赛数据
  static async getUserMatches(req, res) {
    try {
      const userId = req.user.id;
      const matches = await UserModel.getUserMatches(userId);
      res.json(matches);
    } catch (error) {
      console.error('获取用户比赛数据失败:', error);
      res.status(500).json({ error: '获取用户比赛数据失败' });
    }
  }

  // 绑定 PUBG 账号
  static async bindPubgAccount(req, res) {
    try {
      const userId = req.user.id;
      const playerName = String(req.body?.playerName || '').trim();
      const platform = String(req.body?.platform || '').trim().toLowerCase();
      const validPlatforms = ['steam', 'kakao', 'xbox', 'psn', 'stadia', 'tournament'];

      if (!playerName) {
        return res.status(400).json({ error: '玩家昵称不能为空' });
      }

      if (!validPlatforms.includes(platform)) {
        return res.status(400).json({ error: '平台无效，请选择 steam/kakao/xbox/psn/stadia/tournament' });
      }

      const player = await getPlayerByName(platform, playerName);
      const result = await UserModel.bindPubgAccount(userId, {
        playerName: player.name,
        platform,
        playerId: player.id
      });

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: '用户不存在' });
      }

      UserController.clearPubgCacheForUser(userId, platform, player.id);
      await invalidateUserCache(userId);
      res.json({
        message: 'PUBG 账号绑定成功',
        pubgBinding: {
          playerName: player.name,
          platform,
          playerId: player.id
        }
      });
    } catch (error) {
      console.error('绑定 PUBG 账号失败:', error);
      const mapped = UserController.mapPubgError(error);
      res.status(mapped.statusCode).json({ error: mapped.message });
    }
  }

  // 解绑 PUBG 账号
  static async unbindPubgAccount(req, res) {
    try {
      const userId = req.user.id;
      const user = await UserModel.findById(userId);
      const oldBinding = UserController.normalizePubgBinding(user);
      const result = await UserModel.unbindPubgAccount(userId);

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: '用户不存在' });
      }

      if (oldBinding.playerId && oldBinding.platform) {
        UserController.clearPubgCacheForUser(userId, oldBinding.platform, oldBinding.playerId);
      }
      await invalidateUserCache(userId);

      return res.json({
        message: 'PUBG 账号已解绑',
        pubgBinding: {
          playerName: '',
          platform: '',
          playerId: '',
          boundAt: null
        }
      });
    } catch (error) {
      console.error('解绑 PUBG 账号失败:', error);
      res.status(500).json({ error: '解绑 PUBG 账号失败，请稍后重试' });
    }
  }

  static async getPubgOverview(req, res) {
    try {
      const userId = req.user.id;
      const user = await UserModel.findById(userId);
      const binding = UserController.normalizePubgBinding(user);
      if (!binding.playerId || !binding.platform) {
        return res.status(400).json({ error: '当前账号尚未绑定 PUBG' });
      }

      const overview = await getOrRefresh({
        userId,
        cacheKey: UserController.buildPubgCacheKey(binding, 'overview'),
        ttlMs: PUBG_CACHE_TTL_OVERVIEW_MS,
        fetcher: () => getLifetimeStats(binding.platform, binding.playerId),
      });
      return res.json(overview);
    } catch (error) {
      const mapped = UserController.mapPubgError(error);
      return res.status(mapped.statusCode).json({ error: mapped.message });
    }
  }

  static async getPubgMatches(req, res) {
    try {
      const userId = req.user.id;
      const page = Math.max(1, Number(req.query.page || 1));
      const pageSize = Math.min(20, Math.max(1, Number(req.query.pageSize || 10)));
      const mode = String(req.query.mode || '').trim().toLowerCase();
      const season = String(req.query.season || '').trim();

      const user = await UserModel.findById(userId);
      const binding = UserController.normalizePubgBinding(user);
      if (!binding.playerId || !binding.platform) {
        return res.status(400).json({ error: '当前账号尚未绑定 PUBG' });
      }

      const payload = await getOrRefresh({
        userId,
        cacheKey: UserController.buildPubgCacheKey(binding, 'matches', `${page}:${pageSize}:${mode}:${season}`),
        ttlMs: PUBG_CACHE_TTL_MATCHES_MS,
        fetcher: async () => {
          const raw = season
            ? await getMatchesBySeason(binding.platform, binding.playerId, season, mode, page, pageSize)
            : await getRecentMatches(binding.platform, binding.playerId, page, pageSize, mode);
          let list = raw.list || [];
          if (mode === 'custom') {
            list = list.filter((item) => item.isCustomMatch || String(item.matchType || '').toLowerCase() === 'custom');
          }
          return {
            total: (mode === 'custom') ? list.length : raw.total,
            page,
            pageSize,
            list
          };
        },
      });
      return res.json(payload);
    } catch (error) {
      const mapped = UserController.mapPubgError(error);
      return res.status(mapped.statusCode).json({ error: mapped.message });
    }
  }

  static async getPubgMatchDetail(req, res) {
    try {
      const userId = req.user.id;
      const matchId = String(req.params.matchId || '').trim();
      if (!matchId) return res.status(400).json({ error: 'matchId 不能为空' });

      const user = await UserModel.findById(userId);
      const binding = UserController.normalizePubgBinding(user);
      if (!binding.playerId || !binding.platform) {
        return res.status(400).json({ error: '当前账号尚未绑定 PUBG' });
      }

      const cacheKey = `${userId}:${binding.platform}:${binding.playerId}:match:${matchId}`;
      const cached = UserController.getPubgMatchesCache(cacheKey);
      if (cached) return res.json(cached);

      const matchData = await getMatchById(binding.platform, matchId);
      const detail = parseMatchDetailWithTeam(matchData, binding.playerId);
      if (!detail) return res.status(404).json({ error: '未找到该场比赛中的玩家数据' });
      UserController.setPubgMatchesCache(cacheKey, detail);
      return res.json(detail);
    } catch (error) {
      const mapped = UserController.mapPubgError(error);
      return res.status(mapped.statusCode).json({ error: mapped.message });
    }
  }

  static async getPubgSeasons(req, res) {
    try {
      const userId = req.user.id;
      const user = await UserModel.findById(userId);
      const binding = UserController.normalizePubgBinding(user);
      if (!binding.platform) {
        return res.status(400).json({ error: '当前账号尚未绑定 PUBG 平台' });
      }
      const payload = await getOrRefresh({
        userId,
        cacheKey: UserController.buildPubgCacheKey(binding, 'seasons'),
        ttlMs: PUBG_CACHE_TTL_SEASONS_MS,
        fetcher: async () => {
          const seasons = await getSeasons(binding.platform);
          return { seasons };
        },
      });
      const seasons = payload?.seasons || [];
      return res.json({ seasons });
    } catch (error) {
      const mapped = UserController.mapPubgError(error);
      return res.status(mapped.statusCode).json({ error: mapped.message });
    }
  }

  static async getPubgPower(req, res) {
    try {
      const userId = req.user.id;
      const forceRefresh = ['1', 'true', 'yes'].includes(String(req.query?.force || '').toLowerCase());
      const user = await UserModel.findById(userId);
      const binding = UserController.normalizePubgBinding(user);
      if (!binding.playerId || !binding.platform) {
        return res.status(400).json({ error: '当前账号尚未绑定 PUBG' });
      }

      // 星火战力只取当前赛季，忽略历史 season 参数（避免错缓存/错同步）
      const fetchPower = async () => {
        const fresh = await getCompetitivePowerScore(binding.platform, binding.playerId, '');
        await UserModel.savePubgPowerCache(userId, fresh);
        return fresh;
      };

      const power = forceRefresh
        ? await (async () => {
            const fresh = await fetchPower();
            await getOrRefresh({
              userId,
              cacheKey: UserController.buildPubgCacheKey(binding, 'power'),
              ttlMs: 0,
              fetcher: async () => fresh,
              allowStaleOnError: false,
            });
            return fresh;
          })()
        : await getOrRefresh({
            userId,
            cacheKey: UserController.buildPubgCacheKey(binding, 'power'),
            ttlMs: PUBG_CACHE_TTL_POWER_MS,
            fetcher: fetchPower,
          });

      try {
        await EventModel.syncUserSparkScore(userId, power?.score);
      } catch (syncError) {
        console.warn('同步报名星火战力失败:', syncError?.message || syncError);
      }
      return res.json(power);
    } catch (error) {
      const mapped = UserController.mapPubgError(error);
      return res.status(mapped.statusCode).json({ error: mapped.message });
    }
  }

  static async getPubgMastery(req, res) {
    try {
      const userId = req.user.id;
      const user = await UserModel.findById(userId);
      const binding = UserController.normalizePubgBinding(user);
      if (!binding.playerId || !binding.platform) {
        return res.status(400).json({ error: '当前账号尚未绑定 PUBG' });
      }

      const payload = await getOrRefresh({
        userId,
        cacheKey: UserController.buildPubgCacheKey(binding, 'mastery'),
        ttlMs: PUBG_CACHE_TTL_MASTERY_MS,
        fetcher: async () => {
          const [weapon, survival] = await Promise.all([
            getWeaponMastery(binding.platform, binding.playerId),
            getSurvivalMastery(binding.platform, binding.playerId),
          ]);
          return { weapon, survival };
        },
      });
      return res.json(payload);
    } catch (error) {
      const mapped = UserController.mapPubgError(error);
      return res.status(mapped.statusCode).json({ error: mapped.message });
    }
  }

  static async getPubgClan(req, res) {
    try {
      const userId = req.user.id;
      const user = await UserModel.findById(userId);
      const binding = UserController.normalizePubgBinding(user);
      if (!binding.playerId || !binding.platform) {
        return res.status(400).json({ error: '当前账号尚未绑定 PUBG' });
      }

      const payload = await getOrRefresh({
        userId,
        cacheKey: UserController.buildPubgCacheKey(binding, 'clan'),
        ttlMs: PUBG_CACHE_TTL_CLAN_MS,
        fetcher: async () => {
          const clan = await getPlayerClan(binding.platform, binding.playerId);
          return { clan };
        },
      });
      return res.json(payload);
    } catch (error) {
      const mapped = UserController.mapPubgError(error);
      return res.status(mapped.statusCode).json({ error: mapped.message });
    }
  }

  static resolveLeaderboardDisplayName(user) {
    const realName = String(user?.real_name || '').trim();
    if (realName) return realName;
    return String(user?.username || '').trim() || '未知用户';
  }

  static async getPowerLeaderboard(req, res) {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 100));
      const rows = await UserModel.listPowerLeaderboardCandidates();
      const currentUserId = Number(req.user.id);

      const entries = [];
      rows.forEach((row) => {
        const power = EventModel.parsePowerCacheEntry(row.pubg_power_cached_json);
        if (!power) return;
        entries.push({
          userId: row.id,
          username: row.username,
          realName: UserController.resolveLeaderboardDisplayName(row),
          avatar: row.avatar,
          pubgPlayerName: row.pubg_player_name || null,
          cachedAt: row.pubg_power_cached_at,
          ...power,
        });
      });

      entries.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.matchesAnalyzed !== a.matchesAnalyzed) return b.matchesAnalyzed - a.matchesAnalyzed;
        return a.userId - b.userId;
      });

      const leaderboard = entries.slice(0, limit).map((entry, index) => ({
        ...entry,
        rank: index + 1,
      }));

      const myIndex = entries.findIndex((entry) => entry.userId === currentUserId);
      const myRank = myIndex >= 0
        ? { ...entries[myIndex], rank: myIndex + 1 }
        : null;

      res.json({
        formulaVersion: 'v2',
        total: entries.length,
        leaderboard,
        myRank,
      });
    } catch (error) {
      console.error('获取星火战力排行榜失败:', error);
      res.status(500).json({ error: '获取星火战力排行榜失败' });
    }
  }
}

module.exports = UserController;