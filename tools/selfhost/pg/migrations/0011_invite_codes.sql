-- PG 版（和 platform/migrations/0011_invite_codes.sql 一一对应，自托管 PG 模式用）
-- 文本列一律 COLLATE "C"：SQLite 按字节比较和排序，PG 默认按库的区域规则，范围查询、ORDER BY、主键顺序都会不一样。
-- 邀请码（平台 0.20.0，docs/platform-backend.md 15.20）。表名避开好友房邀请的 invites。
-- 码存明文（主线 2026-10-17 定：没用的码要能再复制、再分享；码只能注册、7 天过期，泄露代价小），按码直接查。
-- "用掉的额度" = 已用的 + 没用没撤回没过期的；被邀请人注销时只清 used_by，used_at 留着，额度不还。
CREATE TABLE invite_codes (
  id TEXT COLLATE "C" NOT NULL PRIMARY KEY,
  code TEXT COLLATE "C" NOT NULL,
  owner_id TEXT COLLATE "C" NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_by TEXT COLLATE "C",
  used_at BIGINT,
  revoked_at BIGINT
);
CREATE UNIQUE INDEX invite_codes_code ON invite_codes (code);
-- 我的码、用掉的额度、24 小时内生成了几个
CREATE INDEX invite_codes_owner ON invite_codes (owner_id, created_at);

-- 管理员单独给某人改的额度；空 = 按角色用默认（settings 的 invite_rules）
ALTER TABLE users ADD COLUMN invite_quota BIGINT;
