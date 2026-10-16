// 项目没有安装 @types/node；tools/ 下脚本由 Node 22 直接运行（类型剥离），这里只声明用到的最小 Node 全局，供 tsc 检查。
// （与 tools/art-env.d.ts 里的 node:fs 声明合并）
declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode: number | undefined;
  exit(code?: number): never;
  cwd(): string;
  stdout: { write(s: string): boolean };
};
declare module 'node:perf_hooks' {
  export const performance: { now(): number };
}
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, enc: 'utf8'): string;
  export function rmSync(path: string, opts?: { recursive?: boolean; force?: boolean }): void;
  export function readdirSync(path: string): string[];
}
declare module 'node:os' {
  export function tmpdir(): string;
  export function cpus(): unknown[];
}
declare module 'node:fs' {
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
}
