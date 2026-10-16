import { fx } from '../balance.ts';
import type { CalendarDef } from '../hooks.ts';

/**
 * A 股日历：固定、提前可见，每月一个，相当于本作的 Boss。数值在 BALANCE.fx[id]。
 */
export const CALENDAR: readonly CalendarDef[] = [
  {
    id: 'newyear',
    realDesc: '老话说元旦有红包行情；真实行情里涨跌照真的走，信不信看你自己',
    month: 1,
    name: '元旦红包',
    desc: '这个月大环境偏好，大家更容易一起涨',
    market(r) {
      r.bullBias += fx('newyear', 'bullBias');
      r.marketAdd += fx('newyear', 'marketAdd');
    },
  },
  {
    id: 'spring',
    month: 2,
    name: '春季躁动',
    desc: '这个月各个风口都更容易"要火"',
    market(r) {
      r.sprout += fx('spring', 'sprout');
    },
  },
  {
    id: 'policy_spring',
    month: 3,
    name: '开春政策窗口',
    desc: '这个月新能源、低空经济更容易火',
    market(r) {
      for (const t of ['newenergy', 'lowalt'] as const) {
        r.themeDH[t] = (r.themeDH[t] ?? 0) + fx('policy_spring', 'dH');
        r.sproutTheme[t] = (r.sproutTheme[t] ?? 0) + fx('policy_spring', 'sprout');
      }
    },
  },
  {
    id: 'annual',
    realDesc: '年报季：老话说过山车股容易往下砸；真实行情里涨跌照真的走',
    month: 4,
    name: '年报季',
    desc: '这个月过山车股更容易突然往下砸，危险股更容易收到退市警告，老实股更稳',
    market(r) {
      r.memeDown = fx('annual', 'memeDown');
      r.stWarnMult *= fx('annual', 'stWarnMult');
      r.noise.bluechip = (r.noise.bluechip ?? 1) * fx('annual', 'blueNoise');
    },
  },
  {
    id: 'wuqiong',
    realDesc: '老话说"五穷"；真实行情里涨跌照真的走，信不信看你自己',
    month: 5,
    name: '五穷',
    desc: '这个月大环境偏差，大家更容易一起跌',
    market(r) {
      r.bearBias += fx('wuqiong', 'bearBias');
      r.marketAdd += fx('wuqiong', 'marketAdd');
    },
  },
  {
    id: 'liujue',
    realDesc: '老话说"六绝"，风口降温也快；真实行情里涨跌照真的走',
    month: 6,
    name: '六绝',
    desc: '这个月大环境偏差，风口降温也来得更快',
    market(r) {
      r.bearBias += fx('liujue', 'bearBias');
      r.marketAdd += fx('liujue', 'marketAdd');
      r.ebbMult *= fx('liujue', 'ebbMult');
    },
  },
  {
    id: 'qifanshen',
    realDesc: '老话说"七翻身"；真实行情里涨跌照真的走，信不信看你自己',
    month: 7,
    name: '七翻身',
    desc: '这个月大环境回暖',
    market(r) {
      r.bullBias += fx('qifanshen', 'bullBias');
      r.marketAdd += fx('qifanshen', 'marketAdd');
    },
  },
  {
    id: 'interim',
    realDesc: '中报季：老话说带头大哥更猛；真实行情里涨跌照真的走',
    month: 8,
    name: '中报季',
    desc: '这个月带头大哥更猛，小弟更弱',
    market(r) {
      r.beta.leader = (r.beta.leader ?? 1) * fx('interim', 'leaderBeta');
      r.beta.follower = (r.beta.follower ?? 1) * fx('interim', 'followerBeta');
    },
  },
  {
    id: 'jinjiu',
    month: 9,
    name: '金九',
    desc: '这个月大消费更容易火',
    market(r) {
      r.themeDH.consumer = (r.themeDH.consumer ?? 0) + fx('jinjiu', 'dH');
      r.sproutTheme.consumer = (r.sproutTheme.consumer ?? 0) + fx('jinjiu', 'sprout');
    },
  },
  {
    id: 'guoqing',
    realDesc: '这个月只有 3 个交易日，钱照样要还',
    month: 10,
    name: '国庆长假',
    desc: '这个月只有 3 个交易日，钱照样要还；放假前大家都不太动，涨跌变小',
    market(r) {
      r.vol *= fx('guoqing', 'vol');
    },
  },
  {
    id: 'double11',
    month: 11,
    name: '双十一',
    desc: '这个月大消费、游戏传媒更容易火',
    market(r) {
      for (const t of ['consumer', 'gaming'] as const) {
        r.themeDH[t] = (r.themeDH[t] ?? 0) + fx('double11', 'dH');
        r.sproutTheme[t] = (r.sproutTheme[t] ?? 0) + fx('double11', 'sprout');
      }
    },
  },
  {
    id: 'yearend',
    realDesc: '年底排名：大家都在冲业绩；真实行情里涨跌照真的走',
    month: 12,
    name: '年底排名',
    desc: '这个月大家都在冲业绩，涨跌的幅度变大',
    market(r) {
      r.vol *= fx('yearend', 'vol');
    },
  },
];

/** 每月月供的名目（越来越离谱）。 */
export const BILL_NAMES: readonly string[] = [
  '房租',
  '健身卡续费',
  '网购分期',
  '车贷',
  '孩子补习班',
  '装修',
  '按摩椅分期',
  '换新手机',
  '学区房首付',
  '请全家旅游',
  '给猫买别墅',
  '还清所有梦想',
];

/** 突发账单的名目（一局 2–3 次，金额范围在 BALANCE.surprise.amounts[id]）。 */
/** 0.10.0 娱乐短局：最后一个月月底的首付（这局的最终目标；不在随机突发账单里） */
export const SHORT_GOAL_BILL = { id: 'down_payment', name: '攒了几个月的首付，今天要交' } as const;

export const SURPRISE_BILLS: readonly { id: string; name: string }[] = [
  { id: 'vet', name: '猫把耳机线当面条吃了，进了宠物医院' },
  { id: 'toilet_phone', name: '手机掉进马桶，还是刚分期买的' },
  { id: 'wedding', name: '三个表哥挑了同一天结婚，份子钱三份' },
  { id: 'wealth_class', name: '被拉进"高端理财课"，第一课教的是怎么交学费' },
  { id: 'wisdom_tooth', name: '智齿发炎，脸肿成了包子' },
  { id: 'scratch_car', name: '倒车蹭了邻居刚提的新车' },
  { id: 'milk_tea_laptop', name: '奶茶泼进了电脑，键盘有点甜' },
  { id: 'quantum_mattress', name: '爸妈在养生讲座买了"量子床垫"' },
  // 只在第 6 级"股灾"那个月出现（不参加随机突发账单，金额见 BALANCE.crash.bill）
  { id: 'bailout', name: '表舅在股灾里亏光了，找你借钱救急，说下辈子一定还' },
];
