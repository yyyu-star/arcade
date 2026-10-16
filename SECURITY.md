# Security Policy

## Supported versions

Only the latest commit on `main` is supported. Each module (platform and every game) is deployed from `main`,
so fixes ship as soon as they are merged. Old versions, forks and self-hosted deployments are not patched by us;
if you run your own copy, update it from `main`.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub: **Security → Advisories → [Report a vulnerability](https://github.com/yyyu-star/arcade/security/advisories/new)**.
Include the affected module (`platform/`, `games/<id>/` or `packages/arcade-kit/`), steps to reproduce and the impact you expect.

Do not include real credentials, other players' personal data or a working exploit against a live deployment in the report; a minimal reproduction against a local copy is best.

We aim to acknowledge reports within 7 days and to keep you updated until the issue is resolved.
Reports are especially welcome for:

- account, session or password handling in `platform/worker`;
- anything that lets a player see another player's hidden information (cards, tiles) in an online room;
- ways to change wallet balances other than by playing (chips have no cash value, but the rules should still hold);
- bypassing the per-user and per-room rate limits.

Out of scope: findings that need a compromised device or browser, missing best-practice headers without a demonstrated impact,
volumetric denial of service, social engineering, and the fact that chips are play money with no cash value.

## 安全问题报告（中文）

请不要公开提 issue。在 GitHub 的 **Security → Advisories → Report a vulnerability** 私下报告，写明涉及的模块、复现步骤和影响。

只支持 `main` 上的最新提交；fork 和自己部署的副本请自行从 `main` 更新。报告里不要附真实凭证、其他玩家的个人信息，或针对线上部署的可用攻击代码，最好给本机复现步骤。我们争取 7 天内回复。
