#!/usr/bin/env bash
# 核对 main 上一段历史是否全部"经 PR 合并、由仓库所有者合并"，部署流程和 main-guard 共用。
#
# GitHub 的分支保护（2026-10-16 起）已经要求 main 只经 PR 合并，但管理员可以绕过；部署前再自己核对一遍：从上一次 main-guard 通过的提交
# （没有就用 TRUSTED_BASE）沿 first-parent 走到要部署的提交，每一个都必须满足：
#   1. 是某个已合并进 main 的 PR 的合并提交（merge_commit_sha 等于它，且不是 PR 分支自己的提交——
#      防止把 PR 的头提交直接快进推到 main，GitHub 会把这种 PR 也标成已合并）；
#   2. 由 GitHub 生成（committer 是 web-flow 且签名有效），不是本地造的；
#   3. 合并人是仓库所有者。
# 只看最新提交不够：带 [skip ci] 直接推进 main 的提交不会触发任何检查，会被下一次正常合并一起带上线。
#
# 用法：tools/verify-main.sh <sha>     需要环境变量 GH_TOKEN、REPO、OWNER；需要完整历史（checkout 时 fetch-depth: 0）。
# 局限：有推送权限的人直接推 main 时可以连同本脚本和 workflow 一起改掉，彻底解决要靠 GitHub 规则集（见 CONTRIBUTING.md）。
set -euo pipefail

# 可信起点：它及之前的历史视为已确认。初值是公开仓库的起点提交（2026-10-16；之前的历史没有公开，旧私有仓库已删除，所有者留有离线备份）。
# 有人直接推过 main 时，那个提交会永远留在历史里，之后每次核对都会卡在它上面：所有者确认（必要时先 revert）后，
# 开 PR 把这里改成那个提交（或之后的某个提交）的完整 SHA，合并后核对从这里开始，部署恢复。
TRUSTED_BASE=2c2b905a67d2443fd6db04f2080d838018dff9e8

SHA=${1:?用法：verify-main.sh <sha>}
: "${REPO:?}" "${OWNER:?}" "${GH_TOKEN:?}"

# 从哪里开始核对：最近一次 main-guard 通过、且是 SHA 祖先的提交
stop=""
for s in $(gh api "repos/$REPO/actions/workflows/main-guard.yml/runs?branch=main&event=push&status=success&per_page=30" \
             --jq '.workflow_runs[].head_sha' 2>/dev/null || true); do
  [ "$s" = "$SHA" ] && continue
  if git merge-base --is-ancestor "$s" "$SHA" 2>/dev/null; then stop=$s; break; fi
done
# 没有可用的守卫记录，或可信起点比它更新（所有者前移过），就从可信起点开始
if [ -z "$stop" ] || git merge-base --is-ancestor "$stop" "$TRUSTED_BASE" 2>/dev/null; then stop=$TRUSTED_BASE; fi
git merge-base --is-ancestor "$stop" "$SHA" || { echo "::error::$stop 不是 $SHA 的祖先，main 的历史被改写过"; exit 1; }

commits=$(git rev-list --first-parent "$stop..$SHA")
bad=0
for c in $commits; do
  # 刚合并时 GitHub 关联 PR 偶尔有几秒延迟，查不到就重试几次
  pr=""
  for i in 1 2 3 4; do
    pr=$(gh api "repos/$REPO/commits/$c/pulls" \
          | jq -r --arg c "$c" '[.[] | select(.merged_at != null and .base.ref == "main" and .merge_commit_sha == $c and .head.sha != $c)][0].number // empty')
    [ -n "$pr" ] && break
    sleep 10
  done
  if [ -z "$pr" ]; then
    echo "::error::$c 不是任何已合并 PR 的合并提交（直接推送？）"; bad=1; continue
  fi
  read -r committer verified < <(gh api "repos/$REPO/commits/$c" --jq '"\(.committer.login // "none") \(.commit.verification.verified)"')
  merged_by=$(gh api "repos/$REPO/pulls/$pr" --jq '.merged_by.login // "none"')
  if [ "$committer" != "web-flow" ] || [ "$verified" != "true" ]; then
    echo "::error::$c（PR #$pr）不是 GitHub 生成的合并提交（committer=$committer verified=$verified）"; bad=1
  elif [ "$merged_by" != "$OWNER" ]; then
    echo "::error::$c（PR #$pr）由 $merged_by 合并，只有 $OWNER 可以合并"; bad=1
  else
    echo "ok  $c  PR #$pr  merged_by=$merged_by"
  fi
done
exit $bad
