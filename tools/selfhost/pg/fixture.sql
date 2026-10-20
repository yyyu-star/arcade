-- check-sql.mjs 的对照数据：SQLite（平台原版迁移）和 PG（PG 版迁移）各灌一份，覆盖表的每条语句两边跑同一组参数比结果。
-- 只写两边都认的 INSERT。钱包 state 照 platform/worker/api/wallet.ts 的 WalletState，挑了会走到各个分支的形状：
-- 今天有计数、只有昨天（prev）有、都没有、没有 career、桌上有筹码、有管理员调整、桌上有一份是负数（监控的钱包自检要查出来）；用户 id 的大小写和字节序故意错开（COLLATE "C"）。
INSERT INTO users (id, username, display_name, friend_code, avatar_json, catchphrase_id, created_at, last_seen_at, role, presence_json, presence_at)
VALUES
  ('Ua', 'alice', '阿丽', 'F1', NULL, NULL, 1000, 5000, 'admin', '{"place":"lobby"}', 4000),
  ('ub', 'bob', '小波', 'F2', '{"face":2}', 3, 2000, 6000, 'user', '{"place":"game","game":"texas","room":"R1"}', 4500),
  ('_c', 'carol', 'Carol', 'F3', NULL, NULL, 2000, 7000, 'user', NULL, 0),
  ('Zd', 'dan', 'Dan', 'F4', NULL, NULL, 3000, 3000, 'user', NULL, 0);
INSERT INTO wallets (user_id, rev, state, updated_at) VALUES
  ('Ua', 3, '{"v":1,"balance":1200,"stakes":{"texas:r1":{"amount":300},"guandan:s":{"amount":50}},"reliefDay":"2026-10-19","today":{"day":"2026-10-20","writes":4,"grant":0,"relief":200,"admin":-50,"games":{"texas":{"in":300,"out":120,"back":0,"capped":0},"guandan":{"in":50,"out":0,"back":10,"capped":5}}},"prev":{"day":"2026-10-19","writes":1,"grant":1000,"relief":0,"games":{}},"ops":[],"expired":[],"adminLog":[{"at":4100,"amount":-50,"note":"测试","by":"alice"},{"at":3900,"amount":100,"note":"补","by":"alice"}],"career":{"texas":{"n":5,"net":-80,"wk":"2026-10-19","wnet":-80,"rounds":20,"wins":4,"best":300,"titles":{"t1":100,"t2":200},"max":{},"sum":{}},"guandan":{"n":1,"net":10,"wk":"2026-10-12","wnet":40,"rounds":1,"wins":1,"best":10,"titles":{},"max":{},"sum":{}}},"createdAt":1000}', 4100),
  ('ub', 1, '{"v":1,"balance":800,"stakes":{},"reliefDay":"","today":{"day":"2026-10-18","writes":1,"grant":1000,"relief":0,"games":{}},"prev":{"day":"2026-10-20","writes":2,"grant":0,"relief":0,"games":{"Texas":{"in":0,"out":0,"back":0,"capped":0},"mahjong":{"in":20,"out":35.5,"back":0,"capped":0}}},"ops":[],"expired":[],"career":{"mahjong":{"n":2,"net":15,"wk":"2026-10-19","wnet":15,"rounds":3,"wins":2,"best":35,"titles":{"m1":5},"max":{},"sum":{}}},"createdAt":2000}', 4200),
  ('_c', 1, '{"v":1,"balance":0,"stakes":{"x:1":{"amount":7}},"reliefDay":"","today":{"day":"2026-10-17","writes":0,"grant":0,"relief":0,"games":{}},"prev":null,"ops":[],"expired":[],"createdAt":2000}', 2000),
  ('Zd', 1, '{"v":1,"balance":5,"stakes":{"kaipan:a":{"amount":-3},"texas:b":{"amount":4}},"reliefDay":"","today":{"day":"2026-10-17","writes":0,"grant":0,"relief":0,"games":{}},"prev":null,"ops":[],"expired":[],"createdAt":3000}', 3000);
INSERT INTO friendships (user_a, user_b, status, requested_by, created_at) VALUES
  ('Ua', '_c', 'accepted', 'Ua', 10), ('Ua', 'ub', 'pending', 'ub', 11), ('Ua', 'Zd', 'pending', 'Ua', 12), ('Zd', 'ub', 'accepted', 'Zd', 13);
INSERT INTO blocks (blocker, blocked, created_at) VALUES ('Ua', 'ub', 20), ('Zd', 'Ua', 21);
INSERT INTO feed_reactions (item_id, user_id, kind, created_at) VALUES ('f1', 'Ua', 'like', 1), ('f1', 'ub', 'wow', 2), ('f2', '_c', 'like', 3), ('f3', 'Ua', 'like', 4);
INSERT INTO boards (user_id, game_id, board_id, score, updated_at) VALUES
  ('Ua', 'texas', 'week-2026-10-19', 10, 1), ('ub', 'texas', 'daily-2026-10-20', 5, 1), ('ub', 'kaipan', 'daily-2026-10-20-a', 7, 1), ('_c', 'guandan', 'week-2026-10-12', 1, 1);
INSERT INTO saves (user_id, game_id, slot, rev, data, size, updated_at) VALUES ('Ua', 'kaipan', 'main', 2, 'xx', 2, 100), ('Ua', 'texas', 'main', 1, 'yyyy', 4, 100);
INSERT INTO rate_counters (key, window_start, count, blocked_until) VALUES ('ip:1', 1000, 3, 0), ('ip:2', 1000, 9, 0), ('fail:a', 1000, 4, 0), ('fail:b', 1000, 1, 0);
INSERT INTO mates (lo, hi, game, n, lo_wins, hi_wins, team_n, team_wins, last_op, last_at) VALUES ('Ua', 'ub', 'guandan', 2, 1, 1, 1, 0, 'op1', 50);
