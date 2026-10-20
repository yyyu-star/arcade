#!/usr/bin/env bash
# 逻辑备份：经内部管理入口把每个 D1 库导出成 SQL（和 wrangler d1 export 同样的格式），另外给房间的数据目录打一个快照。
# 用法：tools/selfhost/backup.sh <备份目录> [管理入口，默认 http://127.0.0.1:8788] [数据目录，默认 /var/lib/arcade/data]
# 每晚跑一次（systemd timer 或 cron），备份目录再传到异地。库是 MB 级，导出一次几十毫秒，不用停服。
# 房间的快照是尽力而为：在打的房间可能正在写（SQLite WAL），恢复后最坏丢那一步；房间本来就是临时数据，钱包在平台库里。
set -euo pipefail
dest=${1:?用法：tools/selfhost/backup.sh <备份目录> [管理入口] [数据目录]}
admin=${2:-http://127.0.0.1:8788}
data=${3:-/var/lib/arcade/data}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dir="$dest/$stamp"
mkdir -p "$dir"
for db in $(curl -fsS "$admin/d1" | tr -d '[]"' | tr ',' ' '); do
  curl -fsS "$admin/d1/$db/export" -o "$dir/$db.sql"
  grep -q '^CREATE TABLE d1_migrations' "$dir/$db.sql" || { echo "backup：$db 的导出不完整" >&2; exit 1; }
done
if [ -d "$data" ]; then
  # D1 库自己就在数据目录里（d1-*），已经逻辑导出过；快照只要房间那些
  tar -C "$data" --exclude='./d1-*' -czf "$dir/rooms.tar.gz" .
fi
echo "backup：$dir"
ls -l "$dir"
