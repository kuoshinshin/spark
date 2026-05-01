const jwt = require('jsonwebtoken');
require('dotenv').config();

const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1] || '';
  }
  return String(req.query?.token || '').trim();
};

// 验证JWT token的中间件
const verifyToken = (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: '未提供认证token' });
    }
    
    // 验证token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 将用户信息存储在请求对象中
    req.user = decoded;
    
    next();
    
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '认证token已过期' });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: '认证token无效' });
    } else {
      console.error('验证token时发生错误:', error);
      return res.status(401).json({ error: '认证失败' });
    }
  }
};

// 验证用户角色的中间件
const verifyRole = (roles) => {
  return (req, res, next) => {
    try {
      // 检查用户是否已通过认证
      if (!req.user) {
        return res.status(401).json({ error: '未提供认证token' });
      }
      
      // 检查用户角色是否在允许的角色列表中
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ error: '权限不足，无法访问该资源' });
      }
      
      next();
      
    } catch (error) {
      console.error('验证角色时发生错误:', error);
      return res.status(403).json({ error: '权限验证失败' });
    }
  };
};

// 验证是否为管理员（admin或superadmin）
const verifyAdmin = (req, res, next) => {
  return verifyRole(['admin', 'superadmin'])(req, res, next);
};

// 验证是否为系统管理员（superadmin）
const verifySuperAdmin = (req, res, next) => {
  return verifyRole(['superadmin'])(req, res, next);
};

// 验证是否为普通用户或更高权限
const verifyUser = (req, res, next) => {
  return verifyRole(['user', 'admin', 'superadmin'])(req, res, next);
};

module.exports = {
  verifyToken,
  verifyRole,
  verifyAdmin,
  verifySuperAdmin,
  verifyUser
};
