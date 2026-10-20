-- PG 版（和 platform/migrations/0010_mates.sql 一一对应，自托管 PG 模式用）
-- 文本列一律 COLLATE "C"：SQLite 按字节比较和排序，PG 默认按库的区域规则，范围查询、ORDER BY、主键顺序都会不一样。
-- 社交第二期：搭子战绩（平台 0.19.0，docs/platform-backend.md 15.19）。只记已经是好友的两个人，只给好友看，本人能关（show_mates）。
-- 一对人一个游戏一行（lo < hi，和 friendships 的 user_a < user_b 同一个顺序），不是每人一行：4 人一桌 6 行而不是 12 行。
-- last_op 是最后记上的那一场，游戏拿同一个 op 重报时不再加。
CREATE TABLE mates (
  lo TEXT COLLATE "C" NOT NULL,
  hi TEXT COLLATE "C" NOT NULL,
  game TEXT COLLATE "C" NOT NULL,
  n BIGINT NOT NULL,
  lo_wins BIGINT NOT NULL,
  hi_wins BIGINT NOT NULL,
  team_n BIGINT NOT NULL,
  team_wins BIGINT NOT NULL,
  last_op TEXT COLLATE "C" NOT NULL,
  last_at BIGINT NOT NULL,
  PRIMARY KEY (lo, hi, game)
);
-- 我在 hi 那一边时：好友列表、注销按人找
CREATE INDEX mates_hi ON mates (hi);

ALTER TABLE users ADD COLUMN show_mates BIGINT NOT NULL DEFAULT 1;
