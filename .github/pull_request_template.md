<!--
Title starts with the module, e.g. "kaipan: fix empty row in the monthly bill" or "repo: …".
One PR changes one module; split cross-module work and state the merge order.
标题以模块名开头，例如「kaipan: 修复月账单空行」「repo: …」。一个 PR 只改一个模块；跨模块的改动拆开，并写明合并顺序。
-->

## What and why / 改了什么、为什么

## Related issue / 关联 issue

Fixes #… / 无

## Module and version / 模块与版本

- Module: platform / games/<id> / packages/<name> / repository
- Version and CHANGELOG: bumped to x.y.z / not needed (docs, tests or tooling only)

## Verification / 验证

- [ ] `node tools/check-isolation.mjs` passes at the repository root
- [ ] `npm test` and the build pass in the module (commands and results below)
- [ ] UI changes: screenshots (desktop 1280×720 and phone landscape), zero console errors
- [ ] Docs, README and the module's `AGENTS.md` updated where behaviour changed
- [ ] Balance or AI changes: simulator / bot results attached

## Notes for reviewers / 审阅备注
