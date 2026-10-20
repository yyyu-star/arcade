-- PG 版（和 ../migrations/0001_items.sql 一一对应）
CREATE TABLE items (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, data BYTEA);
CREATE INDEX items_name ON items (name);
