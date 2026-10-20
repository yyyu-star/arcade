-- PG 版（和 platform/migrations/0008_feed.sql 一一对应，自托管 PG 模式用）
-- 文本列一律 COLLATE "C"：SQLite 按字节比较和排序，PG 默认按库的区域规则，范围查询、ORDER BY、主键顺序都会不一样。
-- 社交第二期：好友动态（平台 0.17.0，docs/platform-backend.md 15.17）。只给好友看，保留 7 天，本人能关（show_feed）。
-- id 是"时间前缀 + 随机"：按 id 排就是按时间，Cron 按 id 的范围删 7 天前的动态和它们的赞，不扫全表。
CREATE TABLE feed (
  id TEXT COLLATE "C" NOT NULL PRIMARY KEY,
  user_id TEXT COLLATE "C" NOT NULL,
  game TEXT COLLATE "C" NOT NULL,
  kind TEXT COLLATE "C" NOT NULL CHECK (kind IN ('settle', 'moment')),
  data TEXT COLLATE "C" NOT NULL,
  created_at BIGINT NOT NULL
);
-- 我和好友最近 7 天的、今天发了几条
CREATE INDEX feed_user ON feed (user_id, created_at);

-- 赞和扔道具：每条每人一次。插入 1 行（没有别的索引）
CREATE TABLE feed_reactions (
  item_id TEXT COLLATE "C" NOT NULL,
  user_id TEXT COLLATE "C" NOT NULL,
  kind TEXT COLLATE "C" NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (item_id, user_id)
);

ALTER TABLE users ADD COLUMN show_feed BIGINT NOT NULL DEFAULT 1;
