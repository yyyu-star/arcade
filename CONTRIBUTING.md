# Contributing to Arcade

Thanks for your interest! This guide covers how changes get into `main` and onto the live deployment.
Technical conventions (module independence, code style, mobile rules, testing) live in [AGENTS.md](AGENTS.md),
which applies equally to people and AI coding agents. 中文读者：本文件的要点和 AGENTS.md 一致，规范细节以 AGENTS.md 为准。

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ground rules

1. **`main` only accepts pull requests.** No direct pushes, no force pushes, no rewriting published history.
2. **Only commits merged into `main` through a pull request are deployed.** Deployment is done by GitHub Actions;
   credentials live only in the `production` environment, which only `main` can use. Never deploy production from your machine.
3. **Every pull request is fully reviewed** and needs green CI before it is merged (squash merge only).

## Workflow

1. **Branch from the latest `main`**: `git switch -c <module>/<short-description> origin/main`, e.g. `kaipan/bank-button-contrast`.
   After cloning, run `git config core.hooksPath tools/git-hooks` once — the hook blocks pushes to `main` and force pushes.
2. **One pull request changes one module** (`platform/`, `games/<id>/`, `packages/<name>/` or the repository root).
   Split cross-module work into several pull requests and state the merge order (database migrations → platform → games).
3. **Check locally**:
   - `node tools/check-isolation.mjs` at the repository root;
   - `npm ci && npm test` and the build inside the module;
   - for UI changes, run the module's smoke test and look at the screenshots yourself;
   - for game releases, bump `package.json` `version` and add a `CHANGELOG.md` entry.
4. **Open the pull request** with a title that starts with the module (`kaipan: …`, `platform: …`, `repo: …`) and fill in the template.
5. **CI must be green**: `Check isolation` plus the `test` job of the changed module's workflow (pull requests only test and build — they never deploy or see credentials).
6. **Review**: reviewers read the whole diff. Every comment is either addressed with a new commit on the same branch (no force pushes) or answered with a reason.
7. **After merge** the module's workflow deploys it. Open the live game and check the version number, the main flow and that the console has no errors.

### Commit identity

Commit author emails are public. Use your GitHub noreply address (`<id>+<username>@users.noreply.github.com`), not a personal or work email.

### Review checklist

Authors self-check and reviewers verify:

- **Complete** — version, `CHANGELOG.md`, README and the module's `AGENTS.md` are updated; new behaviour has tests; UI changes have smoke screenshots; no half-finished work or TODOs on the main path.
- **Correct** — edge and error paths (offline, 401, `busy`, timeouts, re-entry); same seed, same result; online rooms only send each player what they may see; at most 2 storage rows written per step; storage or API changes state the writes and requests per operation.
- **Independent** — `check-isolation` passes; no references to other modules; browser storage keys carry the `<id>.` prefix; assets use relative paths; the module can still be split with `tools/split-module.sh`.
- **Decoupled** — games and the platform talk only through `/api` and `packages/arcade-kit`; the kit hard-codes no game; the platform knows nothing about a game's rules or save format.
- **Efficient** — hot paths (rules, hand evaluation, AI decisions, render loops, room messages) have reasonable complexity backed by a measurement or estimate; Worker and Durable Object CPU stays around the 10 ms free-tier budget.
- **Simple** — no duplicated or dead code; reuse what exists; clear names; comments explain *why*; the diff stays within the pull request's purpose.

## Rolling back

If a deployment breaks something, open a **Revert** pull request for the offending change and merge it after a quick review; CI redeploys the previous version.
Do not push fixes straight to `main`.

## For maintainers

Repository settings, kept in sync with this section:

- **Branch protection on `main`**: pull request required, `Check isolation` must pass, no force pushes or deletion.
- **Merging**: squash merge only (the pull request title becomes the commit message); branches are deleted after merge.
- **`production` environment**: restricted to `main`. It holds `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SITE_HOST` and `D1_DATABASE_ID`.
  The hostname and database ID are secrets so they are masked in the public Actions logs; the repository itself names no domain.
- **Actions**: the default workflow token is read-only; workflows from first-time and external contributors need approval, and fork pull requests never receive secrets.
- **Secret scanning and push protection** are on.
- **Deploy guard**: before deploying, `tools/verify-main.sh` checks that every commit on `main` since `TRUSTED_BASE` is a GitHub-generated squash merge of a pull request, merged by the repository owner.
  If someone pushes to `main` directly, the `Main guard` workflow opens an issue and deploys stop. To recover: review the push (revert it if needed),
  then open a pull request that moves `TRUSTED_BASE` to the full SHA of the last direct push. If credentials may have been exposed, rotate the Cloudflare token first.
- Administrator accounts, passwords, recovery codes, `ADMIN_TOKEN` and the password pepper are never shared and never go into the repository, issues, pull requests or GitHub secrets.
