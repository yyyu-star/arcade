#!/usr/bin/env node
/**
 * 部署配置的快速检查（PR 上必跑，check.yml）。部署前的严格检查在 tools/deployer/deploy.mjs，两边共用 tools/deployer/lib.mjs 的白名单。
 *
 * 部署凭证是整个 Cloudflare 账户级的，同一个账户下还有和本仓库无关的 Worker、域名和数据。这个检查在合并前就拦下：
 *   1. 模块里（platform/、games/*、packages/*）被 Git 管理的文件中不许有：
 *      - wrangler.json、wrangler.toml、.wrangler/：wrangler 找配置时会优先用它们，或者用 .wrangler/deploy/config.json 重定向；
 *      - .env*、.npmrc 以及名单以外的任何隐藏文件：wrangler 每条命令都会读当前目录的 .env（能改 CLOUDFLARE_API_BASE_URL，
 *        把令牌发给别人），.npmrc 能换掉装包的源；
 *      - 符号链接：能让检查看到的和实际读到的不是同一个文件；
 *   2. 每个可部署模块根目录的 wrangler.jsonc 用钉死版本的 wrangler 解析，按白名单检查（Worker 名 = 模块 id 且在 tools/workers.json、
 *      只许本模块自己的 DO、指向 arcade 的服务绑定、平台自己的 D1，迁移只许新建类，不许路由、limits、日志外发……，细则见 lib.mjs）。
 *      还没有 wrangler.jsonc 的游戏（设计、规则核心阶段）跳过。
 * 只查模块根目录的 wrangler.jsonc（部署用的那一份）；test/ 等目录下给本地测试用的配置不部署，不查（新增要维护者审，见 docs/review-policy.md）。
 *
 * 用法：node tools/check-deploy-config.mjs [模块路径…]   不给就查全部；在仓库根目录执行，有违规时退出码 1。
 * 先装好钉死的 wrangler：npm ci --ignore-scripts --prefix tools/deployer
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(join(ROOT, 'tools', 'deployer', 'node_modules', 'wrangler'))) {
  console.error('部署配置检查要用 tools/deployer 里钉死的 wrangler，先执行：npm ci --ignore-scripts --prefix tools/deployer');
  process.exit(1);
}
const { checkSourceConfig, moduleInfo } = await import('./deployer/lib.mjs');

/** 模块里允许的隐藏文件（按文件名）。新增要维护者改这里，见 docs/review-policy.md 的红线 */
const ALLOWED_HIDDEN = new Set(['.gitignore', '.nvmrc', '.dev.vars.example']);

function allModules() {
  const out = ['platform'];
  for (const group of ['games', 'packages']) {
    const dir = join(ROOT, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) if (statSync(join(dir, name)).isDirectory()) out.push(`${group}/${name}`);
  }
  return out;
}

/** git ls-files -s：模式 + 路径（只看被 Git 管理的文件，本机的 node_modules、dist 不算） */
function trackedFiles(mod) {
  const out = execFileSync('git', ['ls-files', '-s', '-z', '--', mod], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean).map((line) => {
    const [meta, path] = line.split('\t');
    return { mode: meta.split(' ')[0], path };
  });
}

function checkFiles(mod) {
  const errors = [];
  for (const { mode, path } of trackedFiles(mod)) {
    const parts = relative(mod, path).split('/');
    const name = parts.at(-1);
    if (mode === '120000') errors.push(`${path}：模块里不许有符号链接`);
    if (name === 'wrangler.json' || name === 'wrangler.toml') errors.push(`${path}：不许有 ${name}（wrangler 会优先用它，部署配置只认模块根目录的 wrangler.jsonc）`);
    if (parts.includes('.wrangler')) errors.push(`${path}：不许提交 .wrangler/（.wrangler/deploy/config.json 能把 wrangler 重定向到别的配置）`);
    const hidden = parts.find((p) => p.startsWith('.'));
    if (hidden && hidden !== '.wrangler') {
      if (/^\.env/.test(hidden)) errors.push(`${path}：不许提交 .env 类文件（wrangler 会读它，能改掉 API 地址把令牌发给别人）`);
      else if (hidden === '.npmrc') errors.push(`${path}：不许提交 .npmrc（能换掉装包的源）`);
      else if (!(hidden === name && ALLOWED_HIDDEN.has(name))) errors.push(`${path}：模块里只许有这些隐藏文件：${[...ALLOWED_HIDDEN].join('、')}（新增要维护者审）`);
    }
  }
  return errors;
}

const targets = process.argv.length > 2 ? process.argv.slice(2).map((m) => relative(ROOT, resolve(m))) : allModules();
const errors = [];
const checked = [];
for (const mod of targets) {
  errors.push(...checkFiles(mod));
  if (mod.startsWith('packages/')) continue; // 共用包不部署，只查文件
  let info;
  try {
    info = moduleInfo(mod);
  } catch {
    errors.push(`${mod}：不是合规的模块路径（可部署的只有 platform 和 games/<id>，id 只许小写字母开头的小写字母、数字和 -，它同时是 Worker 名和存储前缀）`);
    continue;
  }
  const file = join(ROOT, mod, 'wrangler.jsonc');
  if (!existsSync(file)) {
    if (info.isPlatform) errors.push('platform：没有 wrangler.jsonc');
    else console.log(`${mod}：还没有 wrangler.jsonc（不部署），跳过`);
    continue;
  }
  errors.push(...checkSourceConfig(file, info).errors);
  checked.push(mod);
}
if (errors.length) {
  console.error(`部署配置检查没过：\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`部署配置检查通过：${checked.join('、') || '（没有可部署的模块）'}`);
