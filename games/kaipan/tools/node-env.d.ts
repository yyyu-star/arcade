// 项目没有安装 @types/node；tools/ 下脚本由 Node 22 直接运行（类型剥离），
// 这里只声明用到的最小 Node 全局，供 tsc 检查。若以后装了 @types/node，删除本文件。
declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode: number | undefined;
  exit(code?: number): never;
  cwd(): string;
  execPath: string;
  /** tools/shot.ts 被 timeout 停时先打出已记下的失败 */
  once(event: 'SIGTERM', fn: () => void): void;
};
// tools/sim.ts 读年度包用（与 tools/art/node-art.d.ts 里的同名声明合并）
declare module 'node:fs' {
  export function readFileSync(path: string, enc: 'utf8'): string;
}

declare module 'node:os' {
  /** 系统临时目录（截图等临时产物的默认位置，不写死 /tmp） */
  export function tmpdir(): string;
}
