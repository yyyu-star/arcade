#!/usr/bin/env bash
# 回滚：current 切回指定的版本（不写就是装上去的前一个），重启。库不回滚：迁移只加不删，旧代码认新的库；
# 要连数据一起回到某个时间点，另用 restore.sh 导入那时的备份。
# 用法（root）：/opt/arcade/current/ops/rollback.sh [arcade-版本]（不写就切回上次升级前的版本，upgrade.sh 记在 /opt/arcade/previous）
set -euo pipefail
base=${ARCADE_HOME:-/opt/arcade}
cur=$(basename "$(readlink "$base/current")")
if [ $# -ge 1 ]; then
  target=$1
else
  target=$(basename "$(readlink "$base/previous" 2>/dev/null)" 2>/dev/null || true)
fi
[ -n "$target" ] && [ -d "$base/releases/$target" ] || { echo "rollback：没有可回滚的版本" >&2; exit 1; }
[ "$target" = "$cur" ] && { echo "rollback：已经是 $target" >&2; exit 1; }
ln -sfn "$base/releases/$cur" "$base/previous"
ln -sfn "$base/releases/$target" "$base/current.tmp" && mv -T "$base/current.tmp" "$base/current"
systemctl restart arcade
for _ in $(seq 60); do curl -fsS http://127.0.0.1:8787/__health >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS http://127.0.0.1:8787/__health >/dev/null && echo "rollback：$cur → $target"
