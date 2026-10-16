/** 命令行参数的小工具：smoke 和 capture 共用，`--名字 值` 取值，没给就用默认 */
export const args = process.argv.slice(2);
export const opt = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : def;
};
