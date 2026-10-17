-- 社交第二期：好友动态（平台 0.17.0，docs/platform-backend.md 15.17）。只给好友看，保留 7 天，本人能关（show_feed）。
-- id 是"时间前缀 + 随机"：按 id 排就是按时间，Cron 按 id 的范围删 7 天前的动态和它们的赞，不扫全表。
CREATE TABLE feed (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  game TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('settle', 'moment')),
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
-- 我和好友最近 7 天的、今天发了几条
CREATE INDEX feed_user ON feed (user_id, created_at);

-- 赞和扔道具：每条每人一次。插入 1 行（没有别的索引）
CREATE TABLE feed_reactions (
  item_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, user_id)
) WITHOUT ROWID;

ALTER TABLE users ADD COLUMN show_feed INTEGER NOT NULL DEFAULT 1;
