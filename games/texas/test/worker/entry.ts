/** workerd 测试的入口：德州 Worker 原样导出，再加上假的平台钱包（WALLET 绑定指回自己的 WalletService，test/wrangler.test.jsonc）。 */
export { default, Queue, RoomMeter, TexasRoom } from '../../worker/main.ts';
export { FakeBank, WalletService } from 'arcade-kit/testing';
