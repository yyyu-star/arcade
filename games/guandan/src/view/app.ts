/**
 * 全局应用上下文：当前会话、启动参数、场景切换。场景之间通过它共享会话，不各存一份。
 */
import type Phaser from 'phaser';
import type { CloudSync } from './cloud.ts';
import type { NetSession } from './net.ts';
import type { Session } from './session.ts';
import type { DdzSession } from './ddz-session.ts';
import type { LaunchParams } from '../debug/params.ts';

export const app = {
  game: null as Phaser.Game | null,
  session: null as Session | null,
  /** 斗地主的单机会话（牌馆 0.28.0）；斗地主牌桌用它 */
  ddz: null as DdzSession | null,
  /** 联机会话（好友房）；在牌桌上时优先用它 */
  net: null as NetSession | null,
  params: null as LaunchParams | null,
  /** 云存档（main.ts 启动） */
  cloud: null as CloudSync | null,
  /** 当前世界宽度（随窗口宽高比变化） */
  width: 1280,
  /** 启动耗时（毫秒） */
  bootMs: 0,
  ready: false,
  /** #app 改过几次尺寸（冒烟核对放大、地址栏收放时有没有乱写） */
  fits: 0,
};
