/**
 * 生成 src/core/dirs.ts：256 个方向的单位向量，写成源码里的常数。
 * 规则核心不许用 Math.cos/sin（引擎可以近似实现，各浏览器可能差最后一位），所以在这里用 Node 算一次、按 17 位有效数字写死，
 * 之后所有浏览器、Worker 读到的都是同一串常数。改了就重跑：node tools/gen-dirs.ts
 */
import { writeFileSync } from 'node:fs';

const N = 256;
const num = (v: number): string => {
  const s = Number(v.toPrecision(17)).toString();
  return s === '-0' ? '0' : s;
};
const cos: string[] = [];
const sin: string[] = [];
for (let i = 0; i < N; i++) {
  const a = (i / N) * Math.PI * 2;
  // 正好落在轴上的几项写成精确值，免得 6.1e-17 这种尾巴
  cos.push(i === N / 4 || i === (3 * N) / 4 ? '0' : num(Math.cos(a)));
  sin.push(i % 128 === 0 ? '0' : num(Math.sin(a)));
}
const out = `// 由 tools/gen-dirs.ts 生成，不要手改。
/**
 * 256 个方向的单位向量（第 i 个是角度 i × 2π / 256，0 朝右、64 朝下：屏幕坐标 y 向下）。
 * 写死成常数：规则核心不许调用 Math.cos/sin（DESIGN.md 5.1）。摇杆的 32 向是其中每隔 8 个取一个。
 */
export const DIR_N = ${N};
export const COS: readonly number[] = [${cos.join(', ')}];
export const SIN: readonly number[] = [${sin.join(', ')}];
`;
writeFileSync(new URL('../src/core/dirs.ts', import.meta.url), out);
console.log('写好了 src/core/dirs.ts');
