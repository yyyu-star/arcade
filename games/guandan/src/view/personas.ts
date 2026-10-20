/**
 * 三个电脑的口吻、表情和出手节奏（打法在 src/ai/persona.ts，这里跟着同一份性格走，0.7.0 起）：
 * 老张：豪爽、爱炸弹、出手爽快；小美：稳、话少、想得细；阿强：莽、嘴快、手快，输了上头。
 * 每场的状态（手热、手冷）和局面（落后、领先、上头）也反映在说什么、多快出手上。
 */
import { PERSONAS, type PersonaId } from '../variants/guandan/ai/index.ts';
import type { SeatId } from './labels.ts';

export type Situation =
  | 'bomb' | 'jokerBomb' | 'bombed' | 'beat' | 'lead' | 'pass' | 'first' | 'last' | 'fewCards'
  | 'tribute' | 'getTribute' | 'partnerFirst' | 'win' | 'lose' | 'start' | 'jiefeng'
  /** 开场时状态好、状态差 */
  | 'hot' | 'cold'
  /** 一副开始时级数落后、领先 3 级以上 */
  | 'behind' | 'ahead'
  /** 上一副输了、上头了 */
  | 'tilt';

const LINES: Record<PersonaId, Partial<Record<Situation, string[]>>> = {
  laozhang: {
    bomb: ['炸！', '看我的炸弹！', '炸了再说！', '嘿，就等这一下', '憋不住了，炸！', '响一个听听'],
    jokerBomb: ['四个王！服不服？', '天王炸，管够！', '老张压箱底的'],
    bombed: ['哎哟，炸我？', '行啊你们', '好家伙', '记下了啊'],
    beat: ['压一手', '这个我要了', '来来来', '接着来'],
    pass: ['过', '你们先', '不要', '让让你们'],
    lead: ['走一个', '开张', '随便出个'],
    first: ['头游！老张还是老张', '哈哈，我先走一步', '先走了，你们慢慢打'],
    last: ['唉，手气不行', '下把再炸回来', '这牌没法打'],
    fewCards: ['我可快走完了啊', '剩不多咯'],
    tribute: ['拿去拿去', '一张牌而已'],
    getTribute: ['谢了啊', '那我收下了'],
    partnerFirst: ['好！漂亮', '队友给力！'],
    win: ['痛快！', '老张赢了请喝茶'],
    lose: ['今天不算，再来！', '下副炸回来'],
    start: ['来来，开打！', '今天手热', '坐好了啊'],
    hot: ['今天手气旺，炸弹管够', '手热，谁也别拦我'],
    cold: ['今天手有点生，稳着点', '先摸摸牌，不急'],
    behind: ['落后几级怕什么，炸回来', '慢慢追，老张有的是炸弹'],
    ahead: ['领先了，稳住稳住', '哈，照这么打下去'],
    tilt: ['刚才那副不算', '缓一缓，这副好好打'],
    jiefeng: ['我来接'],
  },
  xiaomei: {
    bomb: ['炸。', '这时候该炸了', '留到现在了'],
    jokerBomb: ['天王炸。', '收下吧'],
    bombed: ['嗯，记住了', '有点意思', '好。'],
    beat: ['压', '我来', '顶上'],
    pass: ['过', '不要', '你先'],
    lead: ['我出', '小牌走', '先走这个'],
    first: ['头游。', '先走一步'],
    last: ['这把牌太散', '下一副'],
    fewCards: ['还剩几张'],
    tribute: ['给。'],
    getTribute: ['收到'],
    partnerFirst: ['漂亮！', '队友给力'],
    win: ['稳稳拿下', '配合得好'],
    lose: ['没关系，下局再来'],
    start: ['加油', '好好打'],
    hot: ['今天牌感不错', '状态在'],
    cold: ['今天慢慢来', '先看看'],
    behind: ['不急，一副一副追', '还早'],
    ahead: ['别松劲', '保持住'],
    jiefeng: ['我接上'],
  },
  aqiang: {
    bomb: ['炸！谁怕谁', '炸死你们！', '吃我一炸', '炸炸炸！'],
    jokerBomb: ['天王炸！！', '无敌了！'],
    bombed: ['什么鬼！', '不讲武德啊', '你给我等着'],
    beat: ['管上！', '压死', '冲冲冲', '我的！'],
    pass: ['算了算了', '过过过', '让你一手', '先放你一马'],
    lead: ['看好了！', '接招', '来啊'],
    first: ['我第一！', '冲刺成功', '我说什么来着'],
    last: ['不可能！', '牌太烂了', '这都什么牌'],
    fewCards: ['我要走了哦！', '拦不住我了'],
    tribute: ['哼，给你'],
    getTribute: ['嘿嘿，谢啦'],
    partnerFirst: ['牛！', '带飞了！'],
    win: ['赢麻了！', '太爽了'],
    lose: ['再来一局！我不服'],
    start: ['冲！', '今天必赢'],
    hot: ['今天谁来都不好使！', '手感来了，冲！'],
    cold: ['今天手好冷……', '牌怎么都这样'],
    behind: ['还能追！', '落后算什么，看我的'],
    ahead: ['就这？', '稳赢了吧'],
    tilt: ['气死我了，这副必须赢回来', '刚才不算！', '我不服！'],
    jiefeng: ['接风！看我的'],
  },
};

/** 每个电脑最近说过的几句：同一句不连着说 */
const recent: Record<PersonaId, string[]> = { laozhang: [], xiaomei: [], aqiang: [] };

/** 取一句台词：避开这个人最近说过的两句。没有该情境的台词时返回 null。rand 给测试用 */
export function lineFor(id: SeatId, sit: Situation, rand: () => number = Math.random): string | null {
  if (id === 'me') return null;
  const list = LINES[id][sit];
  if (!list || list.length === 0) return null;
  const said = recent[id];
  const fresh = list.filter((x) => !said.includes(x));
  const pool = fresh.length ? fresh : list;
  const line = pool[Math.floor(rand() * pool.length)]!;
  said.push(line);
  if (said.length > 2) said.shift();
  return line;
}

/** 说话频率：老张、阿强话多，小美话少；手热、上头时话更多 */
const TALKATIVE: Record<SeatId, number> = { me: 0, laozhang: 0.45, xiaomei: 0.22, aqiang: 0.55 };

export function talkChance(id: SeatId, form: number, tilt: number): number {
  return Math.min(0.9, TALKATIVE[id] * (1 + Math.max(0, form) * 0.4 + tilt * 0.6));
}

/** 出手节奏：老张爽快、小美想得细、阿强手快（上头更快） */
const TEMPO: Record<PersonaId, { base: number; bomb: number }> = {
  laozhang: { base: 0.85, bomb: 0.75 },
  xiaomei: { base: 1.15, bomb: 1.2 },
  aqiang: { base: 0.75, bomb: 0.8 },
};

export interface Think {
  kind: 'pass' | 'play' | 'bomb';
  /** 这一手是领出 */
  lead: boolean;
  /** 对手快走完了：要紧的一手 */
  tense?: boolean;
  persona?: PersonaId;
  form?: number;
  tilt?: number;
}

/**
 * 电脑的思考时间（毫秒，再经 dur 换算）：不要最快，跟牌稍慢，领出要想想，出炸弹前犹豫一下；要紧的一手再多想一会儿。
 * 太快了看不清谁出了什么，也没有"在博弈"的感觉；太慢又拖。0.25.0 所有者嫌一把太慢，整体压到原来的约 6 成：
 * 不要 0.3–0.5 秒、跟牌 0.5–0.9、领出 0.7–1.1、炸弹约 1 秒（再按性格、状态伸缩），封在 300–1600 毫秒。rand 给测试用
 */
export function thinkTime(t: Think, rand: () => number = Math.random): number {
  let ms = t.kind === 'pass' ? 300 : t.kind === 'bomb' ? 950 : t.lead ? 700 : 500;
  ms += rand() * (t.kind === 'pass' ? 200 : t.kind === 'bomb' ? 100 : 400);
  if (t.persona) {
    const tempo = TEMPO[t.persona];
    ms *= t.kind === 'bomb' ? tempo.bomb : tempo.base;
    // 手热的出得快一点；上头的更快（阿强最明显）
    ms *= 1 - (t.form ?? 0) * 0.12 - (t.tilt ?? 0) * 0.15 * (PERSONAS[t.persona].tilt > 0.5 ? 1 : 0.3);
  }
  if (t.tense && t.kind !== 'pass') ms *= 1.25;
  return Math.round(Math.min(THINK_MAX, Math.max(THINK_MIN, ms)));
}

/** 思考时间的上下限（毫秒） */
export const THINK_MIN = 300;
export const THINK_MAX = 1600;
