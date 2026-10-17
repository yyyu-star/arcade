/**
 * 有没有平台（0.8.0，kit 的 detectPlatform：问同域 /api/me）。同一份页面两种部署：
 * - 有平台（本站）：照旧，登录、云存档、钱包和实盘、"大厅"回平台首页 /；
 * - 单独部署（/api/me 404，kit 回 platform: false）：没有登录、云存档、钱包和实盘，"大厅"变成"首页"回游戏自己的首页 ./，
 *   好友房用游客身份（Worker 发的 cookie），昵称自己填，开房、进房的地址上带着；
 * - 不知道（5xx、429、断网、超时）：按有平台处理——平台多半只是抖了一下，实盘接口自己会报"钱包连不上"。
 * main.ts 启动时问一次，开场景和进房之前等它；之后各处同步读 standalone()。
 */
import { detectPlatform, withNickname, type PlatformInfo } from 'arcade-kit/client';
import { getNick } from './store.ts';

let mode: boolean | 'unknown' = 'unknown';
let info: PlatformInfo = { platform: 'unknown' };
let asked: Promise<void> | null = null;

/** 启动时问一次（重复调用拿到同一个结果） */
export function detectOnce(): Promise<void> {
  asked ??= detectPlatform().then((p) => {
    mode = p.platform;
    info = p;
  });
  return asked;
}

/** 启动时那一次的原样结果（社交部件要看登没登录，不用再问一次 /api/me） */
export function platformInfo(): PlatformInfo {
  return info;
}

export function standalone(): boolean {
  return mode === false;
}

/**
 * 单独部署时"现在是谁"：游客 cookie 是 HttpOnly、页面读不到，同一个浏览器就是同一个游客，本机记着的房间都算他的。
 * 换了 cookie（清了浏览器数据）本机记录也一起没了，不会给错人
 */
export const GUEST_ID = 'guest';

/** 回大厅：有平台回平台首页 /；单独部署没有大厅，回游戏自己的首页 */
export function lobbyUrl(): string {
  return standalone() ? './' : '/';
}

export function lobbyName(): string {
  return standalone() ? '首页' : '大厅';
}

/** 开房、进房的地址：单独部署时带上昵称（服务端会清洗，不合格或没填就叫"游客1234"）；有平台时昵称以平台为准，不带 */
export function withNick(url: string): string {
  return standalone() ? withNickname(url, getNick()) : url;
}
