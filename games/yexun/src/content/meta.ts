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
  /** 专属被动的名字（角色卡上的小标题） */
  perkName: string;
  /** 专属被动，一句话 */
  perk: string;
  /** 怎么解锁，一句话（判断在 save.ts） */
  unlock: string;
  /** 一句话的人设（角色卡上） */
  look: string;
  /** 台词：选中时显示在卡上，开局时头上冒一次气泡。大白话，有性格 */
  line: string;
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  xiaodao: { id: 'xiaodao', name: '小道士', start: 'sword', perkName: '越战越勇', perk: '每升 5 级，伤害、范围、持续、移速各 +1.5%', unlock: '一开始就有', look: '蓝袍桃木剑，什么都会一点', line: '师父说，夜路不怕，怕的是不走。' },
  fushi: { id: 'fushi', name: '符师', start: 'talisman', perkName: '连环符', perk: '符类冷却 −10%，每第 4 次出符多飞一张', unlock: '一开始就有', look: '紫袍高冠，腰上挂满黄符', line: '符纸管够，今晚谁来都是一张。' },
  jianxia: { id: 'jianxia', name: '剑侠', start: 'flysword', perkName: '剑不停步', perk: '走动时暴击 +12%，暴击更疼 +30%', unlock: '一开始就有', look: '青衣红围巾，背着一把长剑', line: '剑在鞘里闷得慌，边走边打。' },
  pang: { id: 'pang', name: '胖师叔', start: 'bell', perkName: '皮糙肉厚', perk: '血量 +50，走得慢一点（−8%），挨打时震开身边的怪', unlock: '花 300 铜钱请他', look: '橙袍大圆脸，手里摇着小铃', line: '吃饱了才有力气，挨两下不算啥。' },
  gengfu: { id: 'gengfu', name: '更夫', start: 'shield', perkName: '三更锣', perk: '每 20 秒敲一声锣：全屏的怪被震退并受伤，金钟罩补一层', unlock: '守夜撑过 8 分钟', look: '灰袄毡帽，一手锣一手灯笼', line: '天干物燥——小心火烛——咣！' },
  caiyao: { id: 'caiyao', name: '采药女', start: 'petals', perkName: '百草香', perk: '每秒回 0.7 血，肉包回血加倍，经验 +20%', unlock: '夜探成功撤出 1 次', look: '青裙双髻，背着药篓采药', line: '药篓里什么都有，也有给你的。' },
};

/** 角色被动的数值 */
export const CHAR_FX = {
  xiaodaoEvery: 5,
  xiaodaoStep: 0.015,
  fushiCd: 0.9,
  /** 每第几次出符，那一轮多飞一张 */
  fushiEvery: 4,
  jianxiaCrit: 0.12,
  jianxiaCritDmg: 0.3,
  /** 胖师叔：多的血、移速倍数，挨打时震开的半径和力道 */
  pangHp: 50,
  pangSpeed: 0.92,
  pangArea: 130,
  pangKnock: 40,
  /** 更夫的锣：隔几拍一次、多远的怪被震、退多远，伤害 = 底 + 每级 × 等级 */
  gongEvery: 20 * 30,
  gongArea: 720,
  gongKnock: 40,
  gongDmg: 20,
  gongPerLevel: 3,
  caiyaoBun: 2,
  caiyaoXp: 0.2,
  caiyaoRegen: 0.7,
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
