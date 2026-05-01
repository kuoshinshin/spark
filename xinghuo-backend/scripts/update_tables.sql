-- 修改队伍表，添加状态字段
ALTER TABLE teams ADD COLUMN status ENUM('locked', 'unlocked', 'completed') DEFAULT 'locked' AFTER locked;
ALTER TABLE teams ADD COLUMN captain_user_id VARCHAR(255) AFTER team_name;
ALTER TABLE teams ADD COLUMN updated_by VARCHAR(255) AFTER captain_user_id;

-- 修改选手卡表，添加唯一标识
ALTER TABLE player_cards ADD COLUMN uuid VARCHAR(36) UNIQUE AFTER id;
ALTER TABLE player_cards ADD COLUMN created_by VARCHAR(255) AFTER uuid;
ALTER TABLE player_cards ADD COLUMN updated_by VARCHAR(255) AFTER created_by;

-- 修改队员表，添加选手卡唯一标识关联
ALTER TABLE team_players ADD COLUMN player_card_uuid VARCHAR(36) AFTER user_id;
ALTER TABLE team_players ADD COLUMN joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER is_current_user;

-- 添加索引
CREATE INDEX idx_teams_status ON teams(status);
CREATE INDEX idx_player_cards_uuid ON player_cards(uuid);
CREATE INDEX idx_team_players_player_card_uuid ON team_players(player_card_uuid);