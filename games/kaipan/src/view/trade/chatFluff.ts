import type { Glyph } from '../assets.ts';
import { ellipsize } from '../../core/format.ts';

/**
 * 0.5.1 群聊热闹元素（纯画面装饰，不进规则层）：表情包贴纸、群友互相回复、撤回、拍一拍。
 *
 * - 全部用「局的 seed + 交易日编号 + 用途」做确定性随机：同一天重绘结果一样，换一天才变。
 * - 只用来填手机屏幕下面的空白；当天真消息和推荐卡永远优先（见 chat.ts 的 fillFluff）。
 * - 文案短、口语、不露年份公司，不用行话（tests/view-copy.test.ts 的词表）和 emoji。
 */

/** 昨天的行情给群里定的调：大涨、大跌、平淡、开张第一天。 */
export type Tone = 'boom' | 'crash' | 'flat' | 'open';

export type Fluff =
  | { kind: 'sticker'; friendId: string; glyph: Glyph; caption: string }
  | { kind: 'reply'; friendId: string; toId: string; quote: string; text: string }
  | { kind: 'recall'; friendId: string }
  | { kind: 'poke'; friendId: string; toId: string; tail: string }
  /** 0.6.4 稀有小彩蛋：一行系统提示，{a} 换成群友名 */
  | { kind: 'note'; friendId: string; text: string };

/** 字符串 → 32 位哈希（FNV-1a）。 */
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 确定性随机数发生器（mulberry32）：同样的 key 永远给同一串数。 */
export function fluffRng(key: string): () => number {
  let a = hash(key);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length) % list.length]!;
}

/** 按昨天大环境涨跌（pp）定调；没有昨天（开局第一天）为 open。 */
export function toneOf(ret: number | null): Tone {
  if (ret === null) return 'open';
  if (ret >= 0.8) return 'boom';
  if (ret <= -0.8) return 'crash';
  return 'flat';
}

/** 贴纸：图标 + 贴纸上的两三个字。 */
const STICKERS: Record<Tone, readonly [Glyph, string][]> = {
  boom: [
    ['rocket', '起飞'],
    ['moneybag', '数钱中'],
    ['rainbow', '回本了'],
    ['sun', '晴空万里'],
    ['face_happy', '嘿嘿'],
    ['trophy', '今天我最靓'],
    ['gift', '请喝奶茶'],
  ],
  crash: [
    ['cry', '哭了'],
    ['leek', '又被割'],
    ['storm', '暴风雨'],
    ['rain', '下雨收衣'],
    ['face_sad', '心态崩了'],
    ['cloud', '先躺平'],
    ['hourglass', '熬着'],
  ],
  flat: [
    ['melon', '吃瓜'],
    ['cloud', '多云'],
    ['face_calm', '淡定'],
    ['magnifier', '研究中'],
    ['hourglass', '等风来'],
    ['book', '学习中'],
  ],
  open: [
    ['gift', '开张大吉'],
    ['sun', '早上好'],
    ['melon', '搬好板凳'],
    ['star', '新的一月'],
    ['rocket', '准备出发'],
    ['calendar', '新的开始'],
  ],
};

/** 有性格的群友偏爱的贴纸（四成概率用自己的）。 */
const FAVORITE: Record<string, Partial<Record<Tone, [Glyph, string]>>> = {
  xiaoli: { boom: ['rocket', '冲冲冲'], crash: ['rocket', '倒着飞'], flat: ['bolt', '快动啊'] },
  laowang: { boom: ['face_calm', '稳住'], crash: ['face_calm', '不慌'], flat: ['hourglass', '再等等'] },
  zhangjie: { boom: ['gift', '转发好运'], crash: ['cry', '心疼'], flat: ['melon', '姐妹吃瓜'] },
  qunzhu: { boom: ['moneybag', '早说了'], crash: ['book', '报课吗'], flat: ['moneybag', '课还有位'] },
  laozhao: { boom: ['face_hot', '懂的都懂'], crash: ['hammer', '锤它'], flat: ['magnifier', '懂的都懂'] },
  dav: { boom: ['horn', '直播见'], crash: ['horn', '别慌听我说'], flat: ['horn', '今晚直播'] },
  zhuchang: { boom: ['moneybag', '猪都笑了'], crash: ['cry', '猪都哭了'] },
  kongjun: { boom: ['bear', '迟早跌'], crash: ['bear', '我说啥来着'], flat: ['bear', '等着瞧'] },
};

/** 互相回复：@对方 + 一句（{to} 是对方名字）。 */
const REPLIES: Record<Tone, readonly string[]> = {
  // 0.6.6 每种多几句：一天两批，原来五句没几天就听腻了
  boom: ['@{to} 你上次也这么说', '@{to} 涨了就别嘚瑟', '@{to} 发红包！', '@{to} 截图留念了', '@{to} 带带我', '@{to} 今晚加鸡腿', '@{to} 先别截图，稳住', '@{to} 这波我信你一半', '@{to} 你是不是偷偷开了天眼', '@{to} 涨成这样我有点慌'],
  crash: ['@{to} 你上次也这么说', '@{to} 说好的起飞呢', '@{to} 心态还好吗', '@{to} 我先去搬砖了', '@{to} 抱抱', '@{to} 我把软件删了又装回来了', '@{to} 没事，就当交学费', '@{to} 今晚吃点好的', '@{to} 明天会更好（吧）', '@{to} 我先去楼下走两圈'],
  flat: ['@{to} 你上次也这么说', '@{to} 有啥新消息', '@{to} 真的假的', '@{to} 先观望一下', '@{to} 收到', '@{to} 今天的风有点安静', '@{to} 就这？', '@{to} 有新消息踢我一下', '@{to} 喝口茶，等等'],
  open: ['@{to} 新的一月冲不冲', '@{to} 早上好', '@{to} 这次听你的', '@{to} 先观望一下', '@{to} 这个月带带我', '@{to} 新的一月新的我', '@{to} 本月目标：少动手', '@{to} 先定个小目标'],
};

/** 某些人回别人时的口头禅（覆盖通用回复的四成）。 */
const REPLY_HABIT: Record<string, readonly string[]> = {
  xiaoli: ['@{to} 冲就完了', '@{to} 梭了梭了'],
  laowang: ['@{to} 年轻人别急', '@{to} 慢慢来'],
  zhangjie: ['@{to} 哪个群转的', '@{to} 我妈群也在说'],
  qunzhu: ['@{to} 进课程群细聊', '@{to} 私聊我'],
  laozhao: ['@{to} 懂的都懂', '@{to} 你不懂'],
  dav: ['@{to} 直播间说过了', '@{to} 关注一下'],
  neimu: ['@{to} 别外传', '@{to} 嘘'],
  kongjun: ['@{to} 等着跌吧', '@{to} 要跌了'],
  zhuchang: ['@{to} 猪价都比你稳', '@{to} 喂猪去了'],
};

/** 0.6.4 稀有小彩蛋（每批大约 2% 的机会出一条，一局能碰上两三回）。 */
const RARE_NOTES = [
  '{a} 把群名改成了「今天也要上岸」',
  '{a} 发了个红包，手慢了，没抢到',
  '{a} 设置了群公告：不许晒亏损',
  '{a} 家的猫发了一串：喵喵喵喵喵',
  '{a} 拍了拍自己，说：冷静',
  '{a} 的妈妈加入了群聊',
  '{a} 把头像换成了一棵韭菜',
  '{a} 开了免打扰，又悄悄关了',
];

const POKE_TAILS = ['的肩膀', '的保温杯', '的小本本', '：别睡了', '的脑门', '的手机', '的键盘', '的茶杯', '的小金库', '：醒醒，要开盘了', '的计算器'];

export interface FluffInput {
  seed: string;
  day: number;
  /** 区分盘前 / 收盘后两批 */
  salt: string;
  tone: Tone;
  /** 在群里的群友 id 与显示名 */
  friends: readonly { id: string; name: string }[];
  /** 今天已经说过话的（用来引用），按顺序 */
  said: readonly { friendId: string; text: string }[];
  /** 最多几条 */
  max: number;
}

/**
 * 生成一批热闹元素（确定性）：大致是 贴纸 → 回复 → 拍一拍 / 撤回 → 再一张贴纸，按 max 截断。
 * 第一张永远是贴纸（最能填空白、最直观地说明昨天行情）。
 */
export function makeFluff(o: FluffInput): Fluff[] {
  const fs = o.friends;
  if (fs.length === 0 || o.max <= 0) return [];
  const r = fluffRng(`${o.seed}:${o.day}:${o.salt}`);
  const out: Fluff[] = [];
  const someone = (not?: string): { id: string; name: string } => {
    const pool = fs.filter((f) => f.id !== not);
    return pick(r, pool.length > 0 ? pool : fs);
  };
  const sticker = (who: { id: string }): Fluff => {
    const fav = FAVORITE[who.id]?.[o.tone];
    const [glyph, caption] = fav && r() < 0.4 ? fav : pick(r, STICKERS[o.tone]);
    return { kind: 'sticker', friendId: who.id, glyph, caption };
  };
  const first = someone();
  out.push(sticker(first));
  // 回复：引用今天说过话的某人（没有就引用刚发贴纸的人）
  const target = o.said.length > 0 ? pick(r, o.said) : { friendId: first.id, text: `[表情] ${(out[0] as { caption: string }).caption}` };
  const toName = fs.find((f) => f.id === target.friendId)?.name ?? '群友';
  const replier = someone(target.friendId);
  const habit = REPLY_HABIT[replier.id];
  const line = habit && r() < 0.4 ? pick(r, habit) : pick(r, REPLIES[o.tone]);
  out.push({ kind: 'reply', friendId: replier.id, toId: target.friendId, quote: `${toName}：${shortLine(target.text, '', 12)}`, text: line.replace('{to}', toName) });
  // 小梗：内幕哥在群里时多半是撤回，否则拍一拍 / 撤回各半
  const neimu = fs.find((f) => f.id === 'neimu');
  if (neimu && r() < 0.7) out.push({ kind: 'recall', friendId: neimu.id });
  else if (r() < 0.6 && fs.length > 1) {
    const a = someone();
    out.push({ kind: 'poke', friendId: a.id, toId: someone(a.id).id, tail: pick(r, POKE_TAILS) });
  } else out.push({ kind: 'recall', friendId: someone().id });
  out.push(sticker(someone(first.id)));
  // 稀有小彩蛋用自己的随机流，不改上面那些的挑选
  const rare = fluffRng(`${o.seed}:${o.day}:${o.salt}:rare`);
  if (rare() < 0.02) out.splice(1, 0, { kind: 'note', friendId: pick(rare, fs).id, text: pick(rare, RARE_NOTES) });
  return out.slice(0, o.max);
}

/** 撤回 / 拍一拍的系统提示文字。 */
export function fluffNote(f: Fluff, nameOf: (id: string) => string): string {
  if (f.kind === 'recall') return `${nameOf(f.friendId)} 撤回了一条消息`;
  if (f.kind === 'poke') return `${nameOf(f.friendId)} 拍了拍 ${nameOf(f.toId)}${f.tail}`;
  if (f.kind === 'note') return f.text.replace('{a}', nameOf(f.friendId));
  return '';
}

const len = (x: string): number => Array.from(x).length;

/**
 * 气泡、推荐理由里的短话：去掉【转发】和括注；整句放得下就用整句，否则拼前几个短句，
 * 再不行取最像「结论」的那个短句；实在太长才截断加省略号。skip 是要跳过的开头（推荐理由里的股票名）。
 */
export function shortLine(text: string, skip = '', max = 16): string {
  let t = text.replace(/^【[^】]*】/, '').replace(/（[^）]*）|\([^)]*\)/g, '').trim();
  if (skip && t.startsWith(skip)) t = t.slice(skip.length).replace(/^[，,：:、！!。\s]+/, '');
  const whole = t.replace(/[。！!？?]+$/, '');
  if (len(whole) <= max && len(whole) > 0) return whole;
  const clauses = t.split(/[，,。！!？?；;：:\n]/).map((x) => x.trim()).filter((x) => x && x !== skip);
  // 从头拼短句，能拼多少拼多少（「家人们，AI要起飞了」读起来比只剩「家人们」顺）
  let joined = '';
  for (const c of clauses) {
    const next = joined ? `${joined}，${c}` : c;
    if (len(next) > max) break;
    joined = next;
  }
  // 拼出来太短（只有个「家人们」这种称呼）时，换成最长的那个放得下的短句
  const fit = clauses.filter((c) => len(c) <= max && len(c) > 3).sort((a, b) => len(b) - len(a))[0];
  if (joined && len(joined) > 4) return joined;
  if (fit) return fit;
  const base = clauses[0] ?? t;
  return ellipsize(base, max);
}
