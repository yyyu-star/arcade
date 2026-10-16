/**
 * 部署配置的读取和白名单检查：PR 上的快速检查（tools/check-deploy-config.mjs）和部署前的严格检查（deploy.mjs）共用。
 *
 * 为什么要钉死 wrangler 的解析器：自己写的 JSONC 解析和 wrangler 用的 jsonc-parser 在边角上不一致（单独的 \r 也能结束 // 注释、
 * 嵌套的 "__proto__" 会被 jsonc-parser 当成原型而不是普通的键），检查看到的和真正部署的就不是同一份东西。这里一律用
 * tools/deployer 里钉死版本的 wrangler 自己的 experimental_readRawConfig 读，再额外拒掉这两类写法，让两边没有歧义。
 *
 * 白名单的思路：只放行本仓库现在真用到的字段和绑定，每种绑定逐键列出；别的（KV、R2、队列、tail_consumers、limits、
 * observability 的 destinations、DO 迁移里的 transferred/deleted/renamed_classes……）一律拒绝，真需要时由维护者放宽这里。
 * vars 名（按模块）、compatibility_flags 和全局拒绝的 vars 名单独放在 tools/deploy-allowlist.json，同样由维护者改。
 *
 * 游戏和平台的关系不由游戏自己写：模块里的 wrangler.jsonc 是能单独部署的独立配置（没有平台也能跑，kit 0.10.0 的独立模式），
 * 本站要接平台的游戏由维护者在 tools/workers.json 里声明（"platform": ["ARCADE", "WALLET"]），deploy.mjs 按声明补上规范形式的
 * 服务绑定和 GATE=login（platformOverlay）。这样游戏代码改不了自己以什么身份接平台：绑定的形状由这里写死，模块只能不写或写得一模一样。
 */
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { experimental_readRawConfig, unstable_readConfig } from 'wrangler';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKERS_FILE = join(REPO_ROOT, 'tools', 'workers.json');
/** vars 名、兼容开关的白名单和全局拒绝的 vars 名（维护者管） */
const ALLOWLIST_FILE = join(REPO_ROOT, 'tools', 'deploy-allowlist.json');

/**
 * 游戏接平台用的服务绑定，规范形式写死在这里（tools/workers.json 只写名字）。新增一种（比如平台多了一个 RPC 入口）由维护者加：
 *   ARCADE：平台默认的 fetch 入口，游戏经它问 /api/me 认人（kit 的 whoIs、loginGate、acceptCreate/acceptJoin）；
 *   WALLET：平台钱包的 RPC 入口 WalletService，props.game 固定成本游戏的 id，平台按它只让这个游戏动自己那一份（docs/platform-backend.md 5.9）。
 */
const PLATFORM_BINDINGS = {
  ARCADE: () => ({ binding: 'ARCADE', service: 'arcade' }),
  WALLET: (id) => ({ binding: 'WALLET', service: 'arcade', entrypoint: 'WalletService', props: { game: id } }),
};

/** 所有模块都可以用的顶层字段 */
const COMMON_KEYS = new Set([
  '$schema', 'name', 'main', 'compatibility_date', 'compatibility_flags', 'workers_dev', 'preview_urls',
  'assets', 'observability', 'vars', 'services', 'durable_objects', 'migrations', 'placement',
]);
/** 只有平台可以多用的字段：账号数据的 D1、每天的定时任务 */
const PLATFORM_KEYS = new Set(['d1_databases', 'triggers']);
/** 一看就知道不该出现的字段，给出具体原因（其余不认识的字段统一报"不在白名单"） */
const WHY_NOT = {
  routes: '路由由部署流程按 SITE_HOST 注入', route: '路由由部署流程按 SITE_HOST 注入',
  account_id: '账户由部署凭证决定', env: '每个模块只有一个正式 Worker，不用 wrangler 环境',
  limits: '不许改 CPU、子请求上限', tail_consumers: '不许把日志转给别的 Worker', logpush: '不许推日志',
  no_bundle: '打包方式由部署流程决定', find_additional_modules: '只上传部署流程认可的打包产物',
  rules: '只上传部署流程认可的打包产物', base_dir: '只上传部署流程认可的打包产物',
  upload_source_maps: 'source map 不上传（由部署流程关掉）',
};
/**
 * 部署流程写进最终配置、并要求 wrangler 读回来正好是这些值的打包开关（源配置里不许写，见 WHY_NOT）：
 *   no_bundle：产物已经由构建作业打好，原样上传；
 *   find_additional_modules：wrangler 4.151 在 --no-bundle 时这一项没写就默认打开（noBundleWorker 的默认参数），
 *     会把入口所在目录里按规则匹配到的 .js/.mjs/.wasm/.txt/.html/.sql 等文件全部当作附加模块上传；
 *   upload_source_maps：打开时 wrangler 会按入口末尾的 sourceMappingURL 去读文件一起上传，这个路径由不可信的构建作业决定。
 */
export const FINAL_BUNDLE_FLAGS = Object.freeze({ no_bundle: true, find_additional_modules: false, upload_source_maps: false });
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BINDING = /^[A-Z][A-Z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * tools/workers.json：允许部署的 Worker 和它们跟平台的关系（维护者管）。格式不对直接抛错，不猜。
 * 返回 Map<Worker 名, { isPlatform, platform: string[] }>，platform 是要补的平台绑定名（按 PLATFORM_BINDINGS 的顺序）。
 */
export function workerRegistry() {
  const file = JSON.parse(readFileSync(WORKERS_FILE, 'utf8'));
  const bad = (msg) => { throw new Error(`tools/workers.json：${msg}`); };
  if (!isPlainObject(file.workers)) bad('workers 必须是对象（Worker 名 → 它和平台的关系）');
  const out = new Map();
  for (const [name, w] of Object.entries(file.workers)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) bad(`Worker 名 ${JSON.stringify(name)} 不合规`);
    if (!isPlainObject(w)) bad(`${name} 必须是对象`);
    for (const k of Object.keys(w)) if (k !== 'role' && k !== 'platform') bad(`${name} 里不认识 ${k}（只许 role、platform）`);
    const isPlatform = w.role === 'platform';
    if ('role' in w && !isPlatform) bad(`${name}.role 只许 "platform"`);
    if (isPlatform !== (name === 'arcade')) bad('平台只能是 arcade，而且 arcade 必须写 "role": "platform"');
    const list = w.platform ?? [];
    if (!Array.isArray(list) || list.some((b) => !Object.hasOwn(PLATFORM_BINDINGS, b)) || new Set(list).size !== list.length) {
      bad(`${name}.platform 只许不重复的 ${Object.keys(PLATFORM_BINDINGS).join('、')}`);
    }
    if (isPlatform && list.length) bad('平台自己不接平台');
    // 钱包要先认人，kit 的 GATE=login 也要 ARCADE：声明了平台关系就一定有 ARCADE
    if (list.length && !list.includes('ARCADE')) bad(`${name}.platform 写了别的就必须有 ARCADE`);
    out.set(name, { isPlatform, platform: Object.keys(PLATFORM_BINDINGS).filter((b) => list.includes(b)) });
  }
  return out;
}

/** 声明了平台关系的游戏，最终配置里应该恰好有的服务绑定（规范形式，按 PLATFORM_BINDINGS 的顺序）；没声明的是空数组 */
export function platformServices(id) {
  return (workerRegistry().get(id)?.platform ?? []).map((b) => PLATFORM_BINDINGS[b](id));
}

/** 两个绑定是不是一模一样（键的顺序不算）。只比 JSON 能表达的值，配置本来就是 JSON */
const sameJson = (a, b) => {
  const norm = (v) => (Array.isArray(v) ? v.map(norm) : isPlainObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])) : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
};

/**
 * 本站部署时叠加在模块配置上的东西（deploy.mjs 生成最终配置用；不改入参，返回新对象）：
 *   - 所有模块：workers_dev、preview_urls 一律 false（本站只经站点域名访问，workers.dev 和预览地址都绕过网关）；
 *   - 声明了平台关系的游戏：services 换成规范形式的平台绑定，vars.GATE 盖成 "login"（kit 0.10.0：有 GATE=login 却没 ARCADE 时 fail-closed，
 *     不会退成游客模式）。模块里已经写了的绑定必须和规范形式一模一样，这一点由 checkConfig 的 source 阶段先查过。
 */
export function platformOverlay(source, id) {
  const out = { ...structuredClone(source), workers_dev: false, preview_urls: false };
  const services = platformServices(id);
  if (services.length) {
    out.services = services;
    out.vars = { ...(out.vars ?? {}), GATE: 'login' };
  }
  return out;
}

function allowlist() {
  return JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8'));
}

/** 模块路径（相对仓库根）→ { mod, id, isPlatform }；不是可部署的模块就抛错 */
export function moduleInfo(mod) {
  const m = mod.replace(/\/+$/, '');
  if (m === 'platform') return { mod: m, id: 'arcade', isPlatform: true };
  const g = /^games\/([a-z][a-z0-9-]*)$/.exec(m);
  if (g) return { mod: m, id: g[1], isPlatform: false };
  throw new Error(`${mod} 不是可部署的模块（只认 platform 和 games/<id>）`);
}

/**
 * 用钉死的 wrangler 读一份配置（.json 或 .jsonc），读之前先拒掉会让解析器之间出分歧的写法。
 * 返回 { raw, errors }：errors 非空时 raw 不可信，不要再往下用。
 */
export function readConfigStrict(file, label = file) {
  const errors = [];
  const bad = (msg) => errors.push(`${label}：${msg}`);
  if (!/\.jsonc?$/.test(file)) return { raw: null, errors: [`${label}：只认 .json / .jsonc（wrangler 碰到别的扩展名会当成空配置）`] };
  let st;
  try {
    st = lstatSync(file);
  } catch {
    return { raw: null, errors: [`${label}：文件不存在`] };
  }
  if (!st.isFile()) return { raw: null, errors: [`${label}：必须是普通文件（不能是符号链接或目录）`] };
  const text = readFileSync(file, 'utf8');
  // \r、U+2028/2029 之类的换行符在不同解析器里结束注释的规则不同；只许 \n 和 \t 这两个控制字符
  if (/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029\ufeff]/.test(text)) bad('只许用 \\n 换行（不能有 \\r、U+2028/2029、BOM 或别的控制字符）');
  if (/__proto__|\\u/.test(text)) bad('不许出现 "__proto__" 和 \\u 转义（会被解析成原型或绕过键名检查）');
  if (errors.length) return { raw: null, errors };
  let raw;
  try {
    raw = experimental_readRawConfig({ config: file }).rawConfig;
  } catch (e) {
    return { raw: null, errors: [`${label}：wrangler 解析不了：${e.message}`] };
  }
  if (!isPlainObject(raw)) return { raw: null, errors: [`${label}：顶层必须是对象`] };
  // 任何层级：对象的原型必须是普通对象，键名不能是 __proto__ / constructor / prototype
  const walk = (v, path) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (v === null || typeof v !== 'object') return;
    if (Object.getPrototypeOf(v) !== Object.prototype) bad(`${path} 的原型被改过（"__proto__" 之类的键）`);
    for (const k of Object.keys(v)) {
      if (DANGEROUS_KEYS.has(k)) bad(`${path} 里不许有键 ${k}`);
      walk(v[k], `${path}.${k}`);
    }
  };
  walk(raw, '配置');
  return { raw: errors.length ? null : raw, errors };
}

/**
 * 按白名单检查一份已读出的配置。
 *   stage = 'source'：仓库里模块根目录的 wrangler.jsonc；路径相对 baseDir（模块目录）解析，必须留在模块里；
 *   stage = 'final' ：部署流程生成的最终配置；main、assets.directory、migrations_dir 必须正好等于 expect 里给的绝对路径，
 *                     D1 必须带上正式库的 id；workers_dev 必须是 false；声明了平台关系的游戏必须恰好有那几个绑定、GATE=login。
 * 游戏的源配置是独立配置：可以不写服务绑定和 GATE、workers_dev 可以是 true（单独部署要 workers.dev 地址），由部署流程补齐、关掉。
 */
export function checkConfig(c, { mod, id, isPlatform, stage, baseDir, label, expect = {} }) {
  const errors = [];
  const bad = (msg) => errors.push(`${label}：${msg}`);
  const insideBase = (p) => {
    if (typeof p !== 'string' || !p) return false;
    const abs = resolve(baseDir, p);
    return abs === baseDir || abs.startsWith(baseDir + sep);
  };
  const onlyKeys = (obj, allowed, where) => {
    if (!isPlainObject(obj)) return bad(`${where} 必须是对象`), false;
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) bad(`${where} 里不许有 ${k}（只许 ${allowed.join('、')}）`);
    return true;
  };

  // —— 顶层字段 ——
  for (const key of Object.keys(c)) {
    if (COMMON_KEYS.has(key) || (isPlatform && PLATFORM_KEYS.has(key))) continue;
    if (stage === 'final' && key in FINAL_BUNDLE_FLAGS) continue;
    if (key === '$schema' && stage === 'final') continue;
    bad(`不许用 ${key}（${WHY_NOT[key] ?? '不在 tools/deployer/lib.mjs 的白名单里；确实需要时由维护者放宽'}）`);
  }
  if (stage === 'final' && '$schema' in c) bad('最终配置里不该有 $schema');
  if (stage === 'final') {
    for (const [k, v] of Object.entries(FINAL_BUNDLE_FLAGS)) if (c[k] !== v) bad(`${k} 必须是 ${v}，现在是 ${JSON.stringify(c[k])}`);
  }
  const allow = allowlist();

  if (c.name !== id) bad(`name 必须是 "${id}"（模块 id），现在是 ${JSON.stringify(c.name)}`);
  let registry;
  try {
    registry = workerRegistry();
  } catch (e) {
    return [...errors, `${label}：${e.message}`];
  }
  const declared = registry.get(id);
  if (!declared) bad(`Worker "${id}" 不在 tools/workers.json 的名单里：新 Worker 由维护者确认账户里没有同名的之后再加`);
  else if (declared.isPlatform !== Boolean(isPlatform)) bad(`tools/workers.json 里 ${id} 的 role 和模块对不上`);
  const linked = (declared?.platform ?? []).map((b) => PLATFORM_BINDINGS[b](id));
  // 游戏的源配置可以开 workers.dev（单独部署用），本站部署时由 platformOverlay 关掉；平台和最终配置必须是 false
  if (stage === 'source' && !isPlatform) {
    if ('workers_dev' in c && typeof c.workers_dev !== 'boolean') bad('workers_dev 必须是布尔');
  } else if (c.workers_dev !== false) bad('workers_dev 必须写成 false（只经站点的域名访问）');
  if (c.preview_urls !== false) bad('preview_urls 必须写成 false（预览地址绕过网关）');
  if (typeof c.compatibility_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.compatibility_date)) bad('compatibility_date 必须是 YYYY-MM-DD');
  // 兼容开关会改变运行时的行为（比如 nodejs_compat 打开 Node API），只许名单里的
  if ('compatibility_flags' in c) {
    if (!Array.isArray(c.compatibility_flags)) bad('compatibility_flags 必须是数组');
    else for (const f of c.compatibility_flags) {
      if (!allow.compatibility_flags.includes(f)) {
        bad(`compatibility_flags 里的 ${JSON.stringify(f)} 不在 tools/deploy-allowlist.json 的名单里（现在只许 ${allow.compatibility_flags.join('、') || '不写'}；新增由维护者加）`);
      }
    }
  }
  if ('$schema' in c && typeof c.$schema !== 'string') bad('$schema 必须是字符串');

  // —— main：入口必须在模块（最终配置：打包产物）里 ——
  if (stage === 'source') {
    if (!insideBase(c.main)) bad(`main 必须是模块目录里的相对路径，现在是 ${JSON.stringify(c.main)}`);
  } else if (c.main !== expect.main) bad(`main 必须是打包产物 ${expect.main}，现在是 ${JSON.stringify(c.main)}`);

  // —— 静态资源 ——
  if ('assets' in c && onlyKeys(c.assets, ['directory', 'binding', 'not_found_handling', 'html_handling', 'run_worker_first'], 'assets')) {
    const a = c.assets;
    if (stage === 'source') {
      if (!insideBase(a.directory) || resolve(baseDir, a.directory) === baseDir) bad(`assets.directory 必须是模块目录里的子目录，现在是 ${JSON.stringify(a.directory)}`);
    } else if (a.directory !== expect.assets) bad(`assets.directory 必须是 ${expect.assets}，现在是 ${JSON.stringify(a.directory)}`);
    if ('binding' in a && !(typeof a.binding === 'string' && BINDING.test(a.binding))) bad('assets.binding 必须是大写标识符');
    if ('not_found_handling' in a && !['none', 'single-page-application', '404-page'].includes(a.not_found_handling)) bad('assets.not_found_handling 取值不对');
    if ('html_handling' in a && !['auto-trailing-slash', 'force-trailing-slash', 'drop-trailing-slash', 'none'].includes(a.html_handling)) bad('assets.html_handling 取值不对');
    if ('run_worker_first' in a && !(typeof a.run_worker_first === 'boolean' || (Array.isArray(a.run_worker_first) && a.run_worker_first.every((r) => typeof r === 'string')))) {
      bad('assets.run_worker_first 必须是布尔或字符串数组');
    }
  } else if (stage === 'final' && expect.assets && !('assets' in c)) bad('最终配置缺 assets');

  // —— 日志：只许开关和采样率，不许 destinations（会把日志发到别处） ——
  if ('observability' in c && onlyKeys(c.observability, ['enabled', 'head_sampling_rate', 'logs', 'traces'], 'observability')) {
    const o = c.observability;
    if ('enabled' in o && typeof o.enabled !== 'boolean') bad('observability.enabled 必须是布尔');
    for (const sub of ['logs', 'traces']) {
      if (sub in o && onlyKeys(o[sub], ['enabled', 'head_sampling_rate', 'invocation_logs'], `observability.${sub}`)) {
        for (const [k, v] of Object.entries(o[sub])) {
          if (k === 'head_sampling_rate' ? typeof v !== 'number' : k !== 'destinations' && typeof v !== 'boolean') bad(`observability.${sub}.${k} 类型不对`);
        }
      }
    }
    if ('head_sampling_rate' in o && typeof o.head_sampling_rate !== 'number') bad('observability.head_sampling_rate 必须是数字');
  }

  // —— 环境变量：只许名单里的名字，值是普通的 JSON 值。平台的 Secret 名和 SITE_ORIGIN 任何模块都不许写：
  //    vars 和 Secret 同名时会互相覆盖（比如写一个 ADMIN_TOKEN 把正式的令牌换成已知值），SITE_ORIGIN 只由部署流程注入 ——
  if ('vars' in c && isPlainObject(c.vars)) {
    const names = Object.hasOwn(allow.vars, id) ? [...allow.vars[id]] : [];
    // 接平台的游戏最终一定有 GATE（部署流程加的），名单里没列也放行
    if (stage === 'final' && linked.length && !names.includes('GATE')) names.push('GATE');
    for (const [k, v] of Object.entries(c.vars)) {
      if (k === 'SITE_ORIGIN') bad('vars 里不许写 SITE_ORIGIN：正式站的地址由部署流程注入');
      else if (allow.forbiddenVars.includes(k)) bad(`vars 里不许写 ${k}：它是平台的 Secret 名，同名的 vars 会顶替 Secret`);
      else if (!names.includes(k)) bad(`vars.${k} 不在 tools/deploy-allowlist.json 里 ${id} 的名单（现在只许 ${names.join('、') || '没有'}；新增由维护者加）`);
      if (!['string', 'number', 'boolean'].includes(typeof v) && !isPlainObject(v)) bad(`vars.${k} 只许字符串、数字、布尔或对象`);
    }
  } else if ('vars' in c) bad('vars 必须是对象');
  // GATE=login 一定要有 ARCADE：kit 在这种情况下 fail-closed，整个游戏都进不去
  if (!isPlatform && !linked.some((s) => s.binding === 'ARCADE') && isPlainObject(c.vars) && c.vars.GATE === 'login') {
    bad('vars.GATE 是 "login"，但 tools/workers.json 没给它声明 ARCADE：没有平台时 kit 会拒绝所有人');
  }
  if (stage === 'final' && linked.length && c.vars?.GATE !== 'login') bad('接平台的游戏最终配置里 vars.GATE 必须是 "login"');

  // —— 服务绑定：只许 tools/workers.json 给这个游戏声明的平台绑定，而且必须和规范形式（PLATFORM_BINDINGS）一模一样；
  //    钱包的 props.game 也在规范形式里，游戏冒充不了别的游戏。源配置可以不写（独立配置），最终配置必须恰好是声明的那几个 ——
  if ('services' in c) {
    if (isPlatform) bad('平台不许有服务绑定');
    else if (!Array.isArray(c.services)) bad('services 必须是数组');
    else {
      const seen = new Set();
      for (const [i, s] of c.services.entries()) {
        const where = `services[${i}]`;
        const name = isPlainObject(s) ? s.binding : undefined;
        const want = linked.find((w) => w.binding === name);
        if (!want) bad(`${where}（${JSON.stringify(name)}）不是 tools/workers.json 给 ${id} 声明的平台绑定（现在声明的：${linked.map((w) => w.binding).join('、') || '没有'}；服务绑定只由维护者在那里声明）`);
        else if (!sameJson(s, want)) bad(`${where}（${name}）必须和规范形式完全一样：${JSON.stringify(want)}，现在是 ${JSON.stringify(s)}（也可以不写，部署时补）`);
        else if (seen.has(name)) bad(`${where}：${name} 写了两次`);
        seen.add(name);
      }
      if (stage === 'final' && seen.size !== linked.length) bad(`最终配置的服务绑定必须恰好是 ${linked.map((w) => w.binding).join('、')}`);
    }
  } else if (stage === 'final' && linked.length) bad(`最终配置缺服务绑定 ${linked.map((w) => w.binding).join('、')}`);

  // —— Durable Object：只许本 Worker 自己的类 ——
  if ('durable_objects' in c && onlyKeys(c.durable_objects, ['bindings'], 'durable_objects')) {
    const list = c.durable_objects.bindings;
    if (!Array.isArray(list)) bad('durable_objects.bindings 必须是数组');
    else for (const [i, d] of list.entries()) {
      if (!onlyKeys(d, ['name', 'class_name'], `durable_objects.bindings[${i}]`)) continue;
      if (!(typeof d.name === 'string' && BINDING.test(d.name))) bad(`durable_objects.bindings[${i}].name 必须是大写标识符`);
      if (!(typeof d.class_name === 'string' && IDENT.test(d.class_name))) bad(`durable_objects.bindings[${i}].class_name 必须是标识符`);
    }
  }

  // —— DO 迁移：只许新建类。transferred_classes 能把别的 Worker 的 DO 连数据搬过来，deleted/renamed 会清掉或改掉数据 ——
  if ('migrations' in c) {
    if (!Array.isArray(c.migrations)) bad('migrations 必须是数组');
    else for (const [i, m] of c.migrations.entries()) {
      if (!onlyKeys(m, ['tag', 'new_classes', 'new_sqlite_classes'], `migrations[${i}]`)) continue;
      if (typeof m.tag !== 'string' || !m.tag) bad(`migrations[${i}].tag 必须是非空字符串`);
      for (const k of ['new_classes', 'new_sqlite_classes']) {
        if (k in m && !(Array.isArray(m[k]) && m[k].every((x) => typeof x === 'string' && IDENT.test(x)))) bad(`migrations[${i}].${k} 必须是类名数组`);
      }
    }
  }

  if ('placement' in c && onlyKeys(c.placement, ['mode'], 'placement') && !['smart', 'off'].includes(c.placement.mode)) bad('placement.mode 只许 smart 或 off');

  // —— 平台：一个 D1、一个定时任务 ——
  if ('d1_databases' in c) {
    const dbs = c.d1_databases;
    const keys = stage === 'final' ? ['binding', 'database_name', 'database_id', 'migrations_dir'] : ['binding', 'database_name', 'migrations_dir'];
    if (!Array.isArray(dbs) || dbs.length !== 1) bad('平台只许有一个 D1');
    else if (onlyKeys(dbs[0], keys, 'd1_databases[0]')) {
      const d = dbs[0];
      if (d.binding !== 'DB' || d.database_name !== 'arcade') bad('D1 只许绑定 DB、库名 arcade');
      if (stage === 'source') {
        if ('database_id' in d) bad('不许写 database_id：正式库的 id 由部署流程注入');
        if (!insideBase(d.migrations_dir ?? 'migrations')) bad('d1_databases[0].migrations_dir 必须在模块目录里');
      } else {
        if (!UUID.test(d.database_id ?? '')) bad('最终配置的 D1 必须带正式库的 id（UUID）');
        if (d.migrations_dir !== expect.migrations) bad(`d1_databases[0].migrations_dir 必须是 ${expect.migrations}`);
      }
    }
  }
  if ('triggers' in c && onlyKeys(c.triggers, ['crons'], 'triggers')) {
    if (!(Array.isArray(c.triggers.crons) && c.triggers.crons.every((x) => typeof x === 'string'))) bad('triggers.crons 必须是字符串数组');
  }
  return errors;
}

/**
 * 最终配置再过一遍 wrangler 自己的规范化（unstable_readConfig），确认 wrangler 眼里的配置和白名单看到的一致：
 * 没有被重定向、没有路由、只有放行的那几类绑定。
 */
export function checkNormalized(file, { id, isPlatform, label }) {
  const errors = [];
  const bad = (msg) => errors.push(`${label}（wrangler 规范化后）：${msg}`);
  let n;
  try {
    n = unstable_readConfig({ config: file }, { hideWarnings: true });
  } catch (e) {
    return [`${label}：wrangler 读不通：${e.message}`];
  }
  if (n.name !== id) bad(`name 是 ${JSON.stringify(n.name)}`);
  if (n.configPath !== file) bad(`wrangler 读的是 ${n.configPath}，不是 ${file}`);
  for (const [k, v] of Object.entries(FINAL_BUNDLE_FLAGS)) if (n[k] !== v) bad(`${k} 是 ${JSON.stringify(n[k])}，必须是 ${v}`);
  if (n.route || n.routes?.length) bad('不该有路由');
  if (n.workers_dev !== false || n.preview_urls !== false) bad('workers_dev / preview_urls 必须是 false');
  // 声明了平台关系的游戏：wrangler 眼里也恰好是这几个绑定、GATE=login（规范形式的逐键比较在 checkConfig 里做过）
  const linked = isPlatform ? [] : platformServices(id);
  const got = (n.services ?? []).map((s) => `${s.binding}:${s.service}:${s.entrypoint ?? ''}:${JSON.stringify(s.props ?? null)}`).sort();
  const want = linked.map((s) => `${s.binding}:${s.service}:${s.entrypoint ?? ''}:${JSON.stringify(s.props ?? null)}`).sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) bad(`服务绑定是 ${JSON.stringify(got)}，应该是 ${JSON.stringify(want)}`);
  if (linked.length && n.vars?.GATE !== 'login') bad('vars.GATE 必须是 "login"');
  if (n.durable_objects?.bindings?.some((d) => d.script_name || d.environment)) bad('Durable Object 指向了别的 Worker');
  if (n.services?.some((s) => s.service !== 'arcade' || s.environment)) bad('服务绑定指向了别的 Worker');
  if (n.migrations?.some((m) => m.renamed_classes?.length || m.deleted_classes?.length || m.transferred_classes?.length)) bad('DO 迁移里有改名、删除或转移');
  if (n.tail_consumers?.length || n.streaming_tail_consumers?.length || n.logpush) bad('不许转发日志');
  if (n.observability?.destinations?.length || n.observability?.logs?.destinations?.length || n.observability?.traces?.destinations?.length) bad('不许把日志发到别处');
  // 不该出现的绑定类型：规范化后它们都是空数组/空对象
  const allowedArrays = new Set(['services', 'migrations', 'compatibility_flags', ...(isPlatform ? ['d1_databases'] : [])]);
  for (const [k, v] of Object.entries(n)) {
    if (Array.isArray(v) && v.length && !allowedArrays.has(k) && !['routes'].includes(k)) bad(`${k} 不该有内容`);
  }
  if (!isPlatform && n.d1_databases?.length) bad('游戏不许绑 D1');
  return errors;
}

/** 模块根目录的 wrangler.jsonc：读 + 白名单（PR 检查和部署共用） */
export function checkSourceConfig(file, info) {
  const label = `${info.mod}/wrangler.jsonc`;
  const { raw, errors } = readConfigStrict(file, label);
  if (!raw) return { raw: null, errors };
  return { raw, errors: checkConfig(raw, { ...info, stage: 'source', baseDir: dirname(resolve(file)), label }) };
}

