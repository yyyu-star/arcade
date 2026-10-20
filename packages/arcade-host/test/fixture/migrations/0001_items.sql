-- 测试库：带 UNIQUE、BLOB 和中文注释（迁移文件走 embed，不进 capnp 字符串）
CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, data BLOB);
CREATE INDEX items_name ON items (name);
