# 比赛流程测试造数脚本

**安全说明：** `NODE_ENV=production` 时，`seed_*`、`revert_*`、`set_team_captain` 会被拒绝执行。若维护窗口确需执行，需设置 `ALLOW_DANGEROUS_DB_SCRIPTS=1`（强烈不建议用于正式用户库）。

## 1) 批量创建测试账号

```bash
npm run seed:test-users -- --count 80 --prefix test_user_ --password 123456
```

可选参数：

- `--count` 创建数量（默认 `80`）
- `--start` 起始编号（默认 `1`）
- `--prefix` 账号前缀（默认 `test_user_`）
- `--password` 默认密码（默认 `123456`）
- `--role` 角色（默认 `user`）
- `--withPubg` 是否自动绑定 PUBG 信息并写入战力缓存（默认 `true`）

## 2) 一键准备比赛流程数据

```bash
npm run seed:match-flow -- --stage completed --userPrefix test_user_ --teamCount 16 --rounds 3
```

可选参数：

- `--matchId` 指定已有比赛 ID；不传则自动新建比赛
- `--title` 新建比赛标题（仅新建时生效）
- `--stage` 目标阶段：`registration` / `frozen` / `live` / `completed`（默认 `completed`）
- `--teamCount` 队伍数（2~16，默认 `16`）
- `--userPrefix` 从该前缀账号池里取用户（默认 `test_user_`）
- `--rounds` 仅 `completed` 阶段生效，自动生成局次（默认 `1`）
- `--reset` 是否清理该比赛已有轮次/快照后重建（默认 `true`）

## 推荐测试顺序

1. 先跑账号脚本，确认数量足够（16 队至少需要 64 人）。
2. 按阶段分次执行：
   - `registration`（验证报名页）
   - `frozen`（验证冻结名单）
   - `live`（验证赛中状态）
   - `completed`（验证榜单和赛后页）
3. 每次都可指定同一个 `--matchId`，实现可重复回放。
