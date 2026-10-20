-- 监控（docs/platform-backend.md 第 16 节）。
-- 浏览器报错按签名每天一行计数（签名 = 游戏 + 报错前 80 字的哈希，不存原文）：n 是当天报了几次，
-- first_ver 是这个签名当天第一次出现时游戏的版本（判断"发版后的新报错"），ver 是最近一次的版本。Cron 留 7 天。
CREATE TABLE monitor_counts (
  day TEXT NOT NULL,
  game TEXT NOT NULL,
  kind TEXT NOT NULL,
  sig TEXT NOT NULL,
  n INTEGER NOT NULL,
  first_ver TEXT NOT NULL,
  ver TEXT NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (day, game, kind, sig)
) WITHOUT ROWID;

-- 监控的写入单独一个预算类别（6.6）：报错刷屏只停计数，不连累清理和别的接口。
ALTER TABLE meter_hourly ADD COLUMN rows_mon INTEGER NOT NULL DEFAULT 0;
