/**
 * 掼蛋 Worker 的部署入口（wrangler.jsonc 的 main）。
 * Workers 运行时会把入口模块的每个具名导出都当成入口：Durable Object 类必须从这里具名导出（Room、快速匹配的排队 Queue、计量 RoomMeter，对应 durable_objects 的 class_name），
 * 除此之外不能再有别的具名导出（导出常量、函数会启动失败）。请求处理在 index.ts 的默认导出。
 */
export { default } from './index.ts';
export { Room } from './room.ts';
export { Queue } from './match.ts';
export { RoomMeter } from 'arcade-kit/meter';
