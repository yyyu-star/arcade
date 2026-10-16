/**
 * 部署到 Cloudflare Workers 用的构建：游戏挂在平台的 /games/kaipan/ 子路径下（见 arcade 仓库 docs/architecture.md）。
 *
 * 产物结构 dist-cf/games/kaipan/...，这样 Worker 静态资源能按 URL 路径直接找到文件；
 * _headers 移到 dist-cf/ 根目录并加上路径前缀，另写 _redirects 让根路径跳到游戏。
 * 本地的 npm run build / preview（4173）不受影响，仍是根路径。
 */
import { build } from 'vite';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const PREFIX = '/games/kaipan';
const ROOT = 'dist-cf';
const OUT = `${ROOT}${PREFIX}`;

rmSync(ROOT, { recursive: true, force: true });
await build({ base: `${PREFIX}/`, build: { outDir: OUT, emptyOutDir: true }, logLevel: 'warn' });

// 开发用的美术预览页不上线
rmSync(`${OUT}/art-preview.html`, { force: true });
// 0.4.0-alpha.1 美股模式的年包（带年份文件名、真实价格和化名）游戏用不到，不上线：
// 线上只放不透明 id 的行情段，免得有人拿年包对出某一段是哪一年
rmSync(`${OUT}/data/years`, { recursive: true, force: true });

const headersSrc = `${OUT}/_headers`;
if (existsSync(headersSrc)) {
  const prefixed = readFileSync(headersSrc, 'utf8')
    .split('\n')
    .map((line) => (line.startsWith('/') ? PREFIX + line : line))
    .join('\n');
  writeFileSync(`${ROOT}/_headers`, prefixed);
  rmSync(headersSrc);
}
writeFileSync(`${ROOT}/_redirects`, `/ ${PREFIX}/ 302\n${PREFIX} ${PREFIX}/ 301\n`);
console.log(`built ${OUT}`);
