# Security Policy

## Supported versions

Only the latest commit on `main` is supported. Each module (platform and every game) is deployed from `main`,
so fixes ship as soon as they are merged.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub: **Security → Advisories → [Report a vulnerability](https://github.com/yyyu-star/arcade/security/advisories/new)**.
Include the affected module (`platform/`, `games/<id>/` or `packages/arcade-kit/`), steps to reproduce and the impact you expect.

We aim to acknowledge reports within 7 days and to keep you updated until the issue is resolved.
Reports are especially welcome for:

- account, session or password handling in `platform/worker`;
- anything that lets a player see another player's hidden information (cards, tiles) in an online room;
- ways to change wallet balances other than by playing (chips have no cash value, but the rules should still hold);
- bypassing the per-user and per-room rate limits.

## 安全问题报告（中文）

请不要公开提 issue。在 GitHub 的 **Security → Advisories → Report a vulnerability** 私下报告，写明涉及的模块、复现步骤和影响。
