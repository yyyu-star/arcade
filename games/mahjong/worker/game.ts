/**
 * 游戏 id（平台钱包按它记账、单独部署时站点根转到 /games/<id>/）。
 * 不放在入口 main.ts 里导出：workerd 把入口模块的每个具名导出都当成入口（Worker 或 Durable Object 类），导出字符串常量会起不来。
 */
export const GAME = 'mahjong' as const;
