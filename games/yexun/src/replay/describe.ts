/** 录像在列表里怎么写（纯函数，不碰 DOM） */
import { RULES_VERSION } from '../core/index.ts';
import type { ReplayRecord } from './format.ts';

const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function replayTitle(r: ReplayRecord): string {
  const s = r.setup;
  const mode = s.mode === 'raid' ? '夜探' : s.endless ? '无尽' : '守夜';
  const daily = r.summary.daily ? '每日 · ' : '';
  return `${daily}${mode} · 危险${s.danger}`;
}

export function replayResult(r: ReplayRecord): string {
  const x = r.summary;
  if (r.setup.mode === 'raid') return x.loot > 0 ? `带出 ${x.loot.toLocaleString('zh-CN')} 铜钱` : x.quit ? '认输' : '没撤出';
  if (x.won) return `天亮 · 斩${x.kills.toLocaleString('zh-CN')}`;
  return `${x.quit ? '认输' : '倒下'} · ${mmss(x.seconds)} · 斩${x.kills.toLocaleString('zh-CN')}`;
}

export function isOutdated(r: ReplayRecord): boolean {
  return r.rules !== RULES_VERSION;
}

export const OUTDATED_TEXT = '旧版本，可能放不对';
