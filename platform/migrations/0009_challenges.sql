-- 社交第二期：异步挑战（平台 0.18.0，docs/platform-backend.md 15.18）。一个挑战一行、每人结果一行；开盘先用。
-- id 是"36 进制毫秒时间 + 随机"：挑战按创建时间过期，Cron 按 id 的范围删 30 天前的挑战和它们的结果，不扫全表。
-- payload、stats 是游戏自己的 JSON（各 ≤ 1 KB），平台原样存、原样回，不解析。
CREATE TABLE challenges (
  id TEXT NOT NULL PRIMARY KEY,
  game TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  until INTEGER NOT NULL
) WITHOUT ROWID;
-- 注销时删本人发起的
CREATE INDEX challenges_owner ON challenges (owner_id, created_at);

-- 每人每挑战只记第一次：主键 (challenge_id, user_id)，读一个挑战的结果是主键前缀扫描
CREATE TABLE challenge_results (
  challenge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  stats TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, user_id)
) WITHOUT ROWID;
