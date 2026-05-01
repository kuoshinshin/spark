# 星火后台系统 API 文档

## 1. 项目概述

星火后台系统是一个基于 Node.js + Express.js + MySQL 开发的 RESTful API 服务，为星火前端项目提供后端支持。

### 1.1 技术栈

- **后端框架**: Express.js
- **数据库**: MySQL
- **认证方式**: JWT (JSON Web Token)
- **API 风格**: RESTful

### 1.2 项目结构

```
xinghuo-backend/
├── config/           # 配置文件
├── models/           # 数据模型
├── controllers/      # 控制器
├── middleware/       # 中间件
├── routes/           # 路由
├── app.js            # 应用入口
└── package.json      # 项目依赖
```

### 1.3 新增功能

- **请求频率限制**: 防止 API 滥用
- **API 响应压缩**: 减少网络传输量
- **缓存控制**: 优化请求性能

## 2. 认证相关 API

### 2.1 用户注册

**请求方法**: POST
**请求 URL**: `/api/auth/register`

**请求参数**:


| 参数名        | 类型     | 必填  | 描述                |
| ---------- | ------ | --- | ----------------- |
| account    | String | 是   | 账号                |
| username   | String | 是   | 用户名               |
| email      | String | 是   | 邮箱                |
| password   | String | 是   | 密码                |
| inviteCode | String | 是   | 邀请码 (xinghuo2026) |


**响应格式**:

```json
{
  "message": "注册成功",
  "userId": 1
}
```

**使用示例**:

```javascript
// 前端调用示例
const response = await fetch('http://127.0.0.1:3000/api/auth/register', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    account: 'testuser',
    username: '测试用户',
    email: 'test@example.com',
    password: 'password123',
    inviteCode: 'xinghuo2026'
  })
});

const data = await response.json();
console.log(data); // { message: "注册成功", userId: 1 }
```

### 2.2 用户登录

**请求方法**: POST
**请求 URL**: `/api/auth/login`

**请求参数**:


| 参数名      | 类型     | 必填  | 描述  |
| -------- | ------ | --- | --- |
| account  | String | 是   | 账号  |
| password | String | 是   | 密码  |


**响应格式**:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "account": "testuser",
    "username": "测试用户",
    "avatar": ""
  }
}
```

**使用示例**:

```javascript
// 前端调用示例
const response = await fetch('http://127.0.0.1:3000/api/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    account: 'testuser',
    password: 'password123'
  })
});

const data = await response.json();
// 存储 token
localStorage.setItem('token', data.token);
console.log('登录成功:', data.user);
```

## 3. 用户管理 API

### 3.1 获取用户信息

**请求方法**: GET
**请求 URL**: `/api/user/info`
**认证要求**: 需要 JWT token

**响应格式**:

```json
{
  "id": 1,
  "account": "testuser",
  "username": "测试用户",
  "email": "test@example.com",
  "avatar": "",
  "created_at": "2023-01-01T00:00:00Z"
}
```

**使用示例**:

```javascript
// 前端调用示例
const token = localStorage.getItem('token');
const response = await fetch('http://127.0.0.1:3000/api/user/info', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const userInfo = await response.json();
console.log('用户信息:', userInfo);
```

### 3.2 更新用户信息

**请求方法**: PUT
**请求 URL**: `/api/user/info`
**认证要求**: 需要 JWT token

**请求参数**:


| 参数名      | 类型     | 必填  | 描述     |
| -------- | ------ | --- | ------ |
| username | String | 否   | 用户名    |
| email    | String | 否   | 邮箱     |
| avatar   | String | 否   | 头像 URL |


**响应格式**:

```json
{
  "message": "更新成功",
  "user": {
    "id": 1,
    "account": "testuser",
    "username": "测试用户",
    "email": "test@example.com",
    "avatar": ""
  }
}
```

### 3.3 获取用户统计信息

**请求方法**: GET
**请求 URL**: `/api/user/stats`
**认证要求**: 需要 JWT token

**响应格式**:

```json
{
  "gameStats": {
    "matches": 10,
    "wins": 3,
    "kills": 50,
    "kdRatio": 5.0,
    "bestRank": "冠军"
  }
}
```

### 3.4 获取用户帖子

**请求方法**: GET
**请求 URL**: `/api/user/posts`
**认证要求**: 需要 JWT token

**响应格式**:

```json
[
  {
    "id": 1,
    "content": "这是一条帖子",
    "media": "http://example.com/image.jpg",
    "likes": 10,
    "comments": 5,
    "isLiked": false,
    "timestamp": "2023-01-01T00:00:00Z"
  }
]
```

### 3.5 更新深色模式设置

**请求方法**: PUT
**请求 URL**: `/api/user/dark-mode`
**认证要求**: 需要 JWT token

**请求参数**:


| 参数名      | 类型      | 必填  | 描述       |
| -------- | ------- | --- | -------- |
| darkMode | Boolean | 是   | 是否启用深色模式 |


**响应格式**:

```json
{
  "message": "深色模式设置更新成功"
}
```

### 3.6 获取用户列表

**请求方法**: GET
**请求 URL**: `/api/user/all`
**认证要求**: 需要 JWT token

**响应格式**:

```json
[
  {
    "id": 1,
    "account": "testuser",
    "username": "测试用户",
    "email": "test@example.com",
    "avatar": "",
    "created_at": "2023-01-01T00:00:00Z"
  }
]
```

## 4. 聊天管理 API

### 4.1 获取所有消息

**请求方法**: GET
**请求 URL**: `/api/chat/all`
**认证要求**: 需要 JWT token

**响应格式**:

```json
[
  {
    "id": 1,
    "userId": 1,
    "username": "测试用户",
    "avatar": "",
    "content": "这是一条消息",
    "media": "http://example.com/image.jpg",
    "mediaType": "image",
    "likes": 10,
    "comments": 5,
    "timestamp": "2023-01-01T00:00:00Z"
  }
]
```

### 4.2 发送消息

**请求方法**: POST
**请求 URL**: `/api/chat/send`
**认证要求**: 需要 JWT token

**请求参数**:


| 参数名       | 类型     | 必填  | 描述                 |
| --------- | ------ | --- | ------------------ |
| content   | String | 是   | 消息内容               |
| media     | String | 否   | 媒体 URL             |
| mediaType | String | 否   | 媒体类型 (image/video) |


**响应格式**:

```json
{
  "id": 1,
  "userId": 1,
  "username": "测试用户",
  "avatar": "",
  "content": "这是一条消息",
  "media": "http://example.com/image.jpg",
  "mediaType": "image",
  "likes": 0,
  "comments": 0,
  "timestamp": "2023-01-01T00:00:00Z"
}
```

### 4.3 点赞消息

**请求方法**: POST
**请求 URL**: `/api/chat/like`
**认证要求**: 需要 JWT token

**请求参数**:


| 参数名    | 类型     | 必填  | 描述    |
| ------ | ------ | --- | ----- |
| postId | Number | 是   | 帖子 ID |


**响应格式**:

```json
{
  "message": "点赞成功"
}
```

### 4.4 取消点赞

**请求方法**: POST
**请求 URL**: `/api/chat/unlike`
**认证要求**: 需要 JWT token

**请求参数**:


| 参数名    | 类型     | 必填  | 描述    |
| ------ | ------ | --- | ----- |
| postId | Number | 是   | 帖子 ID |


**响应格式**:

```json
{
  "message": "取消点赞成功"
}
```

### 4.5 检查点赞状态

**请求方法**: GET
**请求 URL**: `/api/chat/check-like`
**认证要求**: 需要 JWT token

**查询参数**:


| 参数名    | 类型     | 必填  | 描述    |
| ------ | ------ | --- | ----- |
| postId | Number | 是   | 帖子 ID |


**响应格式**:

```json
{
  "isLiked": true
}
```

### 4.6 创建评论

**请求方法**: POST
**请求 URL**: `/api/chat/comment`
**认证要求**: 需要 JWT token

**请求参数**:


| 参数名     | 类型     | 必填  | 描述    |
| ------- | ------ | --- | ----- |
| postId  | Number | 是   | 帖子 ID |
| content | String | 是   | 评论内容  |


**响应格式**:

```json
{
  "id": 1,
  "postId": 1,
  "userId": 1,
  "username": "测试用户",
  "avatar": "",
  "content": "这是一条评论",
  "timestamp": "2023-01-01T00:00:00Z"
}
```

### 4.7 获取评论

**请求方法**: GET
**请求 URL**: `/api/chat/comments`
**认证要求**: 需要 JWT token

**查询参数**:


| 参数名    | 类型     | 必填  | 描述    |
| ------ | ------ | --- | ----- |
| postId | Number | 是   | 帖子 ID |


**响应格式**:

```json
[
  {
    "id": 1,
    "postId": 1,
    "userId": 1,
    "username": "测试用户",
    "avatar": "",
    "content": "这是一条评论",
    "timestamp": "2023-01-01T00:00:00Z"
  }
]
```

### 4.8 获取热门消息

**请求方法**: GET
**请求 URL**: `/api/chat/hottest`
**认证要求**: 需要 JWT token

**响应格式**:

```json
[
  {
    "id": 1,
    "userId": 1,
    "username": "测试用户",
    "avatar": "",
    "content": "这是一条热门消息",
    "media": "http://example.com/image.jpg",
    "mediaType": "image",
    "likes": 100,
    "comments": 20,
    "timestamp": "2023-01-01T00:00:00Z"
  }
]
```

## 4. 比赛管理 API

### 4.1 获取所有比赛

**请求方法**: GET
**请求 URL**: `/api/match/all`

**响应格式**:

```json
[
  {
    "id": 1,
    "title": "比赛标题",
    "description": "比赛描述",
    "start_time": "2023-01-01T00:00:00Z",
    "end_time": "2023-01-02T00:00:00Z",
    "location": "线上",
    "status": "upcoming"
  }
]
```

### 4.2 获取即将开始的比赛

**请求方法**: GET
**请求 URL**: `/api/match/status/upcoming`

**响应格式**:

```json
[
  {
    "id": 1,
    "title": "比赛标题",
    "description": "比赛描述",
    "start_time": "2023-01-01T00:00:00Z",
    "end_time": "2023-01-02T00:00:00Z",
    "location": "线上",
    "status": "upcoming"
  }
]
```

### 4.3 获取正在进行的比赛

**请求方法**: GET
**请求 URL**: `/api/match/status/ongoing`

**响应格式**:

```json
[
  {
    "id": 1,
    "title": "比赛标题",
    "description": "比赛描述",
    "start_time": "2023-01-01T00:00:00Z",
    "end_time": "2023-01-02T00:00:00Z",
    "location": "线上",
    "status": "ongoing"
  }
]
```

### 4.4 创建比赛

**请求方法**: POST
**请求 URL**: `/api/match/create`
**认证要求**: 需要 JWT token

**请求参数**:


| 参数名         | 类型     | 必填  | 描述            |
| ----------- | ------ | --- | ------------- |
| title       | String | 是   | 比赛标题          |
| description | String | 是   | 比赛描述          |
| start_time  | String | 是   | 开始时间 (ISO 格式) |
| end_time    | String | 是   | 结束时间 (ISO 格式) |
| location    | String | 是   | 比赛地点          |


**响应格式**:

```json
{
  "message": "比赛创建成功",
  "matchId": 1
}
```

## 5. 分享管理 API

### 6.1 获取帖子列表

**请求方法**: GET
**请求 URL**: `/api/share/all`
**认证要求**: 需要 JWT token

**响应格式**:

```json
[
  {
    "id": 1,
    "userId": 1,
    "username": "测试用户",
    "avatar": "",
    "content": "这是一条分享",
    "media": "http://example.com/image.jpg",
    "mediaType": "image",
    "likes": 10,
    "comments": 5,
    "timestamp": "2023-01-01T00:00:00Z"
  }
]
```

### 6.2 创建新帖子

**请求方法**: POST
**请求 URL**: `/api/share/create`
**认证要求**: 需要 JWT token

**请求参数**:


| 参数名       | 类型     | 必填  | 描述                 |
| --------- | ------ | --- | ------------------ |
| content   | String | 是   | 帖子内容               |
| media     | String | 否   | 媒体 URL             |
| mediaType | String | 否   | 媒体类型 (image/video) |


**响应格式**:

```json
{
  "id": 1,
  "userId": 1,
  "username": "测试用户",
  "avatar": "",
  "content": "这是一条分享",
  "media": "http://example.com/image.jpg",
  "mediaType": "image",
  "likes": 0,
  "comments": 0,
  "timestamp": "2023-01-01T00:00:00Z"
}
```

### 6.3 点赞帖子

**请求方法**: POST
**请求 URL**: `/api/share/like`
**认证要求**: 需要 JWT token

**请求参数**:


| 参数名    | 类型     | 必填  | 描述    |
| ------ | ------ | --- | ----- |
| postId | Number | 是   | 帖子 ID |


**响应格式**:

```json
{
  "message": "点赞成功"
}
```

## 7. 轮播图管理 API

### 7.1 获取轮播图列表

**请求方法**: GET
**请求 URL**: `/api/carousel/list`

**响应格式**:

```json
[
  {
    "id": 1,
    "image_url": "http://example.com/image.jpg",
    "link_url": "http://example.com",
    "order": 1,
    "is_active": true,
    "created_at": "2023-01-01T00:00:00Z"
  }
]
```

## 8. 错误处理

所有 API 响应都会包含错误信息（如果有）：

**错误响应格式**:

```json
{
  "error": "错误信息"
}
```

**常见错误码**:


| 状态码 | 描述              |
| --- | --------------- |
| 400 | 请求参数错误          |
| 401 | 未授权，token 无效或过期 |
| 403 | 禁止访问            |
| 404 | 资源不存在           |
| 429 | 请求过于频繁          |
| 500 | 服务器内部错误         |


## 9. 认证方式

所有需要认证的 API 都需要在请求头中携带 JWT token：

```
Authorization: Bearer <token>
```

其中 `<token>` 是登录成功后返回的 token。

## 10. 请求频率限制

为防止 API 滥用，系统实施了请求频率限制：

- **限制**: 每个 IP 在 15 分钟内最多 100 次请求
- **超过限制**: 返回 429 状态码和错误信息
- **响应头**: 包含频率限制信息

## 11. 健康检查

**请求方法**: GET
**请求 URL**: `/health`

**响应格式**:

```json
{
  "status": "ok",
  "message": "服务运行正常"
}
```

## 12. 前端集成示例

### 12.1 API 服务配置

```javascript
// src/services/api.js
const API_BASE_URL = 'http://127.0.0.1:3000/api';

async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = localStorage.getItem('token');
  
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
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
  
  const response = await fetch(url, mergedOptions);
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || '请求失败');
  }
  
  return data;
}

// 示例 API 调用
export const authApi = {
  login: async (credentials) => {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  },
};
```

### 12.2 登录组件集成

```vue
<template>
  <div class="login-container">
    <h2>登录</h2>
    <form @submit.prevent="handleLogin">
      <input v-model="account" placeholder="账号" required />
      <input v-model="password" type="password" placeholder="密码" required />
      <button type="submit">登录</button>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { authApi } from '../services/api';

const account = ref('');
const password = ref('');

const handleLogin = async () => {
  try {
    const response = await authApi.login({ account: account.value, password: password.value });
    localStorage.setItem('token', response.token);
    console.log('登录成功:', response.user);
  } catch (error) {
    console.error('登录失败:', error);
  }
};
</script>
```

