/**
 * 本机存档（localStorage `yexun.save`）和设置（`yexun.settings`，音效、音乐开关由 audio/ 读写，同一个 key 里各管各的字段）。
 * 存储不可用（隐私模式、满了）时照常能玩，只是不记得。云存档在第 8 步接平台，形状和这里一致。
 */
import type { Difficulty } from '../content/waves.ts';
import type { MapId } from '../content/maps.ts';
import { readFlag, writeFlag } from '../view/audio/sfx.ts';

const SAVE_KEY = 'yexun.save';

export interface Best {
  /** 撑了多少拍（赢了 = 天亮） */
  ticks: number;
  kills: number;
  won: boolean;
}

export interface Save {
  v: 1;
  runs: number;
  wins: number;
  /** 引导做过的几条（moved / cards / chest），做过就不再提示 */
  tips: string[];
  /** 玩家点了"不再提示" */
  tipsOff: boolean;
  /** 上次选的难度、地图 */
  difficulty: Difficulty;
  map: MapId;
  best: Partial<Record<Difficulty, Best>>;
}

const fresh = (): Save => ({ v: 1, runs: 0, wins: 0, tips: [], tipsOff: false, difficulty: 'easy', map: 'snow', best: {} });

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return fresh();
    const o = JSON.parse(raw) as Partial<Save>;
    if (!o || typeof o !== 'object' || o.v !== 1) return fresh();
    const s = fresh();
    if (typeof o.runs === 'number') s.runs = o.runs;
    if (typeof o.wins === 'number') s.wins = o.wins;
    if (Array.isArray(o.tips)) s.tips = o.tips.filter((x): x is string => typeof x === 'string');
    if (typeof o.tipsOff === 'boolean') s.tipsOff = o.tipsOff;
    if (o.difficulty === 'easy' || o.difficulty === 'normal' || o.difficulty === 'hard') s.difficulty = o.difficulty;
    if (o.map === 'snow' || o.map === 'yizhuang') s.map = o.map;
    if (o.best && typeof o.best === 'object') {
      for (const d of ['easy', 'normal', 'hard'] as const) {
        const b = o.best[d];
        if (b && typeof b.ticks === 'number' && typeof b.kills === 'number') s.best[d] = { ticks: b.ticks, kills: b.kills, won: !!b.won };
      }
    }
    return s;
  } catch {
    return fresh();
  }
}

export function writeSave(s: Save): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* 写不进去就算了 */
  }
}

/** 记一局；返回这局是不是这个难度的新纪录（先比赢没赢，再比撑的时间，再比击杀）；counts = false（认输）只记局数 */
export function recordRun(s: Save, d: Difficulty, run: Best, counts = true): boolean {
  s.runs++;
  if (run.won) s.wins++;
  if (!counts) {
    writeSave(s);
    return false;
  }
  const b = s.best[d];
  const better = !b || (run.won ? !b.won || run.kills > b.kills : !b.won && (run.ticks > b.ticks || (run.ticks === b.ticks && run.kills > b.kills)));
  if (better) s.best[d] = run;
  writeSave(s);
  return better;
}

/** 义庄开了没有：普通档或高手档撑到过天亮（DESIGN.md 3.6；危险等级第 5 步做了以后改成"雪原危险 1"） */
export function yizhuangOpen(s: Save): boolean {
  return !!(s.best.normal?.won || s.best.hard?.won);
}

/** 设置里除了声音的几项（声音开关在 audio/ 里） */
export const settings = {
  get shake(): boolean {
    return readFlag('shake', true);
  },
  set shake(on: boolean) {
    writeFlag('shake', on);
  },
  /** 固定摇杆（左下角）；默认浮动摇杆（按哪儿出在哪儿） */
  get fixedStick(): boolean {
    return readFlag('fixedStick', false);
  },
  set fixedStick(on: boolean) {
    writeFlag('fixedStick', on);
  },
};
