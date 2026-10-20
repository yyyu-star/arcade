-- PG 版（和 platform/migrations/0004_settings.sql 一一对应，自托管 PG 模式用）
-- 文本列一律 COLLATE "C"：SQLite 按字节比较和排序，PG 默认按库的区域规则，范围查询、ORDER BY、主键顺序都会不一样。
-- 0004：运行时设置（维护者 2026-10-14 要"管理员随时开关注册"，改了不用重新部署）。
-- 一个键一行；现在只有 registration（值 'open' / 'closed'）。没有这一行按"关"算，所以迁移不放初始数据，线上默认仍然关着。
-- 紧急总闸仍是 wrangler.jsonc 的 vars.REGISTRATION：只有 "switch" 才听这里，其余任何值都强制关（worker/api/settings.ts）。
CREATE TABLE settings (
  key TEXT COLLATE "C" PRIMARY KEY,
  value TEXT COLLATE "C" NOT NULL,
  updated_at BIGINT NOT NULL
);
