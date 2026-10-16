/**
 * 给人看的字（AGENTS.md 第 4 节：中文、大白话、少术语）。游戏名只在这里定，要换名字改 GAME_NAME 就行（DESIGN.md 第 0 节）。
 */
import type { RoomTexts } from 'arcade-kit/client';
import type { FanId } from '../core/variants/sichuan-xuezhan/index.ts';
import type { HighlightId } from '../game/banter.ts';
import type { Level } from '../ai/venues.ts';
import type { StakesId, TierId } from '../game/stakes.ts';

export const GAME_NAME = '雀馆';
export const VARIANT_NAME: Record<string, string> = { 'sichuan-xuezhan': '川麻·血战到底' };

export const SUIT_NAME = ['万', '筒', '条'] as const;

export const FAN_NAME: Record<FanId, string> = {
  ping: '平胡',
  pengpeng: '对对胡',
  qing: '清一色',
  qidui: '七对',
  longqidui: '龙七对',
  jiangdui: '将对',
  yaojiu: '带幺九',
  jingou: '金钩钓',
  gen: '根',
  gangkai: '杠上开花',
  gangpao: '杠上炮',
  qianggang: '抢杠胡',
  haidi: '海底捞月',
  haidipao: '海底炮',
  tianhu: '天胡',
  dihu: '地胡',
  zimo: '自摸加番',
};

/** 番型表（规则里随时可查）：名字、番、一句话 */
export const FAN_TABLE: [FanId, string, string][] = [
  ['ping', '0', '四组加一对，最普通的胡'],
  ['pengpeng', '1', '四组全是三张一样的'],
  ['qing', '2', '全是同一门'],
  ['qidui', '2', '七个对子'],
  ['longqidui', '3', '七对里有四张一样的'],
  ['jiangdui', '3', '对对胡，而且全是 2、5、8'],
  ['yaojiu', '2', '每组和将都带 1 或 9'],
  ['jingou', '1', '碰杠了四组，手里只剩一张单钓'],
  ['gen', '+1 / 个', '自己有四张一样的牌，每种算一根'],
  ['gangkai', '1', '杠完补的牌正好自摸'],
  ['gangpao', '1', '别人杠完补牌打出来，你胡了'],
  ['qianggang', '1', '别人补杠那张，你正好胡'],
  ['haidi', '1', '摸最后一张自摸'],
  ['haidipao', '1', '胡最后一张打出来的牌'],
  ['tianhu', '封顶', '庄家起手就胡'],
  ['dihu', '封顶', '闲家第一次摸牌就自摸'],
];

export const TITLE_NAME: Record<string, string> = {
  xz_winner: '大赢家',
  xz_pao_king: '点炮王',
  xz_gang_king: '杠王',
  xz_zimo_king: '自摸王',
  xz_iron_wall: '铁壁',
  xz_qing: '清一色大师',
  xz_dragon: '龙七对',
  xz_seven: '七对达人',
  xz_golden_hook: '金钩钓',
  xz_gang_flower: '杠上开花',
  xz_rob_gang: '抢杠',
  xz_sea_moon: '海底捞月',
  xz_capped: '封顶',
  xz_heaven: '天胡',
  xz_earth: '地胡',
  xz_last_stand: '血战到底',
};

/** 名场面（game/banter.ts 的 highlightsOf） */
export const HIGHLIGHT_NAME: Record<HighlightId, string> = {
  multi2: '一炮双响',
  multi3: '一炮三响',
  gangkai: '杠上开花',
  qianggang: '抢杠胡',
  tianhu: '天胡',
  dihu: '地胡',
  haidi: '海底捞月',
  longqidui: '龙七对',
  qing: '清一色',
  jingou: '金钩钓',
  capped: '封顶',
};

export const STAKES_NAME: Record<StakesId, string> = { fun: '娱乐', small: '小', mid: '中', big: '大', lux: '豪华' };

/** 娱乐的三个难度（docs/balance.md 第 3、5 节，四个游戏一样的叫法） */
export const LEVEL_NAME: Record<Level, string> = { easy: '新手', normal: '普通', hard: '高手' };
/** 选档卡片上：电脑多强（1–4 颗星）、适合谁。实盘档越大电脑越强 */
export const STARS: Record<Level | TierId, number> = { easy: 1, normal: 2, hard: 3, small: 1, mid: 2, big: 3, lux: 4 };
export const LEVEL_FOR: Record<Level, string> = { easy: '第一次玩', normal: '会打了', hard: '想挑战' };
/**
 * 一局大约几分钟（真人速度）：模拟器按自己每个决定 3 秒、电脑 1.2 秒、每局另加 20 秒估，8 局 p50 约 18 分钟（DESIGN.md 4.1）；
 * 卡片上按选的局数乘出来
 */
export const MINUTES_PER_ROUND = 2.25;

/** 换三张的方向 */
export const SWAP_DIR = ['换给下家', '换给对家', '换给上家'] as const;

/** 四位数以上加逗号 */
export const num = (n: number): string => Math.round(n).toLocaleString('zh-CN');
export const signed = (n: number): string => (n > 0 ? `+${num(n)}` : n < 0 ? `−${num(-n)}` : '0');

/** 钱款的种类（结算页的流水） */
export const PAY_KIND: Record<string, string> = {
  hu: '点炮',
  zimo: '自摸',
  kan: '杠钱',
  move: '呼叫转移',
  tax: '退税',
  pig: '查花猪',
  cha: '查大叫',
};

/**
 * 钱包和平台的错误给玩家看的一句话（docs/platform-backend.md 15.10 的对照表）：说清出了什么事、怎么办，不只回错误码。
 * fix 是页面可以给的办法（按钮）
 */
export function walletError(code: string, retryAfter?: number): { text: string; fix?: 'less' | 'wallet' | 'refresh' } {
  switch (code) {
    case 'no_funds':
      return { text: '钱包里的筹码不够，少带一点，或者去大厅领补给', fix: 'less' };
    case 'limit':
      return { text: '今天开局太多了，明早 0 点恢复；桌上的照常结回。娱乐局照常能玩' };
    case 'at_table':
      return { text: '这一桌带的是别的档，换一桌再开' };
    case 'expired':
      return { text: '这一份放太久了，已经原样退回钱包' };
    case 'no_stake':
      return { text: '这一份已经结过了', fix: 'wallet' };
    case 'busy':
      return { text: '服务器今天有点忙，先不能带筹码开局；娱乐局照常玩，明早恢复' };
    case 'internal':
      return { text: '出了点问题，筹码没动，过一会儿再试' };
    case 'rate_limited':
      return { text: `操作太频繁了，歇一会儿再试${retryAfter ? `（${Math.ceil(retryAfter / 60)} 分钟后）` : ''}` };
    case 'login':
      return { text: '登录过期了，重新登录再来', fix: 'refresh' };
    case 'unavailable':
    case 'network':
      return { text: '连不上服务器，筹码没动，过一会儿再试' };
    default:
      return { text: '出了点问题，这一份筹码没动，刷新一下再试', fix: 'refresh' };
  }
}

/** 好友房开房失败、断开时的话：kit 的默认文案（ROOM_TEXT）里麻将说法不一样的几条 */
export const ROOM_TEXTS: RoomTexts = {
  login: '先登录再来',
  has_room: '你开的房间太多了，先回去打完一个',
  daily_limit: '今天开房次数用完了，明天再来',
  bad_options: '房间设置不对，换一个再开',
  roomClosed: '房间关了，桌上的筹码已经结回钱包',
  quota: '今天联机的人太多了，这一局打完先散了，桌上的筹码结回钱包，单机照常玩',
  noRoom: '没有这个房间：码不对，或者房间已经散了',
};

/**
 * 电脑反应时气泡里说的话（kit 的 moodLines，按情绪挑）：四川味，只说牌局不说人。表情由 kit 按情绪配
 */
export const MOOD_LINES = {
  angry: ['气人！下把杠回来', '血战到底，哪个怕哪个', '雄起！'],
  sweat: ['莫慌，稳起', '失误失误', '这张没算到'],
  love: ['安逸！', '好牌，服了', '你娃手气好哦'],
  smug: ['巴适得板！', '又是我嘛', '看嘛，大牌！'],
  shock: ['啊？这张也有人要', '不得了哦'],
  cry: ['手气背哦', '下把再来'],
} as const;

/**
 * 四川味短语（DESIGN.md 第 6 节）：只说牌局不说人，不涉长相、家人、地域、性别，无脏字。
 * 编号就是 kit 的 emote id（0–13），顺序只往后加，不改不删（老页面和新页面要对得上）
 */
export const PHRASES = [
  '雄起！',
  '巴适得板！',
  '你娃手气好哦',
  '又点炮了哇',
  '莫慌，稳起',
  '杠起走！',
  '这把要清一色',
  '快点嘛，花儿都谢了',
  '安逸！',
  '血战到底，哪个怕哪个',
  '手气背哦',
  '这张你要不要嘛',
  '好牌，服了',
  '下把再来',
] as const;
