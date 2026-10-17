/**
 * 撤离指引的画面计算（DESIGN.md 2.3）：屏幕边上的箭头放在哪、写什么，顶上的天亮倒计时。纯函数，画面层（主代理接进对局场景）每帧调。
 * 距离写成"走过去要几秒"而不是单位数：玩家关心的是天亮前赶不赶得到。
 */
import { DAWN_RED, DAWN_WARN, RAID_DAWN } from '../../content/explore.ts';
import type { Guide } from '../guide.ts';
import type { Raid } from '../raid.ts';

/** 主角每秒走多少单位（PLAYER.speed × 30；不含被动加成，提示偏保守） */
const UNITS_PER_SEC = 90;

export interface EdgeArrow {
  /** 箭头中心（屏幕 CSS 像素）和朝向（弧度用不着：直接给单位向量，画面层按它转） */
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** 门在屏幕里就不画箭头（画面层在门上画光圈） */
  onScreen: boolean;
  label: string;
}

/**
 * 箭头放在屏幕边上：从屏幕中心（主角）沿门的方向射出去，碰到内缩 margin 的边框就停。
 * gx, gy 是门相对主角的屏幕像素偏移（世界偏移 × 缩放）。
 */
export function edgeArrow(raid: Raid, g: Guide, gx: number, gy: number, w: number, h: number, margin = 48): EdgeArrow | null {
  if (g.gate < 0) return null;
  const hw = w / 2 - margin;
  const hh = h / 2 - margin;
  const onScreen = gx > -hw && gx < hw && gy > -hh && gy < hh;
  const dx = g.dirX;
  const dy = g.dirY;
  const tx = dx === 0 ? Infinity : hw / (dx < 0 ? -dx : dx);
  const ty = dy === 0 ? Infinity : hh / (dy < 0 ? -dy : dy);
  const t = tx < ty ? tx : ty;
  return { x: w / 2 + dx * t, y: h / 2 + dy * t, dx, dy, onScreen, label: `${raid.map.gates[g.gate]!.name} · ${walkSecs(g.dist)} 秒` };
}

/** 沿路走过去大约几秒（向上取整） */
export function walkSecs(units: number): number {
  return Math.ceil(units / UNITS_PER_SEC);
}

/** 顶上的字：14:00 前是"离天亮 m:ss"（平静），14:00 起是醒目的倒计时，最后 30 秒变红 */
export function dawnText(tick: number): { text: string; level: 0 | 1 | 2 } {
  const left = Math.max(0, RAID_DAWN - tick);
  const s = Math.ceil(left / 30);
  const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return { text: tick >= DAWN_WARN ? `天亮 ${text}` : `离天亮 ${text}`, level: tick >= DAWN_RED ? 2 : tick >= DAWN_WARN ? 1 : 0 };
}
