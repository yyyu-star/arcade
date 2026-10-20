// cron-entry.ts 引用的 ./main.js 是模块自己打好的入口，由生成器放进同一个 Worker（打包时是外部模块）；这里只给类型
declare const entry: unknown;
export default entry;
