-- 0004：运行时设置（维护者 2026-10-14 要"管理员随时开关注册"，改了不用重新部署）。
-- 一个键一行；现在只有 registration（值 'open' / 'closed'）。没有这一行按"关"算，所以迁移不放初始数据，线上默认仍然关着。
-- 紧急总闸仍是 wrangler.jsonc 的 vars.REGISTRATION：只有 "switch" 才听这里，其余任何值都强制关（worker/api/settings.ts）。
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
