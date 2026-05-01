// API 服务

import { triggerUnauthorized } from './sessionBridge'

function resolveApiBaseUrl() {
  const explicit = import.meta.env.VITE_API_BASE_URL;
  if (explicit) return String(explicit).replace(/\/$/, '');
  if (import.meta.env.DEV) return 'http://127.0.0.1:3000/api';
  return '/api';
}

// 基础 API URL（生产构建未设置 VITE_API_BASE_URL 时默认同源 /api，便于 Nginx 反代）
const API_BASE_URL = resolveApiBaseUrl();

// 缓存配置
const CACHE_CONFIG = {
  enabled: true,
  defaultExpiry: 5 * 60 * 1000, // 默认缓存5分钟
  maxSize: 100 // 最大缓存条目数
};

// 缓存存储
const cache = new Map();

// 生成缓存键
function generateCacheKey(endpoint, options = {}) {
  const { method = 'GET', body, skipCache = false } = options;
  if (skipCache) return null;
  if (method !== 'GET') return null; // 只缓存GET请求
  
  const url = `${API_BASE_URL}${endpoint}`;
  const bodyStr = body ? JSON.stringify(body) : '';
  const token = typeof localStorage !== 'undefined' ? (localStorage.getItem('token') || '') : '';
  return `${url}_${bodyStr}_${token}`;
}

// 获取缓存数据
function getCachedData(key) {
  if (!CACHE_CONFIG.enabled) return null;
  
  const cached = cache.get(key);
  if (!cached) return null;
  
  // 检查缓存是否过期
  if (Date.now() > cached.expiry) {
    cache.delete(key);
    return null;
  }
  
  return cached.data;
}

// 设置缓存数据
function setCachedData(key, data, expiry = CACHE_CONFIG.defaultExpiry) {
  if (!CACHE_CONFIG.enabled || !key) return;
  
  // 如果缓存达到最大容量，删除最旧的条目
  if (cache.size >= CACHE_CONFIG.maxSize) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  
  cache.set(key, {
    data,
    expiry: Date.now() + expiry
  });
}

// 清除缓存（登出或 401 时由应用层调用）
export function clearCache () {
  cache.clear();
}

function invalidateCacheByEndpoints(endpoints = []) {
  if (!Array.isArray(endpoints) || endpoints.length === 0) return;
  for (const key of cache.keys()) {
    if (endpoints.some((endpoint) => key.includes(`${API_BASE_URL}${endpoint}`))) {
      cache.delete(key);
    }
  }
}

function toQueryString(params = {}) {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  return new URLSearchParams(entries).toString();
}

// 通用请求方法
async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const skipCache = Boolean(options.skipCache);
  
  // 生成缓存键
  const cacheKey = generateCacheKey(endpoint, options);
  
  // 检查缓存
  const cachedData = skipCache ? null : getCachedData(cacheKey);
  if (!skipCache && cachedData) {
    return cachedData;
  }
  
  // 获取认证token
  const token = localStorage.getItem('token');
  
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      ...(token && { 'Authorization': `Bearer ${token}` }),
    },
  };
  
  const mergedOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers,
    },
  };
  
  try {
    const response = await fetch(url, mergedOptions);
    const contentType = response.headers.get('content-type') || '';
    const isJsonResponse = contentType.includes('application/json');
    let data = null;

    if (response.status !== 204) {
      data = isJsonResponse ? await response.json() : await response.text();
    }
    
    if (!response.ok) {
      // 检查是否是token失效或未授权错误
      if (response.status === 401 || response.status === 403) {
        triggerUnauthorized();
        throw new Error('登录已过期，请重新登录');
      }
      const errorMessage = typeof data === 'object' && data !== null
        ? data.error
        : data;
      throw new Error(errorMessage || '请求失败');
    }
    
    // 缓存GET请求的响应
    if (!skipCache && cacheKey) {
      setCachedData(cacheKey, data);
    }
    
    if (response.status === 204) {
      return { success: true };
    }

    return data;
  } catch (error) {
    console.error('API 请求错误:', error);
    // 抛出更准确的错误信息
    throw error;
  }
}

// 认证相关 API
export const authApi = {
  // 用户注册
  register: async (userData) => {
    return request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  },
  
  // 用户登录
  login: async (credentials) => {
    const response = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });

    return response;
  },
};



// 聊天相关 API
export const chatApi = {
  // 获取聊天消息
  getMessages: async () => {
    // 实际 API 调用
    return request('/chat/all');
  },
  
  // 发送消息
  sendMessage: async (messageData) => {
    // 实际 API 调用
    return request('/chat/send', {
      method: 'POST',
      body: JSON.stringify(messageData),
    });
  },
  
  // 点赞帖子
  likePost: async (postId) => {
    // 实际 API 调用
    return request('/chat/like', {
      method: 'POST',
      body: JSON.stringify({ postId }),
    });
  },
  
  // 取消点赞帖子
  unlikePost: async (postId) => {
    // 实际 API 调用
    return request('/chat/unlike', {
      method: 'POST',
      body: JSON.stringify({ postId }),
    });
  },
  
  // 检查帖子点赞状态
  checkLike: async (postId) => {
    // 实际 API 调用
    return request(`/chat/check-like?postId=${postId}`);
  },
  
  // 分享帖子
  sharePost: async (postId) => {
    // 实际 API 调用
    return request('/share/create', {
      method: 'POST',
      body: JSON.stringify({ postId }),
    });
  },
  
  // 删除帖子
  deletePost: async (postId) => {
    // 实际 API 调用
    return request(`/chat/${postId}`, {
      method: 'DELETE',
    });
  },
  
  // 添加评论
  addComment: async (postId, content) => {
    // 实际 API 调用
    return request('/chat/comment', {
      method: 'POST',
      body: JSON.stringify({ postId, content }),
    });
  },
  
  // 回复评论
  replyToComment: async (postId, commentId, content) => {
    // 实际 API 调用
    return request('/chat/reply', {
      method: 'POST',
      body: JSON.stringify({ postId, commentId, content }),
    });
  },
  
  // 点赞评论
  likeComment: async (commentId) => {
    // 实际 API 调用
    return request('/chat/comment/like', {
      method: 'POST',
      body: JSON.stringify({ commentId }),
    });
  },
  
  // 取消点赞评论
  unlikeComment: async (commentId) => {
    // 实际 API 调用
    return request('/chat/comment/unlike', {
      method: 'POST',
      body: JSON.stringify({ commentId }),
    });
  },
  
  // 点踩评论
  dislikeComment: async (commentId) => {
    // 实际 API 调用
    return request('/chat/comment/dislike', {
      method: 'POST',
      body: JSON.stringify({ commentId }),
    });
  },
  
  // 取消点踩评论
  undislikeComment: async (commentId) => {
    // 实际 API 调用
    return request('/chat/comment/undislike', {
      method: 'POST',
      body: JSON.stringify({ commentId }),
    });
  },
};

export const notificationApi = {
  listMyNotifications: async (limit = 50) => {
    return request(`/notifications/my?limit=${limit}`);
  },

  getUnreadCount: async () => {
    return request('/notifications/unread-count');
  },

  markNotificationRead: async (notificationId) => {
    return request(`/notifications/${notificationId}/read`, {
      method: 'POST',
    });
  },

  markAllRead: async () => {
    return request('/notifications/read-all', {
      method: 'POST',
    });
  },
};

// 比赛相关 API
export const matchApi = {
  // 获取比赛列表
  getMatches: async () => {
    // 实际 API 调用
    return request('/match/all');
  },
  
  // 获取即将开始的比赛
  getUpcomingMatches: async () => {
    // 实际 API 调用
    return request('/match/status/upcoming');
  },
  
  // 获取正在进行的比赛
  getOngoingMatches: async () => {
    // 实际 API 调用
    return request('/match/status/ongoing');
  },

  // 获取报名数据（兼容旧页面调用）
  getRegistrationData: async () => {
    return request('/match/status/ongoing');
  },
  
  // 获取赛季数据（Match.vue 使用）
  getSeasonData: async (seasonId) => {
    return request(`/match/season/${seasonId}`);
  },
  

  
  // 获取规则数据（Match.vue 使用）
  getRulesData: async () => {
    return request('/match/rules');
  },

  // 比赛阶段：按 PGS 规则计算队伍积分（管理员）
  calculateStageScore: async (teams) => {
    return request('/match/stage/score', {
      method: 'POST',
      body: JSON.stringify({ teams }),
    });
  },
  
  // 获取个人比赛数据（Match.vue 使用）
  getPersonalData: async () => {
    return request('/match/personal');
  },

  // 赛前：提交报名
  registerForMatch: async (matchId, payload) => {
    return request(`/match/${matchId}/register`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // 赛前：查看报名列表（管理员）
  getRegistrations: async (matchId) => {
    return request(`/match/${matchId}/registrations`);
  },

  // 赛前：审核报名（管理员）
  reviewRegistration: async (matchId, registrationId, payload) => {
    return request(`/match/${matchId}/registrations/${registrationId}/review`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  // 赛前：冻结名单（管理员）
  freezeRoster: async (matchId) => {
    return request(`/match/${matchId}/freeze`, {
      method: 'POST',
    });
  },

  // 单赛季报名大厅
  getRegistrationLobby: async () => {
    return request('/match/registration/lobby', { skipCache: true });
  },
  getRegistrationEligibility: async () => {
    return request('/match/registration/eligibility', { skipCache: true });
  },
  getRegistrationTeam: async (teamId) => {
    return request(`/match/registration/teams/${teamId}`, { skipCache: true });
  },
  claimCaptainSlot: async (teamId) => {
    const data = await request(`/match/registration/teams/${teamId}/captain`, {
      method: 'POST',
    });
    invalidateCacheByEndpoints(['/match/registration/lobby', '/match/registration/eligibility']);
    return data;
  },
  joinRegistrationSlot: async (teamId, playerIndex) => {
    const data = await request(`/match/registration/teams/${teamId}/slots/${playerIndex}/join`, {
      method: 'POST',
    });
    invalidateCacheByEndpoints(['/match/registration/lobby', '/match/registration/eligibility']);
    return data;
  },
  kickRegistrationMember: async (teamId, playerIndex) => {
    const data = await request(`/match/registration/teams/${teamId}/slots/${playerIndex}`, {
      method: 'DELETE',
    });
    invalidateCacheByEndpoints(['/match/registration/lobby', '/match/registration/eligibility']);
    return data;
  },
  updateRegistrationTeamName: async (teamId, teamName) => {
    const data = await request(`/match/registration/teams/${teamId}/name`, {
      method: 'PATCH',
      body: JSON.stringify({ teamName }),
    });
    invalidateCacheByEndpoints(['/match/registration/lobby', '/match/registration/eligibility']);
    return data;
  },
  transferRegistrationCaptain: async (teamId, targetPlayerIndex) => {
    const data = await request(`/match/registration/teams/${teamId}/transfer-captain`, {
      method: 'POST',
      body: JSON.stringify({ targetPlayerIndex }),
    });
    invalidateCacheByEndpoints(['/match/registration/lobby', '/match/registration/eligibility']);
    return data;
  },
  leaveRegistrationTeam: async () => {
    const data = await request('/match/registration/my/leave', {
      method: 'POST',
    });
    invalidateCacheByEndpoints(['/match/registration/lobby', '/match/registration/eligibility']);
    return data;
  },
  getRounds: async (matchId) => {
    return request(`/match/${matchId}/rounds`, { skipCache: true });
  },
  getLeaderboard: async (matchId) => {
    return request(`/match/${matchId}/leaderboard`, { skipCache: true });
  },

  // 更新选手名称（Match.vue 使用）
  updatePlayerName: async (teamId, playerId, name) => {
    // 实际 API 调用
    return request('/match/player/update', {
      method: 'PUT',
      body: JSON.stringify({ teamId, playerId, name }),
    });
  },
  
  // 获取选手卡数据（Match.vue 使用）
  getPlayerCardData: async () => {
    // 实际 API 调用
    return request('/match/player-card');
  },
  
  // 保存选手卡数据（Match.vue 使用）
  savePlayerCardData: async (playerCardData) => {
    // 实际 API 调用
    return request('/match/player-card', {
      method: 'POST',
      body: JSON.stringify(playerCardData),
    });
  },
  

};

// 用户相关 API
export const userApi = {
  // 获取用户信息
  getUserInfo: async () => {
    // 实际 API 调用
    return request('/user/info');
  },
  
  // 获取当前用户信息（Profile.vue 使用）
  getCurrentUser: async () => {
    // 实际 API 调用
    return request('/user/info');
  },
  
  // 获取用户统计信息（Profile.vue 使用）
  getStats: async () => {
    // 实际 API 调用
    return request('/user/stats');
  },
  
  // 获取用户帖子（Profile.vue 使用）
  getUserPosts: async () => {
    // 实际 API 调用
    return request('/user/posts');
  },
  
  // 获取用户收到的回复（Profile.vue 使用）
  getUserReplies: async () => {
    // 实际 API 调用
    return request('/user/replies');
  },
  
  // 切换点赞状态（Profile.vue 使用）
  toggleLike: async (postId) => {
    // 实际 API 调用
    return request('/user/like', {
      method: 'POST',
      body: JSON.stringify({ postId }),
    });
  },
  
  // 更新用户资料（Profile.vue 使用）
  updateProfile: async (userData) => {
    // 实际 API 调用
    return request('/user/info', {
      method: 'PUT',
      body: JSON.stringify(userData),
    });
  },
  
  // 更新用户深色模式设置
  updateDarkMode: async (darkMode) => {
    // 实际 API 调用
    return request('/user/dark-mode', {
      method: 'PUT',
      body: JSON.stringify({ darkMode }),
    });
  },
  
  // 获取用户列表
  getUserList: async (params) => {
    // 构建查询字符串
    const queryString = new URLSearchParams(params).toString();
    // 实际 API 调用
    return request(`/user/all?${queryString}`);
  },
  

  
  // 获取用户比赛数据（Profile.vue 使用）
  getUserMatches: async () => {
    // 实际 API 调用
    return request('/user/matches');
  },

  // 绑定 PUBG 账号
  bindPubgAccount: async (payload) => {
    const data = await request('/user/pubg/bind', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    invalidateCacheByEndpoints([
      '/user/info',
      '/user/stats',
      '/user/pubg/overview',
      '/user/pubg/power',
      '/user/pubg/seasons',
      '/user/pubg/matches'
    ]);
    return data;
  },

  // 解绑 PUBG 账号
  unbindPubgAccount: async () => {
    const data = await request('/user/pubg/unbind', {
      method: 'POST',
    });
    invalidateCacheByEndpoints([
      '/user/info',
      '/user/stats',
      '/user/pubg/overview',
      '/user/pubg/power',
      '/user/pubg/seasons',
      '/user/pubg/matches'
    ]);
    return data;
  },

  // PUBG 总览数据
  getPubgOverview: async () => {
    return request('/user/pubg/overview');
  },

  // PUBG 比赛记录
  getPubgMatches: async (params = {}) => {
    const qs = toQueryString(params);
    return request(`/user/pubg/matches${qs ? `?${qs}` : ''}`);
  },

  // PUBG 赛季列表
  getPubgSeasons: async () => {
    return request('/user/pubg/seasons');
  },

  // PUBG 星火战力
  getPubgPower: async (force = false) => {
    const qs = force ? '?force=1' : '';
    return request(`/user/pubg/power${qs}`);
  },

  // PUBG 单场详情
  getPubgMatchDetail: async (matchId) => {
    return request(`/user/pubg/matches/${matchId}`);
  },
};

// 分享相关 API
export const shareApi = {
  // 帖子列表 / 发布 / 点赞（圈子 Chat、个人 Profile 等）
  getPosts: async () => {
    // 实际 API 调用
    return request('/share/all');
  },
  
  createPost: async (postData) => {
    // 实际 API 调用
    return request('/share/create', {
      method: 'POST',
      body: JSON.stringify(postData),
    });
  },
  
  likePost: async (postId) => {
    // 实际 API 调用
    return request('/share/like', {
      method: 'POST',
      body: JSON.stringify({ postId }),
    });
  },
};

// 管理员相关 API（后端需要 admin/superadmin 权限）
export const adminApi = {
  user: {
    // 获取所有用户（管理员功能）
    getAllUsers: async () => {
      return request('/user/all');
    },

    // 更新其他用户信息（管理员功能）
    updateUser: async (userId, userData) => {
      return request(`/user/${userId}`, {
        method: 'PUT',
        body: JSON.stringify(userData),
      });
    },

    // 删除用户（需要 superadmin）
    deleteUser: async (userId) => {
      return request(`/user/${userId}`, {
        method: 'DELETE',
      });
    },
  },
  match: {
    getAll: async () => request('/match/all', { skipCache: true }),
    create: async (payload) => {
      const data = await request('/match/create', {
      method: 'POST',
      body: JSON.stringify(payload),
      });
      invalidateCacheByEndpoints(['/match/all', '/match/status/upcoming', '/match/registration/lobby']);
      return data;
    },
    update: async (id, payload) => {
      const data = await request(`/match/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
      });
      invalidateCacheByEndpoints(['/match/all', '/match/status/upcoming', '/match/registration/lobby']);
      return data;
    },
    delete: async (id) => {
      const data = await request(`/match/${id}`, {
      method: 'DELETE',
      });
      invalidateCacheByEndpoints(['/match/all', '/match/status/upcoming', '/match/registration/lobby']);
      return data;
    },
    setActiveRegistration: async (id) => {
      const data = await request(`/match/${id}/active-registration`, {
      method: 'POST',
      });
      invalidateCacheByEndpoints(['/match/all', '/match/status/upcoming', '/match/registration/lobby']);
      return data;
    },
    closeRegistration: async (id) => {
      const data = await request(`/match/${id}/close-registration`, {
      method: 'POST',
      });
      invalidateCacheByEndpoints(['/match/all', '/match/status/upcoming', '/match/registration/lobby']);
      return data;
    },
    freezeRoster: async (id) => {
      const data = await request(`/match/${id}/freeze`, {
      method: 'POST',
      });
      invalidateCacheByEndpoints(['/match/all', '/match/status/upcoming', '/match/registration/lobby']);
      return data;
    },
    start: async (id) => {
      const data = await request(`/match/${id}/start`, { method: 'POST' });
      invalidateCacheByEndpoints(['/match/all', `/match/${id}/rounds`, `/match/${id}/leaderboard`]);
      return data;
    },
    complete: async (id) => {
      const data = await request(`/match/${id}/complete`, { method: 'POST' });
      invalidateCacheByEndpoints(['/match/all', `/match/${id}/leaderboard`]);
      return data;
    },
    createRound: async (id, payload) => {
      const data = await request(`/match/${id}/rounds`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      invalidateCacheByEndpoints([`/match/${id}/rounds`]);
      return data;
    },
    getRounds: async (id) => request(`/match/${id}/rounds`, { skipCache: true }),
    startRound: async (id, roundId) => {
      const data = await request(`/match/${id}/rounds/${roundId}/start`, { method: 'POST' });
      invalidateCacheByEndpoints([`/match/${id}/rounds`]);
      return data;
    },
    saveRoundResults: async (id, roundId, results) => {
      const data = await request(`/match/${id}/rounds/${roundId}/results`, {
        method: 'PUT',
        body: JSON.stringify({ results }),
      });
      invalidateCacheByEndpoints([`/match/${id}/rounds`, `/match/${id}/leaderboard`]);
      return data;
    },
    completeRound: async (id, roundId) => {
      const data = await request(`/match/${id}/rounds/${roundId}/complete`, { method: 'POST' });
      invalidateCacheByEndpoints([`/match/${id}/rounds`, `/match/${id}/leaderboard`]);
      return data;
    },
    voidRound: async (id, roundId) => {
      const data = await request(`/match/${id}/rounds/${roundId}/void`, { method: 'POST' });
      invalidateCacheByEndpoints([`/match/${id}/rounds`, `/match/${id}/leaderboard`]);
      return data;
    },
    getLeaderboard: async (id) => request(`/match/${id}/leaderboard`, { skipCache: true }),
  },
  carousel: {
    getAll: async () => request('/carousel/all'),
    create: async (payload) => request('/carousel/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    update: async (id, payload) => request(`/carousel/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
    delete: async (id) => request(`/carousel/${id}`, {
      method: 'DELETE',
    }),
  },
  chat: {
    getAll: async () => request('/chat/all'),
    delete: async (id) => request(`/chat/${id}`, {
      method: 'DELETE',
    }),
  },
  inviteCodes: {
    list: async () => request('/invite-codes'),
    create: async (payload) => request('/invite-codes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    update: async (id, payload) => request(`/invite-codes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
    delete: async (id) => request(`/invite-codes/${id}`, {
      method: 'DELETE',
    }),
  },
};
