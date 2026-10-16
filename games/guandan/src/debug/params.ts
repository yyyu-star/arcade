/**
 * URL 参数（调试与自动化）：
 * - seed=xxx：用这个种子直接开新局（跳过标题页；已有存档时这一局不写存档、不计战绩）
 * - jump=tribute：用电脑把第一副打完，停在第二副的进贡阶段；jump=ace：直接打 A 的一副
 * - debug=1：调试模式（挂 window.__game、显示种子）；autoplay=1：电脑代打我的座位
 * - anim=0：关掉动画（瞬间完成）；speed=N：动画倍速；scale=N：渲染倍数（theme.ts 读）
 * - difficulty=easy|normal|good|hard：这一局电脑难度
 * - screen=title|rules|settings|stats：启动后直接打开某个画面（截图用）
 * - online=1：启动后直接打开好友房面板（平台大厅的入口用；0.3.0 起标题页一直有"好友房"）；room=xxxxxx：直接进这个房间（邀请链接）
 */
import { SOLO_LEVELS, type SoloLevel } from '../ai/venue.ts';

export interface LaunchParams {
  seed: string | null;
  jump: 'tribute' | 'ace' | null;
  debug: boolean;
  autoplay: boolean;
  anim: boolean | null;
  speed: number | null;
  difficulty: SoloLevel | null;
  screen: string | null;
  online: boolean;
  room: string | null;
}

export function parseParams(search: string): LaunchParams {
  const q = new URLSearchParams(search);
  const jump = q.get('jump');
  const diff = q.get('difficulty');
  const speed = Number(q.get('speed'));
  return {
    seed: q.get('seed') || null,
    jump: jump === 'tribute' || jump === 'ace' ? jump : null,
    debug: q.get('debug') === '1',
    autoplay: q.get('autoplay') === '1',
    anim: q.get('anim') === '0' ? false : q.get('anim') === '1' ? true : null,
    speed: speed > 0 ? speed : null,
    difficulty: (SOLO_LEVELS as readonly string[]).includes(diff ?? '') ? (diff as SoloLevel) : null,
    screen: q.get('screen'),
    online: q.get('online') === '1',
    room: /^\d{6}$/.test(q.get('room') ?? '') ? q.get('room') : null,
  };
}
