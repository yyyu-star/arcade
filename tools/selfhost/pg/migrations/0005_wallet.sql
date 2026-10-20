-- PG 版（和 platform/migrations/0005_wallet.sql 一一对应，自托管 PG 模式用）
-- 文本列一律 COLLATE "C"：SQLite 按字节比较和排序，PG 默认按库的区域规则，范围查询、ORDER BY、主键顺序都会不一样。
-- 0005：钱包（筹码体系第 1 步，docs/economy.md 第 3、4、6 节；接口和写入行数见 docs/platform-backend.md 5.9）。
-- 一人一行，整行是一个 JSON：余额、各游戏桌上那一份、补给日期、当天计数、最近的操作 id、最近到期退回过的 ref。
-- 每次带入、结回、放弃、领补给、到期退回只改这一行：WITHOUT ROWID、主键 user_id、没有别的索引，所以插入、更新都是 1 行。
-- rev 每写一次加一，更新时带 "WHERE rev = 读到的值"：同一个人两个游戏同时调钱包时，后到的那次不会盖掉先到的（冲突就重读再算）。
-- 主键就是 user_id：注销、删号、一年清理按人删是主键等值查找。
-- 新号不在注册时建行：第一次真正写钱包时才建（送 10,000），只看不写的人不占行。
CREATE TABLE wallets (
  user_id TEXT COLLATE "C" PRIMARY KEY,
  rev BIGINT NOT NULL,
  state TEXT COLLATE "C" NOT NULL,
  updated_at BIGINT NOT NULL
);

-- 全站筹码统计：每个北京日期一行（Cron 每天记一次前一天的），管理页看。data 是 JSON（总量、新号送的、补给、各游戏带入结回退回）。
CREATE TABLE wallet_stats (
  day TEXT COLLATE "C" PRIMARY KEY,
  data TEXT COLLATE "C" NOT NULL,
  created_at BIGINT NOT NULL
);

-- 钱包的写入单独一个预算类别（6.6）：刷钱包只停钱包，不连累存档和登录。
ALTER TABLE meter_hourly ADD COLUMN rows_wallet BIGINT NOT NULL DEFAULT 0;
