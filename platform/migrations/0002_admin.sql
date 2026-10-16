-- 0002：管理员。测试期是邀请制，账号由管理员建（维护者 2026-10-14 定）。
-- role 只有 user、admin 两种；不建索引：只有管理接口按它查，人数很少，全表扫比每次插入多写一行索引划算（7.2 的写入行数不变）。
-- 管理员只能用管理命令行工具（Bearer 令牌）创建，没有改角色的接口。
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));
