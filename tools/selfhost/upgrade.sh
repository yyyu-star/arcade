#!/usr/bin/env bash
# 升级（也是第一次安装之后的每次发布）：解开发布包 → 先备份 → 换 current 软链接 → 重启 → 等健康检查；起不来自动切回原来的版本。
# 客户端会自动重连，房间在磁盘上，重启期间在打的牌局不丢。迁移只加不删，所以回滚到旧版本代码也认新的库。
# 用法（root）：/opt/arcade/current/ops/upgrade.sh <arcade-版本.tar.gz>（发布包的 ops/ 里带着这些脚本；第一次装用 install.sh）
set -euo pipefail
tarball=${1:?用法：upgrade.sh <arcade-版本.tar.gz>}
base=${ARCADE_HOME:-/opt/arcade}
backups=${ARCADE_BACKUPS:-/var/lib/arcade/backups}
name=$(tar -tzf "$tarball" | sed -n '1s#/.*##p')  # sed 读完全部输入：head 提前关管道，pipefail 下 tar 的 SIGPIPE 会让脚本退出
[[ "$name" == arcade-* ]] || { echo "upgrade：$tarball 不像发布包" >&2; exit 1; }
mkdir -p "$base/releases"
[ -e "$base/releases/$name" ] && { echo "upgrade：$name 已经装过（回滚用 rollback.sh）" >&2; exit 1; }
tar -C "$base/releases" -xzf "$tarball"
here=$(cd "$(dirname "$0")" && pwd)
prev=$(readlink "$base/current" 2>/dev/null || true)
if [ -n "$prev" ] && systemctl is-active --quiet arcade; then
  "$here/backup.sh" "$backups"
fi
switch() { ln -sfn "$1" "$base/current.tmp" && mv -T "$base/current.tmp" "$base/current"; }
healthy() {
  for _ in $(seq 60); do curl -fsS http://127.0.0.1:8787/__health >/dev/null 2>&1 && return 0; sleep 0.5; done
  return 1
}
old_previous=$(readlink "$base/previous" 2>/dev/null || true)
# 记下原来的版本，rollback.sh 不带参数时切回它
[ -n "$prev" ] && ln -sfn "$prev" "$base/previous"
switch "$base/releases/$name"
systemctl restart arcade
if healthy; then
  echo "upgrade：现在是 $name（原来是 ${prev:-无}）"
  exit 0
fi
echo "upgrade：$name 起不来（journalctl -u arcade 看原因）" >&2
if [ -n "$prev" ]; then
  # 切回去，"上一个版本"的记录也恢复原样；没起来的那个版本删掉，修好后可以用同一个包名再装
  switch "$prev"
  if [ -n "$old_previous" ]; then ln -sfn "$old_previous" "$base/previous"; else rm -f "$base/previous"; fi
  systemctl restart arcade
  rm -rf "${base:?}/releases/$name"
  if healthy; then echo "upgrade：已切回 $prev" >&2; else echo "upgrade：切回 $prev 也没起来，赶紧看 journalctl -u arcade" >&2; fi
fi
exit 1
