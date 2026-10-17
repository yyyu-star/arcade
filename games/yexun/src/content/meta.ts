/**
 * 开局选的东西：咒印、角色、永久加成（DESIGN.md 3.7、3.8、13.2）。规则效果在核心里按这些表算；
 * 解锁条件和铜钱怎么花在 `src/platform/save.ts`。实盘不开咒印、不带加成、固定小道士（4.1）。
 */
import type { WeaponId } from './weapons.ts';

// ───────────────────────── 咒印 ─────────────────────────

export type CurseId = 'fast' | 'noheal' | 'noreroll' | 'more' | 'elites' | 'dark';
export const CURSE_IDS: readonly CurseId[] = ['fast', 'noheal', 'noreroll', 'more', 'elites', 'dark'];
/** 一局最多挂几条 */
export const MAX_CURSES = 3;
/** 每挂一条，这局结束拿到的铜钱多几成 */
export const CURSE_COIN_BONUS = 0.25;

export interface CurseDef {
  id: CurseId;
  name: string;
  text: string;
}

export const CURSES: Record<CurseId, CurseDef> = {
  fast: { id: 'fast', name: '疾', text: '怪走得快 15%' },
  noheal: { id: 'noheal', name: '枯', text: '肉包和回血减半' },
  noreroll: { id: 'noreroll', name: '定', text: '不能刷新卡片' },
  more: { id: 'more', name: '众', text: '怪多 25%' },
  elites: { id: 'elites', name: '凶', text: '每次精英多来一只' },
  dark: { id: 'dark', name: '暗', text: '夜更黑，看得更近' },
};

/** 咒印的数值（核心按这些算；"暗"只改画面，看得见的半径） */
export const CURSE_FX = { fastSpeed: 1.15, noheal: 0.5, moreCount: 1.25, darkView: 0.6 };

// ───────────────────────── 角色 ─────────────────────────

export type CharacterId = 'xiaodao' | 'fushi' | 'jianxia' | 'pang' | 'gengfu' | 'caiyao';
export const CHARACTER_IDS: readonly CharacterId[] = ['xiaodao', 'fushi', 'jianxia', 'pang', 'gengfu', 'caiyao'];

export interface CharacterDef {
  id: CharacterId;
  name: string;
  start: WeaponId;
  /** 专属被动，一句话 */
  perk: string;
  /** 怎么解锁，一句话（判断在 save.ts） */
  unlock: string;
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  xiaodao: { id: 'xiaodao', name: '小道士', start: 'sword', perk: '每升 10 级，伤害、范围、持续、移速各 +3%', unlock: '一开始就有' },
  fushi: { id: 'fushi', name: '符师', start: 'talisman', perk: '符类冷却 −10%，符咒有 15% 多发一张', unlock: '守夜撑过 10 分钟' },
  jianxia: { id: 'jianxia', name: '剑侠', start: 'flysword', perk: '走动时暴击 +10%', unlock: '一局打死 1,500 只' },
  pang: { id: 'pang', name: '胖师叔', start: 'bell', perk: '挨打时震开身边的怪', unlock: '花 600 铜钱' },
  gengfu: { id: 'gengfu', name: '更夫', start: 'shield', perk: '每到整分钟敲一声锣，全屏的怪往后退', unlock: '守夜危险 2 撑到天亮' },
  caiyao: { id: 'caiyao', name: '采药女', start: 'petals', perk: '吃肉包回血加倍，魂珠 +10%', unlock: '藏宝阁收集 20 件' },
};

/** 角色被动的数值 */
export const CHAR_FX = {
  xiaodaoEvery: 10,
  xiaodaoStep: 0.03,
  fushiCd: 0.9,
  fushiExtra: 0.15,
  jianxiaCrit: 0.1,
  /** 胖师叔震开的半径和力道 */
  pangArea: 130,
  pangKnock: 40,
  /** 更夫的锣：多远的怪往后退、退多远 */
  gongArea: 720,
  gongKnock: 60,
  caiyaoBun: 2,
  caiyaoXp: 0.1,
};

// ───────────────────────── 永久加成 ─────────────────────────

export type PerkId = 'liliang' | 'huti' | 'tipo' | 'shenxing' | 'lingqi' | 'wuxing' | 'fuyuan' | 'fuhuo' | 'shuaxin' | 'kapian';
export const PERK_IDS: readonly PerkId[] = ['liliang', 'huti', 'tipo', 'shenxing', 'lingqi', 'wuxing', 'fuyuan', 'fuhuo', 'shuaxin', 'kapian'];

export interface PerkDef {
  id: PerkId;
  name: string;
  /** 每级的效果，一句话 */
  text: string;
  /** 每一级的价格（长度就是最高级） */
  cost: readonly number[];
}

/** 价格逐级涨；第一局结束送的铜钱正好够买一级最便宜的（FIRST_RUN_COINS，3.8） */
export const PERKS: Record<PerkId, PerkDef> = {
  liliang: { id: 'liliang', name: '力量', text: '伤害 +5%', cost: [100, 200, 350, 550, 800] },
  huti: { id: 'huti', name: '护体', text: '每次挨打少掉 1 点血', cost: [200, 450, 800] },
  tipo: { id: 'tipo', name: '体魄', text: '血上限 +10', cost: [100, 200, 350, 550, 800] },
  shenxing: { id: 'shenxing', name: '神行', text: '移速 +4%', cost: [150, 300, 500] },
  lingqi: { id: 'lingqi', name: '灵气', text: '冷却 −3%', cost: [150, 300, 500, 750, 1050] },
  wuxing: { id: 'wuxing', name: '悟性', text: '魂珠 +5%', cost: [100, 200, 350, 550, 800] },
  fuyuan: { id: 'fuyuan', name: '福缘', text: '运气 +5%，铜钱 +5%', cost: [120, 250, 420, 650, 900] },
  fuhuo: { id: 'fuhuo', name: '复活', text: '倒下时原地站起来一次（半血）', cost: [1500] },
  shuaxin: { id: 'shuaxin', name: '刷新', text: '每局刷新次数 +1', cost: [300, 700, 1200] },
  kapian: { id: 'kapian', name: '多一张', text: '升级时多给一张卡', cost: [2000] },
};

export const PERK_FX = { liliang: 0.05, huti: 1, tipo: 10, shenxing: 0.04, lingqi: 0.03, wuxing: 0.05, fuyuan: 0.05, fuhuo: 1, shuaxin: 1, kapian: 1 };

/** 第一局（无论胜负）结束至少给这么多铜钱：正好够买一级最便宜的加成 */
export const FIRST_RUN_COINS = 100;

/**
 * 一局结束另给的铜钱（所有者 2026-10-17："筹码要丰富"，娱乐模式收益别抠）：每局都看得到进账，结算页按来源列。
 * 撑的时间、击杀、天亮、打倒尸王四项按危险档放大（每档 +dangerStep）；每日首胜一天一次（按北京时间的日期）。
 * 量级：危险 2 撑到天亮约 600–900 枚一局，最便宜的加成 100 枚，一套加成十几局攒齐。
 */
export const RUN_BONUS = { perMin: 10, killsPer: 40, dawn: 120, boss: 200, dangerStep: 0.2, dailyWin: 150 };

/** 复活：站起来时的血和无敌拍数，身边的怪震开 */
export const REVIVE = { hp: 0.5, invuln: 90, area: 260, knock: 90 };

/** 连死几局后问"要不要降低伤害"；开着时挨打 × dmg，成绩不进总榜（13.2） */
export const ASSIST = { deaths: 3, dmg: 0.7 };
