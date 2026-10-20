-- PG 版（和 platform/migrations/0006_presence.sql 一一对应，自托管 PG 模式用）
-- 文本列一律 COLLATE "C"：SQLite 按字节比较和排序，PG 默认按库的区域规则，范围查询、ORDER BY、主键顺序都会不一样。
-- 0006：好友在线（docs/social.md 1.2，平台 0.13.0）。在哪跟着用户行写（不另开表），一个人每 2 分钟最多 1 次，和 last_seen_at 一起写。
-- presence_json：最近一次报的位置 {place, game?, room?, seats?}；presence_at：那一次的时间，5 分钟内算在线；
-- show_where：让好友看到我在不在线、在哪，默认开，关了好友只看到"几天前来过"。
ALTER TABLE users ADD COLUMN presence_json TEXT COLLATE "C";
ALTER TABLE users ADD COLUMN presence_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN show_where BIGINT NOT NULL DEFAULT 1;
-- 计量多一类 live（报位置、邀请），和"好友与资料"分开：报位置一直在写，不能把加好友挤停
ALTER TABLE meter_hourly ADD COLUMN rows_live BIGINT NOT NULL DEFAULT 0;
