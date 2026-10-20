-- PG 版（和 platform/migrations/0009_challenges.sql 一一对应，自托管 PG 模式用）
-- 文本列一律 COLLATE "C"：SQLite 按字节比较和排序，PG 默认按库的区域规则，范围查询、ORDER BY、主键顺序都会不一样。
-- 社交第二期：异步挑战（平台 0.18.0，docs/platform-backend.md 15.18）。一个挑战一行、每人结果一行；开盘先用。
-- id 是"36 进制毫秒时间 + 随机"：挑战按创建时间过期，Cron 按 id 的范围删 30 天前的挑战和它们的结果，不扫全表。
-- payload、stats 是游戏自己的 JSON（各 ≤ 1 KB），平台原样存、原样回，不解析。
CREATE TABLE challenges (
  id TEXT COLLATE "C" NOT NULL PRIMARY KEY,
  game TEXT COLLATE "C" NOT NULL,
  owner_id TEXT COLLATE "C" NOT NULL,
  payload TEXT COLLATE "C" NOT NULL,
  created_at BIGINT NOT NULL,
  until BIGINT NOT NULL
);
-- 注销时删本人发起的
CREATE INDEX challenges_owner ON challenges (owner_id, created_at);

-- 每人每挑战只记第一次：主键 (challenge_id, user_id)，读一个挑战的结果是主键前缀扫描
CREATE TABLE challenge_results (
  challenge_id TEXT COLLATE "C" NOT NULL,
  user_id TEXT COLLATE "C" NOT NULL,
  score BIGINT NOT NULL,
  stats TEXT COLLATE "C",
  created_at BIGINT NOT NULL,
  PRIMARY KEY (challenge_id, user_id)
);
