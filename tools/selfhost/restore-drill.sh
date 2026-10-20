#!/usr/bin/env bash
# 恢复演练：拿一份备份，在临时端口和空的临时数据目录上起同一个发布包，导入后再导出，必须和备份逐字节一样（每张表、每一行）；
# 打印每张表的行数，演练完停掉、删掉临时目录。不碰正在跑的站点。服务器上只要 bash、curl（不要 Node）。
# 用法：tools/selfhost/restore-drill.sh <发布目录，比如 /opt/arcade/current> <备份目录（backup.sh 的一个时间戳目录）>
# 端口默认 18787/18788，被占了用 DRILL_PORT、DRILL_ADMIN_PORT 改。
set -euo pipefail
release=${1:?用法：tools/selfhost/restore-drill.sh <发布目录> <备份目录>}
backup=${2:?用法：tools/selfhost/restore-drill.sh <发布目录> <备份目录>}
port=${DRILL_PORT:-18787}
aport=${DRILL_ADMIN_PORT:-18788}
tmp=$(mktemp -d "${TMPDIR:-/var/tmp}/arcade-drill-XXXXXX")
pid=
cleanup() { [ -n "$pid" ] && kill "$pid" 2>/dev/null && wait "$pid" 2>/dev/null; rm -rf "$tmp"; }
trap cleanup EXIT
ARCADE_DATA="$tmp/data" ARCADE_LISTEN="127.0.0.1:$port" ARCADE_ADMIN_LISTEN="127.0.0.1:$aport" "$release/bin/arcade" >"$tmp/workerd.log" 2>&1 &
pid=$!
for _ in $(seq 50); do curl -fsS "http://127.0.0.1:$port/__health" >/dev/null 2>&1 && break; sleep 0.2; done
curl -fsS "http://127.0.0.1:$port/__health" >/dev/null || { cat "$tmp/workerd.log" >&2; exit 1; }
ok=1
for file in "$backup"/*.sql; do
  db=$(basename "$file" .sql)
  curl -fsS -X POST --data-binary "@$file" "http://127.0.0.1:$aport/d1/$db/import" >/dev/null
  curl -fsS "http://127.0.0.1:$aport/d1/$db/export" -o "$tmp/$db.sql"
  if cmp -s "$file" "$tmp/$db.sql"; then
    echo "restore-drill：$db 导入后再导出和备份一样"
  else
    echo "restore-drill：$db 导入后再导出和备份不一样" >&2
    ok=0
  fi
  grep -o '^INSERT INTO "[^"]*"' "$file" | sort | uniq -c | sed 's/INSERT INTO //'
done
[ "$ok" = 1 ] && echo "restore-drill：通过"
