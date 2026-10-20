#!/usr/bin/env bash
# 打自托管的发布包：生成发布目录（build.mjs），放进 workerd 二进制和启动脚本，打成 arcade-<版本>.tar.gz。
# 服务器上解开就能跑，不装 Node（Node 只在这台打包的机器上用）。
# 用法（仓库根）：tools/selfhost/release.sh <产物目录> <输出目录> [build.mjs 的其他参数，比如 --only arcade,texas --storage memory]
# 之前要：tools/selfhost/pack-all.sh <产物目录>；npm ci --ignore-scripts --prefix tools/deployer；packages/arcade-host 里 npm ci && npm run build。
set -euo pipefail
artifacts=${1:?用法：tools/selfhost/release.sh <产物目录> <输出目录> [build.mjs 的参数]}
outdir=${2:?用法：tools/selfhost/release.sh <产物目录> <输出目录> [build.mjs 的参数]}
shift 2
root=$(cd "$(dirname "$0")/../.." && pwd)
version=${ARCADE_VERSION:-$(git -C "$root" describe --always --dirty)-$(date -u +%Y%m%d%H%M%S)}
mkdir -p "$outdir"
outdir=$(cd "$outdir" && pwd)
dir="$outdir/arcade-$version"
node "$root/tools/selfhost/build.mjs" --artifacts "$artifacts" --out "$dir" --version "$version" "$@"
mkdir -p "$dir/bin"
# workerd 用 packages/arcade-host 钉死的那一版（package-lock.json），本包的测试就是拿它跑的
workerd=$(cd "$root/packages/arcade-host" && node -e 'import("workerd").then((m) => console.log(m.default.default ?? m.default))')
cp "$workerd" "$dir/bin/workerd"
cp "$root/tools/selfhost/arcade.sh" "$dir/bin/arcade"
chmod 755 "$dir/bin/workerd" "$dir/bin/arcade"
# 运维脚本和模板跟着发布包走：服务器上不用拉仓库（不要 Node，只要 bash、curl、tar）
mkdir -p "$dir/ops/systemd"
for f in backup.sh restore.sh restore-drill.sh upgrade.sh rollback.sh install.sh Caddyfile; do cp "$root/tools/selfhost/$f" "$dir/ops/"; done
cp "$root/tools/selfhost/systemd/arcade.service" "$dir/ops/systemd/"
tar -C "$outdir" -czf "$outdir/arcade-$version.tar.gz" "arcade-$version"
echo "release：$outdir/arcade-$version.tar.gz"
