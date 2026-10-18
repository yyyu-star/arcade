/**
 * 房间测试用的入口（tests/room/wrangler.jsonc 的 main）：部署入口 worker/main.ts 的全部导出，加上测试用的假钱包
 * （WALLET 绑到这个 Worker 自己的 FakeWallet 入口，账记在 WalletBank 里）。不部署。
 */
export { default, Queue, Room, RoomMeter } from '../../worker/main.ts';
export { FakeWallet, WalletBank } from './wallet.ts';
