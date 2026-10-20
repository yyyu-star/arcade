-- 建表语句跨行、带注释（和平台的迁移一样）：导出时原样写进去，恢复不能按行拆
CREATE TABLE ticks (
  cron TEXT,   -- 哪条 cron
  at INTEGER   -- 投的时间
);
