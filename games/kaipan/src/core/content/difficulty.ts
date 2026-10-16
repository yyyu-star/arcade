import { fx } from '../balance.ts';
import type { DifficultyDef } from '../hooks.ts';

function n(id: string, key: string): string {
  const v = fx(id, key);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/** 倍数说成"多百分之几"：1.03 → "3%"。 */
function more(id: string, key: string): string {
  return `${Math.round((fx(id, key) - 1) * 100)}%`;
}

/**
 * 难度（"市场环境"，0.3.0：1..8 级，id 固定）。0.10.0 前三级改叫新手 / 普通 / 高手（仓库根 docs/balance.md 第 3 节），后面五级是高手之后的挑战。高等级包含低等级的全部约束，引擎按 1..level 依次叠加：
 * rules 改玩家规则表（月供倍数、可信度、奖励张数……），market 改每天的市场规则（偏熊、炸板率……）。
 * 第 6 级"股灾"的月份由种子决定（crashPlan），引擎在那个月月初公布传闻、在某个交易日让所有题材提前退潮。
 * 数值在 BALANCE.fx[id]。通关一级解锁下一级（档案层，见 src/platform/profile.ts）。
 * desc 只说一句体感、不带数字；具体数字放 detail（画面悬停时显示）。
 */
export const DIFFICULTIES: readonly DifficultyDef[] = [
  {
    id: 'slow_bull',
    name: '新手',
    short: '大环境慢慢涨',
    realShort: '要还的钱最少',
    level: 1,
    who: '第一次玩',
    desc: '最友好的一档：大环境慢慢往上走',
    realDesc: '大环境慢慢往上走，每月要还的钱最少',
  },
  {
    id: 'choppy',
    name: '普通',
    short: '风口忽冷忽热',
    realShort: '群里消息乱一些',
    level: 2,
    who: '玩过几局',
    desc: '风口忽冷忽热，每月要还的钱也多一点',
    realDesc: '每月要还的钱多一点，群里的消息也乱一些：谁的话都得掂量',
    realDetail: `每月要还的钱多 ${more('choppy', 'realBill')}；群里 ${Math.round(fx('choppy', 'realNoise') * 100)}% 的消息是瞎传的，推荐的股票不受影响`,
    detail: `每月要还的钱多 ${more('choppy', 'billMult')}；每个风口每天的热度额外乱晃，最多差 ${n('choppy', 'dHNoise')} 点${fx('choppy', 'failMult') > 1 ? `；"刚开始火就熄火"的情况多 ${more('choppy', 'failMult')}` : ''}`,
    rules(r) {
      r.billMult *= fx('choppy', 'billMult');
    },
    // 0.10.0 配平：真实行情下这一级就是"普通"，群里的消息也跟着乱一些，小白和会看战绩的人差得没那么远（docs/balance.md 第 3 节）。
    // 短局只有 5 个月，会看战绩的人本来就攒不出多大优势，不再加乱（docs/design-balance.md 第 3 节）
    realRules(r, short) {
      r.billMult *= fx('choppy', 'realBill');
      if (!short) r.msgNoise = 1 - (1 - r.msgNoise) * (1 - fx('choppy', 'realNoise'));
    },
    market(r) {
      r.failMult *= fx('choppy', 'failMult');
      r.dHNoise += fx('choppy', 'dHNoise');
    },
  },
  {
    id: 'bear_market',
    name: '高手',
    short: '大环境容易变差',
    realShort: '买入要交手续费',
    level: 3,
    who: '想要挑战',
    desc: '大环境更容易变差，而且一差就是好几天',
    realDesc: '券商涨价了：每次买入都要交手续费，要还的钱也再多一点',
    realDetail: `每次买入按这一笔的金额收 ${n('bear_market', 'fee')}% 手续费；每月要还的钱再多 ${more('bear_market', 'realBill')}（真实行情的涨跌照真的走，不再人为变差）`,
    market(r) {
      r.bearBias += fx('bear_market', 'bearBias');
    },
    realRules(r) {
      r.buyFee += fx('bear_market', 'fee');
      r.billMult *= fx('bear_market', 'realBill');
    },
  },
  {
    id: 'fake_news',
    name: '消息失真',
    short: '群里消息不太准',
    level: 4,
    desc: '群里大部分消息是瞎传的，谁的话都没那么准了（推荐的股票不受影响）',
    detail: `群里 ${Math.round(fx('fake_news', 'noise') * 100)}% 的消息是瞎传的；靠谱的群友在"要变天了"的时候也不再更准；推荐的股票还和原来一样准`,
    rules(r) {
      r.credDelta += fx('fake_news', 'cred');
      r.msgNoise = 1 - (1 - r.msgNoise) * (1 - fx('fake_news', 'noise'));
      r.turnCredMult *= fx('fake_news', 'turnCred');
    },
  },
  {
    id: 'regulation',
    name: '强监管',
    short: '涨停更容易被砸',
    realShort: '涨停那头收窄',
    level: 5,
    desc: '涨停更容易被砸下来，危险股更容易收到退市警告',
    realDesc: '涨停收窄：大涨的日子赚得少了，大跌照样疼',
    realDetail: `所有股票涨停那一头变成原来的 ${n('regulation', 'limitUp')} 倍，跌停不变`,
    realRules(r) {
      r.limitUpMult *= fx('regulation', 'limitUp');
    },
    detail: `涨停后被砸下来的机会是原来的 ${n('regulation', 'blowMult')} 倍；危险股收到退市警告的机会是原来的 ${n('regulation', 'stWarnMult')} 倍`,
    market(r) {
      r.blowMult *= fx('regulation', 'blowMult');
      r.stWarnMult *= fx('regulation', 'stWarnMult');
    },
  },
  {
    id: 'market_crash',
    name: '股灾',
    short: '某个月全场降温',
    level: 6,
    desc: '某个月会传出坏消息，几天之内所有风口一起降温',
    realDesc: '某个月会传出坏消息，那个月真的有一次大跌，所有风口一起降温，还多一笔突发账单',
    detail: '一局里随机一个月，月初传出"市场传闻"，几天之内所有风口一起降温；那个月还多一笔突发账单',
  },
  {
    id: 'inflation',
    name: '通胀',
    short: '要还的钱更多',
    level: 7,
    desc: '每月要还的钱更多了',
    detail: `每月要还的钱再多 ${more('inflation', 'billMult')}${fx('inflation', 'surpriseMult') !== 1 ? `，突发账单再多 ${more('inflation', 'surpriseMult')}` : ''}`,
    rules(r) {
      r.billMult *= fx('inflation', 'billMult');
      r.surpriseMult *= fx('inflation', 'surpriseMult');
    },
  },
  {
    id: 'doom',
    name: '末日',
    short: '奖励更少，坏事更坏',
    level: 8,
    desc: '奖励更少，坏事更坏',
    detail: `每个月的奖励只给 ${n('doom', 'rewardCards')} 张；事件里花的钱和亏的钱是原来的 ${n('doom', 'badMult')} 倍；突发账单再多 ${more('doom', 'surpriseMult')}`,
    rules(r) {
      r.rewardCards = Math.min(r.rewardCards, fx('doom', 'rewardCards'));
      r.eventBadMult *= fx('doom', 'badMult');
      r.surpriseMult *= fx('doom', 'surpriseMult');
    },
  },
];

/** 最低、最高难度等级。 */
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = DIFFICULTIES.length;
