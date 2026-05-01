// 请求频率限制中间件

// 存储请求记录的Map
const requestMap = new Map();

// 配置选项
const DEFAULT_OPTIONS = {
  // 时间窗口（毫秒）
  windowMs: 15 * 60 * 1000, // 默认15分钟
  // 每个IP在时间窗口内的最大请求数
  max: 100, // 默认100次请求
  // 消息
  message: '请求过于频繁，请稍后再试',
  // 状态码
  statusCode: 429,
  // 是否记录成功的请求
  skipSuccessfulRequests: false,
  // 跳过的路径
  skip: (req) => {
    // 跳过健康检查
    return req.path === '/health';
  }
};

/**
 * 请求频率限制中间件
 * @param {Object} options - 配置选项
 * @returns {Function} 中间件函数
 */
function rateLimit(options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  
  return (req, res, next) => {
    // 检查是否跳过
    if (config.skip(req)) {
      return next();
    }
    
    // 获取客户端IP
    const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket.remoteAddress;
    
    // 生成键（可以根据需要使用不同的键，如IP+路径）
    const key = `${ip}:${req.path}`;
    
    // 获取当前时间
    const now = Date.now();
    
    // 获取请求记录
    let requestRecord = requestMap.get(key);
    
    // 如果没有记录，创建一个新的
    if (!requestRecord) {
      requestRecord = {
        count: 0,
        windowStart: now
      };
      requestMap.set(key, requestRecord);
    }
    
    // 检查时间窗口是否过期
    if (now - requestRecord.windowStart > config.windowMs) {
      // 重置请求记录
      requestRecord.count = 0;
      requestRecord.windowStart = now;
    }
    
    // 增加请求计数
    requestRecord.count++;
    
    // 检查是否超过限制
    if (requestRecord.count > config.max) {
      return res.status(config.statusCode).json({
        error: config.message,
        retryAfter: Math.ceil((config.windowMs - (now - requestRecord.windowStart)) / 1000)
      });
    }
    
    // 设置响应头
    res.setHeader('X-RateLimit-Limit', config.max);
    res.setHeader('X-RateLimit-Remaining', config.max - requestRecord.count);
    res.setHeader('X-RateLimit-Reset', requestRecord.windowStart + config.windowMs);
    
    // 继续处理请求
    next();
  };
}

/**
 * 清除请求记录
 */
function clearRateLimit() {
  requestMap.clear();
}

/**
 * 获取当前请求记录
 * @returns {Map} 请求记录
 */
function getRateLimitRecords() {
  return requestMap;
}

module.exports = {
  rateLimit,
  clearRateLimit,
  getRateLimitRecords
};