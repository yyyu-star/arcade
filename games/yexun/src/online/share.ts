/**
 * 分享卡（结算页"分享这一夜"，DESIGN.md 14）：只交数据，画法和系统分享都在 kit 的 `arcade-kit/share`（prepareShare），不上传。
 * 这里不 import kit（装的 kit 版本到 0.12 才有 share）：形状和 kit 的 ShareCard 一致，接线时直接把返回值交给 prepareShare。
 * 卡上只放战绩和咒印，不放自由文字。
 */
import { CURSE_NAMES, type RunSummary } from './types.ts';

export interface ShareCardData {
  game: string;
  title: string;
  big: { value: string; label: string };
  stats?: readonly { label: string; value: string }[];
  line?: string;
  accent: string;
  player?: { name: string; badge?: string };
  date?: Date;
}

const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;
const n = (x: number): string => x.toLocaleString('zh-CN');

export function shareTitle(r: RunSummary): string {
  const s = r.setup;
  if (r.daily) return `每日挑战 · ${s.mode === 'raid' ? '夜探' : '守夜'}`;
  if (s.mode === 'raid') return `夜探 · 危险${s.danger}`;
  return `${s.endless ? '无尽' : '守夜'} · 危险${s.danger}`;
}

export function buildShareCard(r: RunSummary, player?: { name: string; badge?: string }): ShareCardData {
  const raid = r.setup.mode === 'raid';
  const big = raid
    ? { value: n(r.loot), label: r.won || r.loot > 0 ? '带出铜钱' : '没能撤出' }
    : r.won
      ? { value: '天亮', label: `守了 ${mmss(r.seconds)}` }
      : { value: mmss(r.seconds), label: '撑了' };
  const stats = [
    { label: '斩', value: n(r.kills) },
    { label: '等级', value: `${r.level}` },
    { label: raid ? '用时' : '铜钱', value: raid ? mmss(r.seconds) : n(r.coins) },
  ];
  const parts: string[] = [];
  if (r.setup.curses?.length) parts.push(`咒印：${r.setup.curses.map((c) => CURSE_NAMES[c]).join('、')}`);
  if (r.bossKilled) parts.push('斩了尸王');
  else if (r.build?.length) parts.push(r.build.slice(0, 3).join(' · '));
  return { game: '夜巡', title: shareTitle(r), big, stats, line: parts.join('；'), accent: '#2c3a6b', ...(player ? { player } : {}) };
}
