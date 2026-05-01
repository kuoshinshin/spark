-- 添加account字段到users表
ALTER TABLE users ADD COLUMN account VARCHAR(255) NOT NULL UNIQUE AFTER id;

-- 更新现有数据，为已存在的用户设置默认账号
UPDATE users SET account = CONCAT('user_', id) WHERE account = '';
