/**
 * v3 美术生成入口。
 *
 *   node tools/art/build.ts            生成全部（public/assets/art/v3/** 与 public/art-preview.html）
 *   node tools/art/build.ts stocks     只生成某几组：stocks scene chat avatars badges fx misc preview
 *
 * 所有素材都是确定性的：同样的源码与 stocks.json 永远输出同样的文件。
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resetIds } from './lib/svg.ts';
import { buildStock, type StockSpec } from './stocks.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
export const OUT = `${ROOT}public/assets/art/v3/`;

const written = new Set<string>();

function write(rel: string, data: string): void {
  const p = OUT + rel;
  mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true });
  // 内容没变就不写：Vite 开发服务器靠文件监听维护 public/ 清单，少触发事件更稳
  let old: string | null = null;
  try {
    old = readFileSync(p, 'utf8');
  } catch {
    old = null;
  }
  if (old !== data) writeFileSync(p, data);
  written.add(rel);
}

/** 删除某个子目录下本次没有生成的旧文件（不整目录删除，避免和 Vite 的文件监听赛跑） */
function pruneStale(sub: string): number {
  let n = 0;
  let list: string[] = [];
  try {
    list = readdirSync(OUT + sub, { recursive: true }) as string[];
  } catch {
    return 0;
  }
  for (const f of list) {
    const rel = `${sub}/${f}`;
    if (!rel.endsWith('.svg') && !rel.endsWith('.json')) continue;
    if (!written.has(rel)) {
      rmSync(OUT + rel, { force: true });
      n++;
    }
  }
  return n;
}

interface StockSource {
  canvas: number;
  ground: number;
  roles: Record<string, { name: string; accessory: string; shape: string }>;
  stocks: StockSpec[];
}

export function loadStockSource(): StockSource {
  return JSON.parse(readFileSync(new URL('./stocks.json', import.meta.url).pathname, 'utf8')) as StockSource;
}

async function buildStocks(): Promise<number> {
  const src = loadStockSource();
  let n = 0;
  const list: Record<string, unknown>[] = [];
  for (const spec of src.stocks) {
    const out = buildStock(spec);
    for (const [rel, svg] of out.files) {
      write(`stocks/${rel}`, svg);
      n++;
    }
    list.push(out.manifest);
  }
  const manifest = {
    $comment: '由 tools/art/build.ts 根据 tools/art/stocks.json 生成，不要手改。坐标单位为 128×128 画布像素。',
    canvas: src.canvas,
    ground: src.ground,
    expressions: ['calm', 'happy', 'limitup', 'worried', 'limitdown', 'delisted'],
    blink: '<id>/blink.svg：与 calm 同画布、完全对齐的闭眼帧（墨镜款为镜片反光），待机时 calm↔blink 短暂切换',
    roles: src.roles,
    stocks: list,
  };
  write('stocks/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  const stale = pruneStale('stocks');
  if (stale) console.log(`stocks: removed ${stale} stale files`);
  return n + 1;
}

type Task = () => Promise<number> | number;

const TASKS: Record<string, Task> = {
  stocks: buildStocks,
};

async function main(): Promise<void> {
  // 其余分组按需加载，避免互相依赖
  const extra: [string, string][] = [
    ['scene', './scene.ts'],
    ['chat', './chat.ts'],
    ['avatars', './avatars.ts'],
    ['badges', './badges.ts'],
    ['fx', './fx.ts'],
    ['misc', './misc.ts'],
    ['items', './items.ts'],
    ['personas', './personas.ts'],
    ['progress', './progress.ts'],
    ['keyart', './keyart.ts'],
    ['friendly', './friendly.ts'],
    ['glyphs', './glyphs.ts'],
    ['preview', './preview.ts'],
  ];
  const want = process.argv.slice(2);
  const names = want.length ? want : ['stocks', ...extra.map(([n]) => n)];
  for (const name of names) {
    let task = TASKS[name];
    if (!task) {
      const mod = extra.find(([n]) => n === name);
      if (!mod) throw new Error(`unknown group ${name}`);
      const m = (await import(mod[1])) as { build: (w: typeof write) => number | Promise<number> };
      task = () => m.build(write);
    }
    const t0 = Date.now();
    resetIds();
    const n = await task();
    console.log(`${name.padEnd(8)} ${String(n).padStart(4)} files  ${Date.now() - t0} ms`);
  }
}

await main();
