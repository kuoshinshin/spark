const path = require('path');
const fs = require('fs');

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** 将各类存储格式统一为 uploads 下的相对路径，如 avatars/foo.png */
function normalizeUploadRelativePath(raw) {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      value = url.pathname;
      if (url.searchParams.has('path')) {
        value = decodeURIComponent(url.searchParams.get('path'));
      }
    } catch {
      return null;
    }
  }

  value = value.split('?')[0].replace(/^\/+/, '');
  value = value.replace(/^api\/uploads\//, '').replace(/^uploads\//, '');

  if (value.includes('..') || value.includes('\\')) return null;
  if (!/^(avatars|posts)\/[^/]+$/i.test(value)) return null;
  return value;
}

function createServeUploadMedia(uploadsRoot) {
  const root = path.resolve(uploadsRoot);

  return function serveUploadMedia(req, res) {
    const relative = normalizeUploadRelativePath(String(req.query.path || ''));
    if (!relative) {
      return res.status(400).json({ error: '无效的图片路径' });
    }

    const filePath = path.resolve(root, relative);
    if (!filePath.startsWith(root + path.sep) && filePath !== root) {
      return res.status(403).json({ error: '禁止访问' });
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return res.status(404).json({ error: '文件不存在' });
    }

    const ext = path.extname(filePath).toLowerCase();
    res.type(MIME_BY_EXT[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return res.sendFile(filePath);
  };
}

function isUploadMediaRequest(req) {
  const p = req.path || '';
  return p === '/api/media'
    || p.startsWith('/api/uploads/')
    || p.startsWith('/uploads/');
}

module.exports = {
  createServeUploadMedia,
  normalizeUploadRelativePath,
  isUploadMediaRequest,
};
