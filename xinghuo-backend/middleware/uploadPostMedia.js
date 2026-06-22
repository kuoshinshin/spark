const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const postsDir = path.join(__dirname, '..', 'uploads', 'posts');
fs.mkdirSync(postsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, postsDir);
  },
  filename: (_req, file, cb) => {
    const extMap = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
    };
    const ext = extMap[file.mimetype] || '.img';
    const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const postMediaUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('仅支持 JPEG、PNG、WebP、GIF 图片'));
  },
});

module.exports = { postMediaUpload, postsDir };
