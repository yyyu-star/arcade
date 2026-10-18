#!/usr/bin/env bash
# 部署前核对"这次运行的提交，对本模块来说是不是 main 上最新的"，各模块的 deploy 作业共用。
#
# 为什么：排队或等批准期间又合并了新的 PR，这次运行的提交就旧了。旧提交如果改过本模块，部署它会把线上退回旧版本。
# 原来要求"等于 main 的最新提交"，但一个模块部署途中合并别的模块（连只改文档、共用包的）也会让它失败，所有模块只能排成一队发（2026-10-18 改）。
# 现在的规则：main 的最新提交是这次提交的后代，而且从这次提交到最新提交之间，没有任何提交改过下面给的路径
# （本模块目录、本模块的部署流程、tools/）——这样这次部署出去的东西和"在最新提交上部署"完全一样，不会退回旧版本。
# tools/ 也算：deploy 作业用的是这次提交里的 tools/deployer 和 tools/workers.json，后来改过就得按新的来。
#
# 用法：tools/verify-latest.sh <sha> <路径前缀>...   需要环境变量 GH_TOKEN、REPO。
# 失败时不重跑这次运行：对 main 手动运行本模块的流程（workflow_dispatch），部署的就是最新提交（见 CONTRIBUTING.md）。
set -euo pipefail

SHA=${1:?用法：verify-latest.sh <sha> <路径前缀>...}
shift
[ "$#" -gt 0 ] || { echo "::error::至少给一个路径前缀"; exit 1; }
: "${REPO:?}" "${GH_TOKEN:?}"

head=$(gh api "repos/$REPO/git/ref/heads/main" --jq .object.sha)
if [ "$head" = "$SHA" ]; then
  echo "ok  $SHA 就是 main 的最新提交"
  exit 0
fi

# compare 的 files 最多返回 300 个；到了上限就看不全，按"可能改过"处理
read -r status files < <(gh api "repos/$REPO/compare/$SHA...$head" --jq '"\(.status) \(.files | length)"')
if [ "$status" != "ahead" ]; then
  echo "::error::main 的最新提交 $head 不是 $SHA 的后代（$status），不部署"
  exit 1
fi
if [ "$files" -ge 300 ]; then
  echo "::error::$SHA 之后改了 300 个以上文件，看不全，不部署；要部署就对 main 手动运行本流程"
  exit 1
fi

touched=$(gh api "repos/$REPO/compare/$SHA...$head" --jq '.files[].filename' | while read -r f; do
  for p in "$@"; do
    case "$f" in "$p"*) echo "$f"; break ;; esac
  done
done)
if [ -n "$touched" ]; then
  echo "::error::$SHA 之后 main 又改了本模块相关的文件，旧运行不部署；要部署就对 main 手动运行本流程。改过的："
  echo "$touched" | head -20
  exit 1
fi
echo "ok  main 已到 $head，但 $SHA 之后没改过：$*"
