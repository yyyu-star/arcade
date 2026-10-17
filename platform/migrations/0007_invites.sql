-- 社交第一期 1.3 一键叫人（平台 0.14.0，docs/social.md）：A 在房间里叫好友 B 来，记一条，10 分钟有效。
-- 一条插入写 3 行（表 + 两个索引）；"不了"只改 dismissed（没有索引）1 行；Cron 删 2 天前的。
-- 每天 50 条、同一个好友 1 分钟 1 条直接按这张表数，不另记限流计数。
CREATE TABLE invites (
  id TEXT NOT NULL PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  game TEXT NOT NULL,
  room TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  until INTEGER NOT NULL,
  dismissed INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
-- 收邀请：B 每 30 秒问一次自己还没过期的
CREATE INDEX invites_to ON invites (to_id, until);
-- 发邀请：数 A 最近 24 小时发了几条、最近一次叫 B 是什么时候
CREATE INDEX invites_from ON invites (from_id, created_at);
