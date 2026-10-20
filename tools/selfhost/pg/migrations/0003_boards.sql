-- PG 版（和 platform/migrations/0003_boards.sql 一一对应，自托管 PG 模式用）
-- 文本列一律 COLLATE "C"：SQLite 按字节比较和排序，PG 默认按库的区域规则，范围查询、ORDER BY、主键顺序都会不一样。
-- 0003：排行榜（简单版，不防作弊：维护者 2026-10-14 定"能作弊是他的本事"）。只做额度和数据合法性检查。
-- 每人每榜只留最好的一条（越高越好）。game_id 是 platform/src/games.ts 里的游戏 id；board_id 只收两种形式（worker/api/boards.ts）：
-- 每日榜 daily-YYYY-MM-DD（可带 -v<n>），和 games.ts 里登记的固定榜。
-- 主键以 user_id 开头：注销、删号、一年清理按人删是主键前缀扫描，不用扫全表；交分、查我的分、好友榜逐个查都是完整主键的等值查找。
-- 排名用 (game_id, board_id, score DESC, updated_at) 索引：带上 updated_at，同分先达到的在前也能直接按索引取前 50，不用读整个榜再排（实测）；
-- Cron 清旧的每日榜也走它（按 board_id 的范围）。插入一条 = 表 1 + 索引 1 = 2 行。
CREATE TABLE boards (
  user_id TEXT COLLATE "C" NOT NULL,
  game_id TEXT COLLATE "C" NOT NULL,
  board_id TEXT COLLATE "C" NOT NULL,
  score BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, game_id, board_id)
);
CREATE INDEX boards_rank ON boards (game_id, board_id, score DESC, updated_at);

-- 排行榜的写入单独一个预算类别（6.6）：刷榜不会把云存档挤停。
ALTER TABLE meter_hourly ADD COLUMN rows_board BIGINT NOT NULL DEFAULT 0;
