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

// 杯赛 V2 API
export const eventApi = {
  getCurrent: async () => request('/events/current', { skipCache: true }),
  getLobby: async () => request('/events/current/lobby', { skipCache: true }),
  getRounds: async () => request('/events/current/rounds', { skipCache: true }),
  getStandings: async () => request('/events/current/standings', { skipCache: true }),
  getRoundResults: async (roundId) => request(`/events/current/rounds/${roundId}/results`, { skipCache: true }),
  joinSlot: async (teamId, slotIndex) => {
    const data = await request(`/events/current/teams/${teamId}/slots/${slotIndex}/join`, {
      method: 'POST',
    });
    invalidateCacheByEndpoints(['/events/current']);
    return data;
  },
  leave: async () => {
    const data = await request('/events/current/leave', { method: 'POST' });
    invalidateCacheByEndpoints(['/events/current']);
    return data;
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
    const data = await request('/user/info', {
      method: 'PUT',
      body: JSON.stringify(userData),
    });
    invalidateCacheByEndpoints(['/user/info']);
    return data;
  },

  /** multipart 上传头像，成功后写入数据库并返回 user */
  uploadAvatar: async (file) => {
    const base = resolveApiBaseUrl();
    const token = typeof localStorage !== 'undefined' ? (localStorage.getItem('token') || '') : '';
    const form = new FormData();
    form.append('avatar', file);
    const res = await fetch(`${base}/user/avatar`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form
    });
    const data = res.headers.get('content-type')?.includes('application/json')
      ? await res.json()
      : null;
    if (!res.ok) {
      const msg = (data && data.error) || '上传头像失败';
      if (res.status === 401 || res.status === 403) {
        triggerUnauthorized();
      }
      throw new Error(msg);
    }
    invalidateCacheByEndpoints(['/user/info']);
    return data;
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
  events: {
    getAll: async () => request('/events', { skipCache: true }),
    create: async (payload) => request('/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    update: async (id, payload) => request(`/events/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
    publish: async (id) => request(`/events/${id}/publish`, { method: 'POST' }),
    lock: async (id) => request(`/events/${id}/lock`, { method: 'POST' }),
    startScoring: async (id) => request(`/events/${id}/start-scoring`, { method: 'POST' }),
    finish: async (id) => request(`/events/${id}/finish`, { method: 'POST' }),
    getRounds: async (id) => request(`/events/${id}/rounds`, { skipCache: true }),
    getStandings: async (id) => request(`/events/${id}/standings`, { skipCache: true }),
    getRoundResults: async (id, roundId) => request(`/events/${id}/rounds/${roundId}/results`, { skipCache: true }),
    createRound: async (id, payload) => request(`/events/${id}/rounds`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
    saveRoundResults: async (id, roundId, results) => request(`/events/${id}/rounds/${roundId}/results`, {
      method: 'PUT',
      body: JSON.stringify({ results }),
    }),
    completeRound: async (id, roundId) => request(`/events/${id}/rounds/${roundId}/complete`, { method: 'POST' }),
    clearSlot: async (slotId) => request(`/events/slots/${slotId}`, { method: 'DELETE' }),
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
