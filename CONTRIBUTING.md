# Contributing to Arcade

Thanks for your interest! This guide covers how changes get into `main` and onto the live deployment.
Technical conventions (module independence, code style, mobile rules, testing) live in [AGENTS.md](AGENTS.md),
which applies equally to people and AI coding agents. 中文读者：本文件的要点和 AGENTS.md 一致，规范细节以 AGENTS.md 为准。

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ground rules

1. **`main` only accepts pull requests.** No direct pushes, no force pushes, no rewriting published history.
2. **Only commits merged into `main` through a pull request are deployed.** Deployment is done by GitHub Actions;
   credentials live only in the `production` environment, which only `main` can use and which runs only after a maintainer approves it.
   Never deploy production from your machine.
3. **Every pull request is fully reviewed** and needs green CI before a maintainer merges it (squash merge only). Nothing is merged automatically.

## How the project works

```
you (fork) ──PR──▶ automated reviewer ──▶ CI ──▶ maintainer review ──▶ squash merge ──▶ build ──▶ maintainer approves ──▶ deploy ──▶ live site
                        │                                                                         (production environment)
                        └─▶ needs-maintainer: platform, shared kit, tooling, build config, new games
```

- **Anyone can contribute** through a fork and a pull request. You never need Cloudflare credentials:
  develop locally (`npm run dev`, the fake wallet in `arcade-kit/testing`), and the deploy workflow publishes after merge.
- **An automated reviewer** (an AI agent) patrols open pull requests on a schedule. It pre-checks the red lines, approves CI runs for forks,
  reviews the whole diff against [docs/review-policy.md](docs/review-policy.md), comments with concrete change requests, labels the pull request
  and notifies the maintainer. It **never merges and never approves a deployment**; its token has no Deployments, Environments, Secrets or
  Administration permission. It never touches credentials or repository settings, and it never edits your code.
- **Maintainers** re-check every reviewed pull request and merge it, approve every production deployment, and personally review what the reviewer
  escalates (`needs-maintainer`): changes to `platform/`, `packages/`, `.github/`, `tools/`, root documents, a module's `package.json`, lockfile,
  build/test configuration, scripts, hidden files or wrangler configuration, wallet/stake rules, migrations, and every **new game**
  (registering its Worker name, deploy workflow and lobby entry). Publishing to Cloudflare is done only by maintainers.
- **Game code is security-sensitive.** Games share the site with the platform, so a game's browser code can call the platform's `/api` as the
  signed-in player. Reviewers treat it as code that can reach player accounts.
- **Want to add a game?** Read [docs/new-game.md](docs/new-game.md) first (in Chinese) and open an issue with the game id you want.

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
5. **CI must be green**: `Check isolation` (module isolation + deploy configuration check) plus the `test` job of the changed module's workflow (pull requests only test, build and package — they never deploy or see credentials).
6. **Review**: reviewers read the whole diff. Every comment is either addressed with a new commit on the same branch (no force pushes) or answered with a reason.
   A maintainer re-checks the diff and the review, then merges.
7. **After merge** the module's workflow builds the bundle; its deploy job waits until a maintainer approves the `production` environment.
   After the deploy, open the live game and check the version number, the main flow and that the console has no errors.

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

If a deployment breaks something, open a **Revert** pull request for the offending change; a maintainer merges it after a quick review and approves the deploy, which redeploys the previous version.
Do not push fixes straight to `main`.

## For maintainers

Repository settings, kept in sync with this section:

- **Branch protection on `main`**: pull request required, `Check isolation` must pass, no force pushes or deletion.
- **Merging**: squash merge only (the pull request title becomes the commit message); branches are deleted after merge.
- **`production` environment**: restricted to `main`, with **required reviewers = the repository owner** (administrators cannot bypass it).
  Every deploy job stops in *waiting* until a maintainer reviews the run and approves it in Actions — check that the run belongs to the merge
  you expect (commit, workflow, module) before approving. Only the latest commit on `main` is deployed: if another pull request was merged while a run
  was queued or waiting, that run fails its "latest commit" step; do not re-run old runs — start the module's workflow on `main` manually
  (*Run workflow*), which deploys the current head. It holds `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SITE_HOST` and `D1_DATABASE_ID`.
  The hostname and database ID are secrets so they are masked in the public Actions logs; the repository itself names no domain.
- **Merging and publishing are maintainer-only.** The automated reviewer never merges and never approves deployments; its token has no
  Deployments, Environments, Secrets or Administration permission.
- **Actions**: the default workflow token is read-only; workflows from first-time and external contributors need approval, and fork pull requests never receive secrets.
- **Secret scanning and push protection** are on.
- **Build and deploy are separate jobs.** The `test` job runs the module's code (install, tests, build, `wrangler deploy --dry-run --outdir`)
  without any secret and uploads the bundle and static assets as an artifact. The `deploy` job (production environment) never checks out or runs
  module code: it sparse-checks-out `tools/` plus the module's `wrangler.jsonc` (and the platform's `migrations/`), installs the pinned wrangler from
  `tools/deployer/` with `npm ci --ignore-scripts`, and runs `tools/deployer/deploy.mjs`. That script treats the artifact as data, parses the reviewed
  `wrangler.jsonc` with the pinned wrangler's own parser, checks it against the allowlist in `tools/deployer/lib.mjs`, generates the final config,
  re-checks it and deploys with `--no-bundle` from an empty directory, `--env-file /dev/null`, a minimal environment and a fixed
  `CLOUDFLARE_API_BASE_URL`. Do not add caches, `npm ci` of module code or extra `wrangler` commands to deploy jobs.
- **Deploy configuration check** (`tools/check-deploy-config.mjs`, on every pull request; `deploy.mjs` checks again before every deploy): modules may not
  contain `.env*`, `.npmrc`, `wrangler.json`, `wrangler.toml`, `.wrangler/`, unlisted hidden files or symlinks; each module's `wrangler.jsonc` may only
  deploy to its own Worker — named after the module and listed in `tools/workers.json` — with no routes, domains, account ids, limits, log
  destinations or resources beyond the per-key allowlisted bindings, and Durable Object migrations may only create classes.
  `vars` names and `compatibility_flags` must be listed per module in `tools/deploy-allowlist.json`; the platform's secret names and `SITE_ORIGIN` are never allowed as `vars`.
  Only maintainers add names to `tools/workers.json` (after checking that no Worker with that name already exists in the account) and to `tools/deploy-allowlist.json`.
- **Standalone game configs, platform overlay**: a game's `wrangler.jsonc` is a standalone config that deploys without the platform (no service bindings,
  no `GATE`, `workers_dev` may be on). Which games connect to the platform is declared by maintainers in `tools/workers.json`
  (`"<id>": { "platform": ["ARCADE", "WALLET"] }`); `deploy.mjs` then adds the canonical `ARCADE` / `WALLET` bindings (shapes fixed in
  `tools/deployer/lib.mjs`, `props.game` = the game's id), forces `vars.GATE = "login"` and `workers_dev` / `preview_urls = false`, and re-checks the result.
  A module may still spell out these bindings during the transition, but only in exactly the canonical form; any other service binding is rejected.
- **Publishing `arcade-kit` to npm** (package name `@yyyu-star/arcade-kit`; the npm token only covers that scope): only a maintainer publishes, from their own machine, from a merge commit on `main` — the npm token never goes into
  GitHub. `git switch --detach origin/main && cd packages/arcade-kit && npm ci && npm test && npm publish` (the version must be the one in its
  `package.json` / `CHANGELOG.md`, merged through a kit pull request). Then verify in an empty directory with `npm i arcade-kit@npm:@yyyu-star/arcade-kit@<version>`.
  Games install it under the alias `arcade-kit` (`"arcade-kit": "npm:@yyyu-star/arcade-kit@^0.10.1"`), so their `arcade-kit/...` imports stay unchanged.
  Games move to a new kit version through their own pull requests; `pkg-arcade-kit.yml` already runs every game's tests against the packed kit.
- **Pinned tooling**: third-party actions are pinned to full commit SHAs, and the deployer's wrangler version is fixed in `tools/deployer/` (upgrade steps in
  [tools/deployer/README.md](tools/deployer/README.md)). Pull requests that touch `tools/` or `.github/workflows/` also run the whole deploy path for one game
  with `deploy.mjs --dry-run` (no credentials) in `Check isolation`.
- **Residual risk**: the deploy token is account-wide. The safest setup is a separate Cloudflare account (with its own domain) for this project;
  that is the repository owner's call. See [docs/review-policy.md](docs/review-policy.md) section 7.
- **Deploy guard**: before deploying, `tools/verify-main.sh` checks that every commit on `main` since `TRUSTED_BASE` is a GitHub-generated squash merge of a pull request, merged by the repository owner.
  If someone pushes to `main` directly, the `Main guard` workflow opens an issue and deploys stop. To recover: review the push (revert it if needed),
  then open a pull request that moves `TRUSTED_BASE` to the full SHA of the last direct push. If credentials may have been exposed, rotate the Cloudflare token first.
- Administrator accounts, passwords, recovery codes, `ADMIN_TOKEN` and the password pepper are never shared and never go into the repository, issues, pull requests or GitHub secrets.
