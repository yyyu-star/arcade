#!/usr/bin/env bash
# 把各模块打成部署作业收的那种产物（和 platform.yml、game-<id>.yml 的 test 作业同样的几步）：
#   npm ci → 构建（平台 npm run build，游戏 npm run build:cf）→ wrangler deploy --dry-run --outdir → tools/deployer/pack.mjs
# 用法（仓库根）：tools/selfhost/pack-all.sh <产物目录> [Worker 名 ...]（不写名字就打 tools/workers.json 里的全部）
# 产物目录下每个 Worker 一个子目录（平台是 arcade/），交给 tools/selfhost/build.mjs。不跑模块的测试（各模块的 CI 跑过）。
set -euo pipefail
out=${1:?用法：tools/selfhost/pack-all.sh <产物目录> [Worker 名 ...]}
shift
root=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$out"
out=$(cd "$out" && pwd)
if [ $# -eq 0 ]; then
  mapfile -t names < <(node -e 'console.log(Object.keys(require(process.argv[1]).workers).join("\n"))' "$root/tools/workers.json")
else
  names=("$@")
fi
for name in "${names[@]}"; do
  if [ "$name" = arcade ]; then mod=platform; build=build; else mod=games/$name; build=build:cf; fi
  echo "::group::打包 $name（$mod）"
  rm -rf "${out:?}/$name"
  (
    cd "$root/$mod"
    npm ci --no-audit --no-fund
    npm run "$build" --if-present
    npx wrangler deploy --dry-run -c wrangler.jsonc --outdir "$out/$name/worker"
    node "$root/tools/deployer/pack.mjs" "$out/$name"
  )
  echo "::endgroup::"
done
