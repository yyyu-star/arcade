/**
 * 钱包操作 id（平台按它去重：同一个 id 重发只办一次）。单机和好友房各一套，永远撞不上：
 * - 单机：浏览器给的 op 由 Worker 加 `solo-` 前缀再交钱包（已经带了就不再加）。不加的话，浏览器可以照着好友房的 id 造一个，
 *   让平台当成"已经办过"直接回成功，借去重白拿（审计高危）；
 * - 好友房：`<ref>-<id>`，ref 是 `r` 开头的房间号（`src/room/rules.ts`），永远不以 `solo-` 开头。
 * `test/room.test.ts` 锁住这两条。
 */
export const SOLO_OP = 'solo-';

export const soloOp = (op: string): string => (op.startsWith(SOLO_OP) ? op : `${SOLO_OP}${op}`);

export const roomOp = (e: { ref: string; id: string }): string => `${e.ref}-${e.id}`;
