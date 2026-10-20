import { DIR_LABEL, FEEL_LABEL, fx, itemById, MOOD_LABEL, ROLE_LABEL, STAGE_LABEL, type Dir, type Feel, type Mood, type Role, type Stage, type TurnTalk } from '../core/index.ts';

/**
 * 小白词表（docs/design.md 第 2 节）：画面上一律用新说法，A 股原词只出现在提示和词典的括注里。
 * 这里放画面层自己显示的词（按 core 的枚举映射），以及每个词的一句话解释和词典里的笑话例子。
 */

/**
 * 风口状态、真实状态、角色、大环境、群友说的方向：文字一律取规则层的 labels.ts（规则层按词表改写，画面不写死）。
 * 这里只是换个顺手的名字，并补上词典要用的解释。
 */
export const FEEL_WORD: Record<Feel, string> = FEEL_LABEL;
export const STAGE_WORD: Record<Stage, string> = STAGE_LABEL;
export const ROLE_WORD: Record<Role, string> = ROLE_LABEL;
export const MOOD_WORD: Record<Mood, string> = MOOD_LABEL;
export const DIR_WORD: Record<Dir, string> = DIR_LABEL;

/** 风口轮流火的五档，按顺序连起来：「冷清 → 要火 → 正火 → 太火 → 降温」。 */
export const FEEL_CYCLE = (['cold', 'warming', 'hot', 'overheated', 'cooling'] as const).map((f) => FEEL_LABEL[f]).join(' → ');

/** 群友觉得要变天了（只由公开信息决定）：「他觉得：要凉了」。 */
export const TURN_WORD: Record<TurnTalk, string> = {
  start: '他觉得：要火了',
  top: '他觉得：到顶了',
  ebb: '他觉得：要凉了',
};

export type TermKey =
  | 'theme'
  | 'heat'
  | 'feel'
  | 'cold'
  | 'warming'
  | 'hot'
  | 'ferment'
  | 'overheated'
  | 'cooling'
  | 'leader'
  | 'follower'
  | 'bluechip'
  | 'meme'
  | 'st'
  | 'limit'
  | 'boards'
  | 'broken'
  | 'chain'
  | 't1'
  | 'replace'
  | 'record'
  | 'turn'
  | 'flat'
  | 'since'
  | 'mood'
  | 'bill'
  | 'margin'
  | 'ipo'
  | 'lowbuy'
  | 'bust';

export interface Term {
  key: TermKey;
  /** 画面上的说法 */
  word: string;
  /** 对应的 A 股原词（只在提示和词典里出现；游戏自创的说法留空） */
  original: string;
  /** 一句话解释（悬停提示用） */
  explain: string;
  /** 词典里的例子（轻松一点） */
  example: string;
}

/** 词典：按第一次在游戏里碰到的顺序排。 */
export const GLOSSARY: readonly Term[] = [
  { key: 'theme', word: '风口', original: '题材', explain: '大家正在炒的话题，比如 AI、新能源。同一个风口的股票一起涨跌。', example: '今天的风口是养猪，明天可能就轮到低空经济了。' },
  { key: 'heat', word: '热度', original: '热度', explain: '这个风口有多火，0–100。热度涨，它的股票就涨；热度跌，股票就跌。', example: '热度 90 的意思是：连楼下卖煎饼的大爷都在聊它。' },
  { key: 'feel', word: '风口状态', original: '', explain: `看板上的五档：${FEEL_CYCLE}。按公开的热度和走势算，只是参考。`, example: '风口像一锅水：先没人理，再冒泡，然后开锅，最后凉掉。' },
  { key: 'cold', word: FEEL_LABEL.cold, original: '冷门', explain: '热度很低，没人炒。可能一直冷着，也可能哪天突然火起来。', example: '没人理的风口就像周一早上的健身房。' },
  { key: 'warming', word: FEEL_LABEL.warming, original: '萌芽、升温', explain: '热度刚开始往上走。这时候上车最舒服，但也可能只是虚晃一枪。', example: '群里有人开始转发了，但还没人发红包。' },
  { key: 'hot', word: FEEL_LABEL.hot, original: '发酵、主升', explain: '热度涨得正猛，股票天天涨。还能涨多久，谁也说不准。', example: '连你妈都问你这个风口能不能买。' },
  { key: 'ferment', word: STAGE_LABEL.ferment, original: '发酵', explain: `只有带着「${itemById('mood_meter').name}」这类道具才看得到的真实状态：刚刚火起来，还没到最猛。看板上的公开状态把它算在${FEEL_LABEL.hot}那一档。`, example: '水刚开始冒大泡，还没真正滚起来。' },
  { key: 'overheated', word: FEEL_LABEL.overheated, original: '过热、高潮', explain: '热度太高了，随时可能掉头。这时候该想想下车了。', example: '出租车司机开始给你推荐股票的时候。' },
  { key: 'cooling', word: FEEL_LABEL.cooling, original: '退潮', explain: '热度在往下掉，它的股票多半跟着跌。', example: '派对散场，只剩你在收拾一次性杯子。' },
  { key: 'leader', word: ROLE_LABEL.leader, original: '龙头', explain: '风口里最猛的那只，涨得多也跌得多；它涨停时会带着小弟一起涨。', example: '大哥一声吼，小弟全跟走。' },
  { key: 'follower', word: ROLE_LABEL.follower, original: '跟风', explain: '跟着大哥走，大哥涨停它也沾光。', example: '大哥吃肉，小弟喝汤，汤也挺香。' },
  { key: 'bluechip', word: ROLE_LABEL.bluechip, original: '白马', explain: '涨得慢、跌得也少，适合压舱。', example: '它是你股票里那个按时上班、从不请假的同事。' },
  { key: 'meme', word: ROLE_LABEL.meme, original: '妖股', explain: '经常突然暴涨或暴跌，刺激但危险。', example: '早上还在天上，下午已经在地下室了。' },
  { key: 'st', word: ROLE_LABEL.st, original: 'ST', explain: '公司出了问题，每天最多只涨跌 5%。名字前带 ST 的，都是出了问题的公司。可能翻身（问题解决后，连着几天涨停），也可能退市归零。', example: '买它之前，先把心脏病药放桌上。' },
  { key: 'limit', word: '涨停 / 跌停', original: '涨停、跌停', explain: '一天最多涨 10%（或跌 10%），涨满了就叫涨停，跌满了叫跌停。道具的加成可以让收益超过 10%。', example: '涨停是天花板，跌停是地板，你在电梯里。' },
  { key: 'boards', word: '连续涨停', original: '连板', explain: '连着好几天都涨停，越连越猛，但随时可能没封住。', example: '连续涨停 5 天的股票，名字会被群主写进课程宣传。' },
  { key: 'broken', word: '涨停没封住', original: '炸板', explain: '本来涨停了，收盘前又被砸下来。', example: '到嘴的鸭子，扑棱两下飞走了。' },
  { key: 'chain', word: '大哥带小弟', original: '龙头带动', explain: '带头大哥涨停时，同一个风口的小弟会额外多涨一点。', example: '大哥上了热搜，小弟的粉丝也涨了。' },
  { key: 't1', word: '今天买，明天才能卖', original: 'T+1', explain: '今天买进的股票，要等下一个交易日才能卖。', example: '就像网购：下单当天不能退货。' },
  { key: 'replace', word: '换掉一只', original: '换仓', explain: '持仓格满了，卖掉一只，把新的放进它的格子。', example: '衣柜满了，买新衣服就得扔一件旧的。' },
  { key: 'record', word: '说对 5/7', original: '说中 5/7', explain: '这个群友这局说了 7 次，说对了 5 次，越准越值得听。还没说过的写「新来的」。', example: '说对 0/9 的群友，反着听说不定更准。' },
  { key: 'turn', word: '要变天了', original: '拐点', explain: '群友觉得这个风口要转向了：要火了、到顶了，或者该跑了。', example: '说的人很多，说对的人很少。' },
  { key: 'flat', word: DIR_LABEL.flat, original: '横盘', explain: '群友觉得这个风口今天不怎么涨也不怎么跌。', example: '股票界的"已读不回"。' },
  { key: 'since', word: '买入以来', original: '持有收益', explain: '从你买进到现在，这只股票一共涨了或跌了多少。', example: '买入以来 -30%：别看了，越看越心疼。' },
  { key: 'mood', word: '大环境', original: '大盘', explain: '整个市场今天好不好。大环境好，大家都容易涨；差的时候都容易跌。', example: '大环境差的时候，连老实股都会叹气。' },
  { key: 'bill', word: '这个月要还', original: '月供', explain: '每个月底要从账户里还一笔钱，名目越来越离谱。月底还不上，游戏就结束。', example: '这个月的名目是"表舅的婚礼份子钱"。' },
  { key: 'margin', word: '借钱炒股', original: '两融', explain: '借钱放大收益：赚的时候多赚，亏的时候也多亏。', example: '用别人的钱炒股，心跳是自己的。' },
  { key: 'ipo', word: '抽中新股', original: '打新中签', explain: `抽中新上市的股票，往往能白捡一笔。在游戏里就是每个月初账户 +${fx('ipo', 'pct')}%。`, example: '比彩票中奖率高一点，比捡钱低一点。' },
  { key: 'lowbuy', word: '冷时买的', original: '低吸', explain: `你是在它${FEEL_LABEL.cold}或${FEEL_LABEL.cooling}时买的。只有带「${itemById('dixi').name}」这类道具时才有加成，否则只是个记号。`, example: '别人恐惧时我贪婪，别人贪婪时我已经睡了。' },
  { key: 'bust', word: '游戏结束', original: '爆仓', explain: '月底账户不够还这个月要还的钱，游戏就结束。', example: '和房东说"下个月一定"，这次不灵了。' },
];

const BY_KEY = new Map(GLOSSARY.map((t) => [t.key, t]));

export function term(key: TermKey): Term {
  const t = BY_KEY.get(key);
  if (!t) throw new Error(`没有这个词：${key}`);
  return t;
}

/** 悬停提示：标题是新说法，正文是一句话解释。 */
export function termTip(key: TermKey, extra?: string): { title: string; body: string } {
  const t = term(key);
  return { title: t.word, body: extra ? `${t.explain}\n${extra}` : t.explain };
}

/** 风口状态对应的词典条目。 */
export const FEEL_TERM: Record<Feel, TermKey> = { cold: 'cold', warming: 'warming', hot: 'hot', overheated: 'overheated', cooling: 'cooling' };

export const ROLE_TERM: Record<Role, TermKey> = { leader: 'leader', follower: 'follower', bluechip: 'bluechip', meme: 'meme', st: 'st' };
