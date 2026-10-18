/**
 * 发布时的 package.json 改写（0.10.0）。为什么要改写：
 * 仓库里的游戏用 `file:../../packages/arcade-kit` 引用 kit，npm 装成指向这个目录的软链，不会替它构建（npm 12 起连依赖的安装脚本都默认不跑）。
 * 所以仓库里的 package.json 的 exports 一直指向 src 的 TS 源码（和 0.9 一样，游戏 npm ci 后直接能用）；
 * 只有打包（npm pack / npm publish）的那一刻，prepack 把 exports 换成 dist 的 JS + .d.ts，postpack 再换回来。
 * npm publish 在 prepack 之后会重读 package.json，发到 registry 的元数据和 tarball 里的是同一份（dist 版）。
 *
 *   node scripts/manifest.mjs pack     改成发布版（原文先存到 package.json.orig）
 *   node scripts/manifest.mjs restore  换回原文
 *   node scripts/manifest.mjs check    不改文件：检查发布版 exports 指到的文件都在 dist 里、浏览器能用的入口 Node 原生 import 得了
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const origPath = join(root, 'package.json.orig');

/** 源码版 exports（"./x": "./src/x.ts"）→ 发布版（types + default 指到 dist） */
export function distExports(exports) {
  const out = {};
  for (const [key, target] of Object.entries(exports)) {
    const m = typeof target === 'string' ? /^\.\/src\/([\w-]+)\.ts$/.exec(target) : null;
    if (!m) throw new Error(`exports["${key}"] 应当是 "./src/<名字>.ts"，现在是 ${JSON.stringify(target)}`);
    out[key] = { types: `./dist/${m[1]}.d.ts`, default: `./dist/${m[1]}.js` };
  }
  return out;
}

const cmd = process.argv[2];
if (cmd === 'pack') {
  // 上次打包中途失败、没换回来：先换回来，免得把发布版当原文存
  if (existsSync(origPath)) renameSync(origPath, pkgPath);
  const text = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(text);
  writeFileSync(origPath, text);
  pkg.exports = distExports(pkg.exports);
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
} else if (cmd === 'restore') {
  if (existsSync(origPath)) renameSync(origPath, pkgPath);
} else if (cmd === 'check') {
  const pkg = JSON.parse(readFileSync(existsSync(origPath) ? origPath : pkgPath, 'utf8'));
  const exp = distExports(pkg.exports);
  const missing = Object.values(exp).flatMap((t) => [t.types, t.default]).filter((f) => !existsSync(join(root, f)));
  if (missing.length) throw new Error(`dist 里缺：${missing.join('、')}（先 npm run build）`);
  // 浏览器和普通 Node 测试会用的入口：Node 原生 ESM 能直接 import（相互引用带了 .js、没有 cloudflare:workers）
  for (const name of ['protocol', 'rng', 'game', 'client', 'guest', 'auth', 'fun', 'fun-logic', 'table-fun', 'share', 'social', 'chat']) {
    const t = exp[`./${name}`];
    if (t) await import(pathToFileURL(join(root, t.default)).href);
  }
  console.log(`dist ok：${Object.keys(exp).length} 个入口`);
} else {
  console.error('用法：node scripts/manifest.mjs pack|restore|check');
  process.exit(2);
}
