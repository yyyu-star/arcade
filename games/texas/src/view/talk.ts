/**
 * 电脑的"表情"（0.3.0，DESIGN.md 13.3）：全下、赢大池、输大池、诈唬成了、被抓时按性格冒泡说一句；摊牌时亮出诈唬。
 * 只在画面层：说不说、说哪句用 Math.random（不进规则，好友房里各台设备看到的可以不一样）。
 * 不刷屏：整桌隔 SPEAK_GAP_MS 才说下一句，一手里一个人最多说一次；话多的性格说得勤，闷的几乎不说。
 */

import type { StickerId } from 'arcade-kit/fun';
import { CHATTY } from '../fun/banter.ts';

/**
 * 自己推全下、跟别人的全下（跟到全下）、赢了大池子、诈唬成了（亮出来的，或者下了注别人都弃了）、诈唬被抓、输了大池子（投进去 40 个大盲以上没赢）。
 * 推和跟分开（0.3.0 实打：老好自己推全下时说"跟到底！"）
 */
export type Moment = 'allin' | 'callAllin' | 'bigWin' | 'bluffWon' | 'caught' | 'bigLoss';


/** 台词按性格分；没写的那种时刻用 COMMON。大白话，不嘲弄人 */
export const LINES: Partial<Record<Moment, string[]>>[] = [
  // 稳哥：话少、稳
  {
    allin: ['就这一把了', '牌够了，全下', '推了'],
    callAllin: ['我跟', '可以，跟', '行，看牌'],
    bigWin: ['稳稳的', '该我的', '收下'],
    bluffWon: ['凑巧而已', '嗯，收了'],
    caught: ['难得试一次', '偶尔一回', '算我大意'],
    bigLoss: ['这把亏了', '下把稳点', '认了'],
  },
  // 阿飙：嘴硬爱偷
  {
    allin: ['全推，敢跟吗？', '来！', '不敢就别跟'],
    callAllin: ['跟你玩到底', '谁怕谁', '来啊'],
    bigWin: ['我就说吧', '这池子归我', '漂亮！'],
    bluffWon: ['不服来跟', '又偷到了', '盲注我拿了'],
    caught: ['被你看穿了', '这回没偷成', '眼睛挺毒'],
    bigLoss: ['下把偷回来', '运气不站我', '别得意，还没完'],
  },
  // 老好：爱跟、随和
  {
    allin: ['全押上了！', '一起热闹热闹', '押了押了'],
    callAllin: ['跟到底！', '我不怕，跟', '来都来了，跟'],
    bigWin: ['运气好运气好', '嘿嘿，赢啦', '多谢多谢'],
    bluffWon: ['这回我没跟', '大家都让着我'],
    caught: ['我也就试试', '不好意思啊', '哈哈露馅了'],
    bigLoss: ['好吧好吧', '没事，再来', '输得服气'],
  },
  // 慢慢：胆小结巴
  {
    allin: ['我、我全下了…', '要、要不…全下？', '我手有点抖…'],
    callAllin: ['我…我跟', '那、那我也跟…', '好吧…跟'],
    bigWin: ['居然赢了', '真、真的吗？', '我赢了？'],
    bluffWon: ['吓、吓到你了？', '我其实很慌…'],
    caught: ['被、被发现了…', '对、对不起啊…'],
    bigLoss: ['唉…我就知道', '心、心疼…', '好、好吧…'],
  },
  // 算盘：讲赔率
  {
    allin: ['算过了', '期望为正，全下', '这个价合适'],
    callAllin: ['赔率够，跟', '胜率够，跟', '算下来能跟'],
    bigWin: ['算得没错', '概率兑现了', '数学站我这边'],
    bluffWon: ['这个价你不跟', '你的赔率不够'],
    caught: ['概率站在你那边', '这次算亏了', '样本太小'],
    bigLoss: ['方差而已', '决策没错，运气差', '长期看不亏'],
  },
  // 江湖：老派口吻
  {
    allin: ['看你接不接', '亮家底了', '今天豁出去'],
    callAllin: ['接了', '奉陪到底', '这招我接'],
    bluffWon: ['嘿嘿', '承蒙关照', '兵不厌诈'],
    caught: ['江湖上就是这样', '栽了，认栽', '山水有相逢'],
    bigWin: ['承让承让', '得罪了', '见笑见笑'],
    bigLoss: ['此仇记下了', '后会有期', '风水轮流转'],
  },
  // 虎子：莽、冲
  {
    allin: ['全上！', '敢不敢？', '怕就别跟！'],
    callAllin: ['谁怕谁', '来就来！', '怕你不成'],
    bluffWon: ['被我吓跑了吧', '胆子小了点', '就知道你会弃'],
    caught: ['诈唬嘛，常有的事', '再来一把！', '不服再战'],
    bigWin: ['哈哈哈', '痛快！', '再来再来'],
    bigLoss: ['气死我了！', '再来！我不信', '下把翻本'],
  },
  // 老鹰：冷静自信
  {
    allin: ['到此为止', '就现在', '该收网了'],
    callAllin: ['看牌吧', '无所谓，跟', '亮吧'],
    bigWin: ['意料之中', '没有悬念', '正常发挥'],
    bluffWon: ['收下了', '你让步了'],
    caught: ['记下了', '你有点本事'],
    bigLoss: ['下次不会了', '记住这手', '小损失'],
  },
  // 叨叨：话痨
  {
    allin: ['冲冲冲！', '拼了！', '都来看啊，我全下了！'],
    callAllin: ['一起冲！', '我来我来，跟了！', '这热闹我必须跟'],
    bigWin: ['发财啦！', '今天手气旺', '哎呀我又赢了'],
    bluffWon: ['都不玩了？', '哎怎么都弃了', '我还没说完呢'],
    caught: ['哎呀被抓了', '你怎么看出来的', '早知道不吹了'],
    bigLoss: ['哎呀可惜了', '唉我跟你们说', '亏大了亏大了'],
  },
  // 小白：新手
  {
    allin: ['全下是这样按的吧？', '我试试全下！', '这个键是全下吗'],
    callAllin: ['跟了跟了', '我也要跟吗？', '那我也跟吧'],
    bigWin: ['我赢了？！', '哇，好多筹码', '这么多都给我？'],
    bluffWon: ['大家怎么都走了', '咦，没人跟？'],
    caught: ['原来要有牌才行…', '诈唬要被看穿的吗', '学到了学到了'],
    bigLoss: ['怎么输了呀', '好多筹码没了…', '再学学再学学'],
  },
];

/** 电脑说话时配的表情包（kit 的 STICKERS）：按时刻，几个性格换一个更像它的 */
const STICKER: Record<Moment, StickerId> = { allin: 'cool', callAllin: 'cool', bigWin: 'smug', bluffWon: 'sly', caught: 'sweat', bigLoss: 'sweat' };
const STICKER_BY: Partial<Record<number, Partial<Record<Moment, StickerId>>>> = {
  1: { bigLoss: 'angry' },
  3: { allin: 'sweat', callAllin: 'sweat', bigWin: 'shock', bigLoss: 'cry' },
  6: { allin: 'angry', callAllin: 'angry', bigWin: 'lol', bigLoss: 'angry' },
  8: { bigWin: 'lol', caught: 'cry', bigLoss: 'cry' },
  9: { allin: 'shock', callAllin: 'shock', bigWin: 'love', caught: 'cry', bigLoss: 'cry' },
};
export const stickerFor = (persona: number, m: Moment): StickerId => STICKER_BY[persona]?.[m] ?? STICKER[m];

const COMMON: Record<Moment, string[]> = {
  allin: ['全下'],
  callAllin: ['跟了'],
  bigWin: ['承让'],
  bluffWon: ['嘿'],
  caught: ['被抓了'],
  bigLoss: ['可惜'],
};

/** 整桌两句话之间至少隔这么久（真人节奏，不刷屏） */
const SPEAK_GAP_MS = 8_000;
/** 同一个电脑同一句话至少隔这么多手再说（0.3.0 实打："嘿"连着几手重复）；这一刻能说的都刚说过就不说 */
export const REPEAT_HANDS = 5;

export class Talk {
  private last = -Infinity;
  private said = new Set<number>();
  private hand = -1;
  /** 每个座位每句话上次是第几手说的 */
  private lastSaid = new Map<string, number>();

  /**
   * 这一刻要不要说、说哪句；不说时 null。must：亮诈唬、赢大池子这种一手就一回的，不看间隔
   */
  line(seat: number, persona: number, handNo: number, m: Moment, must = false): string | null {
    if (handNo !== this.hand) {
      this.hand = handNo;
      this.said.clear();
    }
    const now = performance.now();
    if (this.said.has(seat) || (!must && now - this.last < SPEAK_GAP_MS)) return null;
    if (Math.random() * 1000 >= (CHATTY[persona] ?? 300) * (must ? 2 : 1)) return null;
    const pool = (LINES[persona]?.[m] ?? COMMON[m]).filter((x) => handNo - (this.lastSaid.get(`${seat}:${x}`) ?? -Infinity) >= REPEAT_HANDS);
    if (!pool.length) return null;
    const text = pool[Math.floor(Math.random() * pool.length)]!;
    this.last = now;
    this.said.add(seat);
    this.lastSaid.set(`${seat}:${text}`, handNo);
    return text;
  }
}

export { bluffer, putIn } from '../core/fame.ts';
