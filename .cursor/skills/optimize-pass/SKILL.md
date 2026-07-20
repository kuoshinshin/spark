---
name: optimize-pass
description: >-
  对星火项目做一轮常态化代码/性能巡检并小步修复。在用户说「优化巡检」「optimize pass」「跑一轮优化」「发版前优化」时使用。
---

# Optimize Pass（常态巡检）

## 何时使用

用户要求定期优化、发版前检查、或感觉页面变慢/请求变多时。

## 流程

1. **定范围**
   - 默认热点：`xinghuo/src/components/profile/Profile.vue`、`xinghuo/src/components/chat/Chat.vue`、`xinghuo-backend/services/pubgApi.js`、`xinghuo-backend/controllers/userController.js`
   - 若有未提交改动，优先扫 `git diff` / 近期改过的文件

2. **按清单检查（记录证据）**
   - 写接口缺提交锁 / 可连点重复入库
   - 同一页面重复打同一 API；缺缓存或缓存 key 过粗/过细
   - PUBG：无 `getOrRefresh`、过高并发、误把历史赛季写入排行榜缓存
   - 前端：错误的「永远是自己」资料、不稳定 list key、不可见仍轮询
   - 超大 Vue SFC 继续堆逻辑；死代码 / 已删功能残留引用
   - Nginx/媒体：硬编码会被静态正则抢走的图片 URL

3. **分级输出**
   - **P0**：数据错误、重复写入、配额打爆、生产必挂
   - **P1**：明显性能/体验（重复请求、缺锁、错误缓存）
   - **P2**：可读性/结构（大文件拆分等）——默认本轮不做

4. **修复**
   - 默认只修 **P0/P1**，小步改动，不顺手大重构
   - 修完：`xinghuo` 执行 `npm run build`；后端对改动文件 `node --check` 或跑 `node scripts/ci-check.mjs`

5. **回报**
   - 用简短中文列出：发现项、已修、未修（P2）与建议下次巡检点
