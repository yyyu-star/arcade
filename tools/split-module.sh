#!/usr/bin/env bash
# 把一个模块（连同它的完整提交历史）拆成独立仓库的分支。
#   用法：tools/split-module.sh games/kaipan          → 生成本地分支 split/kaipan
#   然后：git push <新仓库地址> split/kaipan:main
# 拆出后还要做的事（都在新仓库里）：
#   1. 把本仓库 .github/workflows/<模块>.yml 复制成新仓库的 .github/workflows/deploy.yml，
#      删掉 paths、defaults.run.working-directory、check-isolation 那一步，并把路径里的模块前缀去掉；
#   2. 如果依赖了 packages/ 下的共用包（file:../../packages/xxx），改成发布后的包版本；
#   3. 新仓库的 production 环境配置 CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID、SITE_HOST（平台还要 D1_DATABASE_ID）几个 Secret；
#   4. 新仓库的 tools/verify-main.sh（如果带过去）把 TRUSTED_BASE 改成新仓库的第一个提交。
# Worker 名、存储前缀在模块自己的配置里，路由由部署流程按 SITE_HOST 注入，拆分不影响线上。
set -euo pipefail
prefix="${1:?用法：tools/split-module.sh <模块路径，如 games/kaipan>}"
prefix="${prefix%/}"
[ -f "$prefix/package.json" ] || { echo "不是模块目录：$prefix" >&2; exit 1; }
name="$(basename "$prefix")"
cd "$(git rev-parse --show-toplevel)"
git subtree split --prefix="$prefix" -b "split/$name"
echo "已生成分支 split/$name（$(git rev-list --count "split/$name") 个提交）。推到新仓库：git push <新仓库地址> split/$name:main"
