-- 社交第二期：搭子战绩（平台 0.19.0，docs/platform-backend.md 15.19）。只记已经是好友的两个人，只给好友看，本人能关（show_mates）。
-- 一对人一个游戏一行（lo < hi，和 friendships 的 user_a < user_b 同一个顺序），不是每人一行：4 人一桌 6 行而不是 12 行。
-- last_op 是最后记上的那一场，游戏拿同一个 op 重报时不再加。
CREATE TABLE mates (
  lo TEXT NOT NULL,
  hi TEXT NOT NULL,
  game TEXT NOT NULL,
  n INTEGER NOT NULL,
  lo_wins INTEGER NOT NULL,
  hi_wins INTEGER NOT NULL,
  team_n INTEGER NOT NULL,
  team_wins INTEGER NOT NULL,
  last_op TEXT NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (lo, hi, game)
) WITHOUT ROWID;
-- 我在 hi 那一边时：好友列表、注销按人找
CREATE INDEX mates_hi ON mates (hi);

ALTER TABLE users ADD COLUMN show_mates INTEGER NOT NULL DEFAULT 1;
