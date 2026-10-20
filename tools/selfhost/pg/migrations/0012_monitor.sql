-- PG 版（和 platform/migrations/0012_monitor.sql 一一对应，自托管 PG 模式用）
-- 文本列一律 COLLATE "C"：SQLite 按字节比较和排序，PG 默认按库的区域规则，范围查询、ORDER BY、主键顺序都会不一样。
-- 监控（平台 0.26.0，docs/platform-backend.md 第 16 节）：浏览器报错按签名每天一行计数，不存原文；巡检状态放 settings 的 monitor 一行。
CREATE TABLE monitor_counts (
  day TEXT COLLATE "C" NOT NULL,
  game TEXT COLLATE "C" NOT NULL,
  kind TEXT COLLATE "C" NOT NULL,
  sig TEXT COLLATE "C" NOT NULL,
  n BIGINT NOT NULL,
  first_ver TEXT COLLATE "C" NOT NULL,
  ver TEXT COLLATE "C" NOT NULL,
  last_at BIGINT NOT NULL,
  PRIMARY KEY (day, game, kind, sig)
);

-- 监控的写入单独一个预算类别（6.6）。
ALTER TABLE meter_hourly ADD COLUMN rows_mon BIGINT NOT NULL DEFAULT 0;
