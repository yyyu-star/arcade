#!/usr/bin/env node
/**
 * 部署配置检查（CI 必跑：每个 PR 跑一次，每次正式部署前再跑一次）。
 *
 * 部署凭证是整个 Cloudflare 账户级的，同一个账户下还有和本仓库无关的 Worker、域名和数据。这个检查保证合进 main 的配置
 * 只能部署到本仓库自己的 Worker 上、只用本仓库自己的资源，不会碰到账户里别的东西：
 *   1. Worker 名必须等于模块 id（平台是 arcade），而且在 tools/workers.json 的名单里——名单只由维护者改，
 *      新游戏的名字由维护者先确认账户里没有同名的 Worker 再加进去，免得部署时覆盖掉别人的 Worker；
 *   2. 不许在配置里写路由、自定义域名、账户 id、wrangler 环境（env）：路由和域名只由部署流程按 SITE_HOST 注入；
 *   3. 只许用下面列出的字段和绑定：静态资源、本模块自己的 Durable Object、指向平台 arcade 的服务绑定、平台自己的 D1；
 *      KV、R2、队列、别的 Worker 的 Durable Object 之类一律不许（真需要时由维护者放宽这里）；
 *   4. 钱包服务绑定的 props.game 必须是模块自己的 id，不能冒充别的游戏记账。
 * 只查各模块根目录的 wrangler.jsonc（部署用的那一份）；test/ 下的测试配置不部署，不查。
 *
 * 用法：node tools/check-deploy-config.mjs [模块路径…]   不给就查全部；在仓库根目录执行，有违规时退出码 1
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const ALLOWED_WORKERS = JSON.parse(readFileSync(join(ROOT, 'tools', 'workers.json'), 'utf8')).workers;

/** 所有模块都可以用的顶层字段 */
const COMMON_KEYS = new Set([
  '$schema', 'name', 'main', 'compatibility_date', 'compatibility_flags', 'workers_dev', 'preview_urls',
  'assets', 'observability', 'vars', 'services', 'durable_objects', 'migrations', 'limits', 'placement',
]);
/** 只有平台可以多用的字段：账号数据的 D1、每天的定时任务 */
const PLATFORM_KEYS = new Set(['d1_databases', 'triggers']);

/** 去掉 JSONC 的注释和结尾多余的逗号（字符串里的不动） */
function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
      if (i === 0) throw new Error('有没闭合的注释');
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function modules() {
  const out = ['platform'];
  for (const name of readdirSync(join(ROOT, 'games'))) if (statSync(join(ROOT, 'games', name)).isDirectory()) out.push(`games/${name}`);
  return out;
}

function check(mod) {
  const errors = [];
  const file = join(ROOT, mod, 'wrangler.jsonc');
  if (!existsSync(file)) return [`${mod}：没有 wrangler.jsonc`];
  let c;
  try {
    c = parseJsonc(readFileSync(file, 'utf8'));
  } catch (e) {
    return [`${mod}/wrangler.jsonc 解析不了：${e.message}`];
  }
  const isPlatform = mod === 'platform';
  const id = isPlatform ? 'arcade' : mod.split('/')[1];
  const bad = (msg) => errors.push(`${mod}/wrangler.jsonc：${msg}`);

  if (c.name !== id) bad(`name 必须是 "${id}"（模块 id），现在是 ${JSON.stringify(c.name)}`);
  if (!ALLOWED_WORKERS.includes(id)) bad(`Worker "${id}" 不在 tools/workers.json 的名单里：新 Worker 由维护者确认账户里没有同名的之后再加`);
  if (c.workers_dev !== false) bad('workers_dev 必须是 false（只经站点的域名访问）');
  if (c.preview_urls === true) bad('preview_urls 不能打开');

  for (const key of Object.keys(c)) {
    if (COMMON_KEYS.has(key) || (isPlatform && PLATFORM_KEYS.has(key))) continue;
    if (key === 'routes' || key === 'route') bad(`不许写 ${key}：路由由部署流程按 SITE_HOST 注入`);
    else if (key === 'account_id') bad('不许写 account_id：账户由部署凭证决定');
    else if (key === 'env') bad('不许用 wrangler 环境（env）：每个模块只有一个正式 Worker');
    else bad(`不许用 ${key}（只许用 tools/check-deploy-config.mjs 里列出的字段；确实需要时由维护者放宽）`);
  }

  if (c.vars && Object.hasOwn(c.vars, 'SITE_ORIGIN')) bad('vars 里不许写 SITE_ORIGIN：正式站的地址由部署流程注入');

  for (const s of c.services ?? []) {
    if (s.service !== 'arcade') bad(`服务绑定 ${s.binding} 只能指向平台 arcade，现在指向 ${JSON.stringify(s.service)}`);
    if (s.props && Object.hasOwn(s.props, 'game') && s.props.game !== id) bad(`服务绑定 ${s.binding} 的 props.game 必须是 "${id}"`);
    if (s.entrypoint === 'WalletService' && !s.props?.game) bad(`钱包绑定 ${s.binding} 必须带 props.game = "${id}"`);
  }
  for (const d of c.durable_objects?.bindings ?? []) {
    if (d.script_name) bad(`Durable Object ${d.name} 不许指向别的 Worker（script_name）`);
  }
  for (const d of c.d1_databases ?? []) {
    if (d.binding !== 'DB' || d.database_name !== 'arcade') bad('平台只许有一个 D1：绑定 DB、库名 arcade');
    if (d.database_id) bad('不许写 database_id：正式库的 id 由部署流程注入');
  }
  for (const cron of c.triggers?.crons ?? []) if (typeof cron !== 'string') bad('triggers.crons 写法不对');
  if (c.triggers && Object.keys(c.triggers).some((k) => k !== 'crons')) bad('triggers 只许有 crons');
  return errors;
}

const targets = process.argv.length > 2 ? process.argv.slice(2).map((m) => relative(ROOT, resolve(m))) : modules();
const errors = targets.flatMap(check);
if (errors.length) {
  console.error(`部署配置检查没过：\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`部署配置检查通过：${targets.join('、')}`);
