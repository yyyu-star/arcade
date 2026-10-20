#!/usr/bin/env bash
# 打自托管的发布包：生成发布目录（build.mjs），放进 workerd 二进制和启动脚本，打成 arcade-<版本>.tar.gz。
# 服务器上解开就能跑，不装 Node（Node 只在这台打包的机器上用）。
# 用法（仓库根）：tools/selfhost/release.sh <产物目录> <输出目录> [--with-pg] [build.mjs 的其他参数，比如 --only arcade,texas --db pg]
# --with-pg：同一个包里再带一份 PG 档的配置（pg/ 子目录，平台库放 PostgreSQL、房间仍落盘），启动时 ARCADE_DB=pg 用它；发布的镜像就是这样打的。
# 之前要：tools/selfhost/pack-all.sh <产物目录>；npm ci --ignore-scripts --prefix tools/deployer；packages/arcade-host 里 npm ci && npm run build。
set -euo pipefail
artifacts=${1:?用法：tools/selfhost/release.sh <产物目录> <输出目录> [build.mjs 的参数]}
outdir=${2:?用法：tools/selfhost/release.sh <产物目录> <输出目录> [build.mjs 的参数]}
shift 2
with_pg=
args=()
for a in "$@"; do
  if [ "$a" = --with-pg ]; then with_pg=1; else args+=("$a"); fi
done
root=$(cd "$(dirname "$0")/../.." && pwd)
version=${ARCADE_VERSION:-$(git -C "$root" describe --always --dirty)-$(date -u +%Y%m%d%H%M%S)}
mkdir -p "$outdir"
outdir=$(cd "$outdir" && pwd)
dir="$outdir/arcade-$version"
node "$root/tools/selfhost/build.mjs" --artifacts "$artifacts" --out "$dir" --version "$version" ${args[@]+"${args[@]}"}
if [ -n "$with_pg" ]; then
  # 配置、运行时、各模块的包按 PG 档再生成一份（几 MB）；workerd 二进制和运维脚本共用顶层的
  node "$root/tools/selfhost/build.mjs" --artifacts "$artifacts" --out "$dir/pg" --version "$version" --db pg ${args[@]+"${args[@]}"}
fi
mkdir -p "$dir/bin"
# workerd 用 packages/arcade-host 钉死的那一版（package-lock.json），本包的测试就是拿它跑的
workerd=$(cd "$root/packages/arcade-host" && node -e 'import("workerd").then((m) => console.log(m.default.default ?? m.default))')
cp "$workerd" "$dir/bin/workerd"
cp "$root/tools/selfhost/arcade.sh" "$dir/bin/arcade"
chmod 755 "$dir/bin/workerd" "$dir/bin/arcade"
# 运维脚本和模板跟着发布包走：服务器上不用拉仓库（不要 Node，只要 bash、curl、tar）
mkdir -p "$dir/ops/systemd"
for f in backup.sh restore.sh restore-drill.sh upgrade.sh rollback.sh install.sh create-admin.sh; do cp "$root/tools/selfhost/$f" "$dir/ops/"; done
cp "$root/tools/selfhost/docker/Caddyfile" "$dir/ops/"
cp "$root/tools/selfhost/systemd/arcade.service" "$dir/ops/systemd/"
tar -C "$outdir" -czf "$outdir/arcade-$version.tar.gz" "arcade-$version"
echo "release：$outdir/arcade-$version.tar.gz"
