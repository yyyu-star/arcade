-- 0006：好友在线（docs/social.md 1.2，平台 0.13.0）。在哪跟着用户行写（不另开表），一个人每 2 分钟最多 1 次，和 last_seen_at 一起写。
-- presence_json：最近一次报的位置 {place, game?, room?, seats?}；presence_at：那一次的时间，5 分钟内算在线；
-- show_where：让好友看到我在不在线、在哪，默认开，关了好友只看到"几天前来过"。
ALTER TABLE users ADD COLUMN presence_json TEXT;
ALTER TABLE users ADD COLUMN presence_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN show_where INTEGER NOT NULL DEFAULT 1;
-- 计量多一类 live（报位置、邀请），和"好友与资料"分开：报位置一直在写，不能把加好友挤停
ALTER TABLE meter_hourly ADD COLUMN rows_live INTEGER NOT NULL DEFAULT 0;
