/**
 * 联机页面的版本号：房间低于 minClientVersion 的页面会被 4005 关掉、提示刷新（arcade-kit 协议）。
 * 改了房间和页面之间的约定（NetAction / NetView 的含义）就加一，并把 worker/room.ts 的 minClientVersion 跟上。
 */
// 2（0.3.0）：页面认得额度的几种拒绝（开房 409/429/503 JSON、进房 4503、4000 带 quota 收场）；旧页面会被请去刷新
// 3（0.5.0）：视图里有实盘房间每个座位的账（NetView.stake），一场打完房间就结束；旧页面认不得，会被请去刷新
export const CLIENT_VERSION = 3;

/** 房间接口的路径前缀（游戏 Worker 里，run_worker_first 放行这一段） */
export const ROOM_PATH = '/games/guandan/room';

/**
 * 单机实盘接口的路径前缀（游戏 Worker 里，run_worker_first 放行这一段；worker/stake.ts）。
 * 放在 /api/ 下面：网关的限速规则（每 IP 每 10 秒 60 次）只认 /api/*、/games/* 下含 /room/ 或 /rooms、/games/* 下含 /api/ 的路径
 */
export const STAKE_PATH = '/games/guandan/api/stake';
