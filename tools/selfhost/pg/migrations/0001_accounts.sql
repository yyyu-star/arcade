-- PG 版（和 platform/migrations/0001_accounts.sql 一一对应，自托管 PG 模式用）
-- 文本列一律 COLLATE "C"：SQLite 按字节比较和排序，PG 默认按库的区域规则，范围查询、ORDER BY、主键顺序都会不一样。
-- 0001：账号、会话、凭证、好友、屏蔽、云存档、限流计数、计量。设计见仓库根 docs/platform-backend.md 第 7 节。
-- 迁移只增不删。SQLite 版全部用 WITHOUT ROWID（PG 没有这个概念，已去掉）：主键是 TEXT 或多列的普通表会另建一个自动唯一索引，每次插入多写 1 行（7.1）。
-- 时间一律是 Unix 毫秒整数。

-- id：128 位随机数（base64url 22 位）；username：归一化后的小写用户名，只用来登录，不给别人看。
CREATE TABLE users (
  id TEXT COLLATE "C" PRIMARY KEY,
  username TEXT COLLATE "C" NOT NULL UNIQUE,
  display_name TEXT COLLATE "C" NOT NULL,
  friend_code TEXT COLLATE "C" NOT NULL UNIQUE,
  avatar_json TEXT COLLATE "C",
  catchphrase_id BIGINT,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL
);

-- token_hash：会话令牌的 HMAC（带 kid），库里不存令牌原文。
CREATE TABLE sessions (
  token_hash TEXT COLLATE "C" PRIMARY KEY,
  user_id TEXT COLLATE "C" NOT NULL,
  created_at BIGINT NOT NULL,
  renewed_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- 每个账号每种类型一条：密码哈希、恢复码 HMAC。以后多个 passkey、第三方登录另建表（7.1）。
CREATE TABLE credentials (
  user_id TEXT COLLATE "C" NOT NULL,
  type TEXT COLLATE "C" NOT NULL CHECK (type IN ('password', 'recovery')),
  secret TEXT COLLATE "C" NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, type)
);

-- 一对人一行，user_a < user_b；requested_by 是发请求的一方。
CREATE TABLE friendships (
  user_a TEXT COLLATE "C" NOT NULL,
  user_b TEXT COLLATE "C" NOT NULL,
  status TEXT COLLATE "C" NOT NULL CHECK (status IN ('pending', 'accepted')),
  requested_by TEXT COLLATE "C" NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX friendships_b ON friendships (user_b);

CREATE TABLE blocks (
  blocker TEXT COLLATE "C" NOT NULL,
  blocked TEXT COLLATE "C" NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (blocker, blocked)
);

-- data 是游戏给的不透明 JSON；size 是它的 UTF-8 字节数，用来算每人合计。
CREATE TABLE saves (
  user_id TEXT COLLATE "C" NOT NULL,
  game_id TEXT COLLATE "C" NOT NULL,
  slot TEXT COLLATE "C" NOT NULL,
  rev BIGINT NOT NULL,
  data TEXT COLLATE "C" NOT NULL,
  size BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, game_id, slot)
);

-- 固定窗口计数；blocked_until 只给失败计数的指数延迟用（5.4）。
CREATE TABLE rate_counters (
  key TEXT COLLATE "C" PRIMARY KEY,
  window_start BIGINT NOT NULL,
  count BIGINT NOT NULL,
  blocked_until BIGINT NOT NULL DEFAULT 0
);

-- 6.6 的计量：每个 UTC 小时一行；rows_* 是各类别的 D1 写入行数，db_size 取最近一次 meta.size_after。
CREATE TABLE meter_hourly (
  hour TEXT COLLATE "C" PRIMARY KEY,
  requests BIGINT NOT NULL DEFAULT 0,
  rows_read BIGINT NOT NULL DEFAULT 0,
  rows_reg BIGINT NOT NULL DEFAULT 0,
  rows_auth BIGINT NOT NULL DEFAULT 0,
  rows_save BIGINT NOT NULL DEFAULT 0,
  rows_social BIGINT NOT NULL DEFAULT 0,
  rows_acct BIGINT NOT NULL DEFAULT 0,
  rows_sys BIGINT NOT NULL DEFAULT 0,
  login_attempts BIGINT NOT NULL DEFAULT 0,
  recover_attempts BIGINT NOT NULL DEFAULT 0,
  db_size BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);
