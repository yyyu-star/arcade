/**
 * 牌桌互动的规则（0.11.0）：冷却、护盾、连击、回敬、电脑怎么反应、菜单放哪。纯函数和小类，不碰 DOM，时间和随机数由调用方给，
 * 页面（table-fun.ts）和房间（电脑在服务器上回应时）都能用，测试在 workerd 里直接跑。
 *
 * 座位用游戏自己的编号（页面上一般是"我 = 0"的画面座位，房间里是真实座位），这里不关心是哪种，只要同一个对象里一致。
 * 所有数字的出处是仓库根 docs/table-fun.md 第 2–4 节；都能经参数改，默认值就是规范。
 */
import { PROPS, STICKERS, type PropId, type StickerId } from './fun-art.js';

export { PROPS, STICKERS, type PropId, type StickerId };

// ---------- 节奏 ----------

export const FUN_TIMING = {
  /** 自己扔道具的冷却 */
  propCooldownMs: 1500,
  /** 表情、短语的冷却 */
  talkCooldownMs: 1000,
  /** 同一个人 shieldWindowMs 里最多被扔 shieldMax 次，多的亮护盾、不播 */
  shieldMax: 6,
  shieldWindowMs: 10_000,
  /** 连击、回敬都按这个算 */
  comboMs: 3000,
  /** 长按多久算"连扔上次那个" */
  longPressMs: 400,
  /** 污渍留多久再淡出 */
  stainMs: 3000,
  /** 首次提示留多久 */
  hintMs: 3000,
  /** 好友房的电脑从房间立刻发出来（房间只有一个闹钟），页面晚这么久再播，像人反应了一下、也等道具落地 */
  botLagMs: 900,
} as const;

export type FunKind = 'prop' | 'talk';

/** 自己发东西的冷却：道具一个计时，表情和短语共用一个 */
export class FunCooldown {
  private last: Record<FunKind, number> = { prop: -Infinity, talk: -Infinity };
  constructor(private readonly ms: Record<FunKind, number> = { prop: FUN_TIMING.propCooldownMs, talk: FUN_TIMING.talkCooldownMs }) {}

  /** 还要等多久（毫秒，0 = 能发） */
  left(kind: FunKind, now: number): number {
    return Math.max(0, this.last[kind] + this.ms[kind] - now);
  }

  /** 能发就记下并返回 true；冷却中返回 false，不记 */
  take(kind: FunKind, now: number): boolean {
    if (this.left(kind, now) > 0) return false;
    this.last[kind] = now;
    return true;
  }

  total(kind: FunKind): number {
    return this.ms[kind];
  }
}

// ---------- 护盾、连击、回敬 ----------

export interface HitResult {
  /** 被扔太多了：这一下不播，头像上亮护盾 */
  shield: boolean;
  /** 同一个人连着扔同一个人的第几下（1 = 不算连击） */
  combo: number;
  /** 被 to 扔过以后 comboMs 内扔回去 */
  revenge: boolean;
}

/** 每一下扔中都过这里；真人、电脑、好友房转发来的一视同仁 */
export class FunTally {
  private readonly hits = new Map<number, number[]>();
  /** 每个人最近一次扔的是谁、第几下：换了目标就断（"连续扔同一个人"） */
  private readonly chain = new Map<number, { to: number; t: number; n: number }>();
  /** 谁最近扔过这个人 */
  private readonly lastBy = new Map<number, { from: number; t: number }>();

  constructor(private readonly t: { shieldMax: number; shieldWindowMs: number; comboMs: number } = FUN_TIMING) {}

  hit(from: number, to: number, now: number): HitResult {
    const recent = (this.hits.get(to) ?? []).filter((x) => now - x < this.t.shieldWindowMs);
    if (recent.length >= this.t.shieldMax) {
      this.hits.set(to, recent);
      return { shield: true, combo: 1, revenge: false };
    }
    recent.push(now);
    this.hits.set(to, recent);
    const prev = this.chain.get(from);
    const combo = prev && prev.to === to && now - prev.t <= this.t.comboMs ? prev.n + 1 : 1;
    this.chain.set(from, { to, t: now, n: combo });
    const by = this.lastBy.get(from);
    const revenge = !!by && by.from === to && now - by.t <= this.t.comboMs;
    this.lastBy.set(to, { from, t: now });
    return { shield: false, combo, revenge };
  }
}

// ---------- 电脑怎么反应 ----------

/** 互动性格：爱闹 / 普通 / 高冷（每个电脑人物一个，写在游戏的人物表里） */
export type FunTemper = 'rowdy' | 'normal' | 'cool';
export const TEMPER_MULT: Record<FunTemper, number> = { rowdy: 1.5, normal: 1, cool: 0.3 };

/** 反应的情绪：决定冒哪个表情、气泡说哪类话（话由游戏给，kit 有一套不提任何游戏的默认） */
export type FunMood = 'angry' | 'sweat' | 'love' | 'smug' | 'shock' | 'cry';

/** 名场面：游戏把自己的公开事件映射成这几类，没有的不报 */
export type MomentKind =
  | 'big-win'
  | 'comeback'
  | 'bluff-caught'
  | 'bomb'
  | 'first-out'
  | 'double-down'
  | 'kong'
  | 'self-draw'
  | (string & {});

/** 发给 botReact 的事 */
export type FunEvent =
  /** 有人冲这个电脑扔了道具（prop）或点名短语（没有 prop） */
  | { kind: 'hit'; from: number; to: number; prop?: PropId }
  /** 名场面：赢的、输的各是谁；hand 区分"这一手"（每手电脑主动互动有上限） */
  | { kind: 'moment'; moment: MomentKind; winners: readonly number[]; losers: readonly number[]; hand: string | number };

export interface FunBot {
  seat: number;
  temper: FunTemper;
}

/** 电脑这一下要做什么：一定有表情和一句话的情绪（看得见），回敬时再带一个道具飞过去 */
export interface BotAction {
  from: number;
  /** 道具、点名的对象 */
  to?: number;
  /** 过多久做（像人一样反应一下） */
  delay: number;
  sticker: StickerId;
  mood: FunMood;
  prop?: PropId;
}

export interface BotReactConfig {
  /** 被扔后回应的概率（再乘性格） */
  respond: number;
  /** 回应里直接回敬道具的比例 */
  counterShare: number;
  /** 同一个电脑 counterWindowMs 里最多回敬几次 */
  counterMax: number;
  counterWindowMs: number;
  /** 同一个电脑两次反应至少隔多久（不能比扔道具的冷却长，否则连扔时回应被吞） */
  minGapMs: number;
  /** 反应延迟区间 */
  delay: readonly [number, number];
  /** 名场面：输的一方冲赢家、赢的一方得意 */
  momentLose: number;
  momentWin: number;
  /** 每一手电脑主动互动最多几次 */
  perHand: number;
}

export const BOT_REACT: BotReactConfig = {
  respond: 0.6,
  counterShare: 0.25,
  counterMax: 2,
  counterWindowMs: 20_000,
  minGapMs: 1000,
  delay: [800, 2000],
  momentLose: 0.4,
  momentWin: 0.3,
  perHand: 2,
};

/** 电脑反应的账：调用方存着（页面一局一份；房间放内存） */
export interface BotState {
  lastOut: Record<number, number>;
  counters: Record<number, number[]>;
  hand: string | number | null;
  /** 这一手已经主动互动了几次 */
  n: number;
}

export function newBotState(): BotState {
  return { lastOut: {}, counters: {}, hand: null, n: 0 };
}

const DIRTY: readonly PropId[] = ['tomato', 'egg', 'stinkyEgg', 'slipper', 'bomb'];

/** 同类回敬：番茄还番茄，鸡蛋还拖鞋（一个比一个狠一点），善意的还善意的 */
export const COUNTER: Record<PropId, PropId> = {
  tomato: 'tomato',
  egg: 'slipper',
  stinkyEgg: 'stinkyEgg',
  slipper: 'slipper',
  bomb: 'bomb',
  rose: 'rose',
  like: 'like',
  cheers: 'cheers',
};

const MOOD_STICKER: Record<FunMood, readonly StickerId[]> = {
  angry: ['angry'],
  sweat: ['sweat'],
  love: ['love'],
  smug: ['smug', 'cool', 'lol'],
  shock: ['shock'],
  cry: ['cry'],
};

const pick = <T>(xs: readonly T[], rand: () => number): T => xs[Math.floor(rand() * xs.length) % xs.length]!;

/**
 * 一个电脑对一件事的反应，没有就是 null。被扔：bot 是被扔的那个；名场面：调用方把每个电脑都问一遍（每手有上限，按问的顺序先到先得）。
 * 被扔时的回应不占"每手主动互动"的次数，只守 minGapMs 和回敬上限。
 */
export function botReact(ev: FunEvent, bot: FunBot, st: BotState, now: number, rand: () => number, cfg: BotReactConfig = BOT_REACT): BotAction | null {
  const mult = TEMPER_MULT[bot.temper];
  const p = (x: number): number => Math.min(0.95, x * mult);
  if (now - (st.lastOut[bot.seat] ?? -Infinity) < cfg.minGapMs) return null;
  const delay = Math.round(cfg.delay[0] + rand() * (cfg.delay[1] - cfg.delay[0]));
  const out = (a: Omit<BotAction, 'from' | 'delay'>): BotAction => {
    st.lastOut[bot.seat] = now;
    return { from: bot.seat, delay, ...a };
  };

  if (ev.kind === 'hit') {
    if (ev.to !== bot.seat || ev.from === bot.seat) return null;
    if (rand() >= p(cfg.respond)) return null;
    const nice = ev.prop !== undefined && !DIRTY.includes(ev.prop);
    const recent = (st.counters[bot.seat] ?? []).filter((t) => now - t < cfg.counterWindowMs);
    st.counters[bot.seat] = recent;
    if (rand() < cfg.counterShare && recent.length < cfg.counterMax) {
      recent.push(now);
      const prop = ev.prop ? COUNTER[ev.prop] : 'tomato';
      return out({ to: ev.from, prop, mood: nice ? 'love' : 'angry', sticker: nice ? 'love' : 'angry' });
    }
    const mood: FunMood = nice ? 'love' : pick(['angry', 'sweat'] as const, rand);
    return out({ to: ev.from, mood, sticker: pick(MOOD_STICKER[mood], rand) });
  }

  // 名场面：新的一手从头计数
  if (st.hand !== ev.hand) {
    st.hand = ev.hand;
    st.n = 0;
  }
  if (st.n >= cfg.perHand) return null;
  const lost = ev.losers.includes(bot.seat);
  const won = ev.winners.includes(bot.seat);
  if (lost && ev.winners.length) {
    if (rand() >= p(cfg.momentLose)) return null;
    st.n++;
    const to = ev.winners[Math.floor(rand() * ev.winners.length) % ev.winners.length]!;
    // 一半扔个不太狠的道具，一半冒表情加一句
    if (rand() < 0.5) return out({ to, prop: pick(['tomato', 'egg', 'slipper'] as const, rand), mood: 'angry', sticker: 'angry' });
    const mood: FunMood = pick(['shock', 'cry', 'angry', 'sweat'] as const, rand);
    return out({ to, mood, sticker: pick(MOOD_STICKER[mood], rand) });
  }
  if (won) {
    if (rand() >= p(cfg.momentWin)) return null;
    st.n++;
    return out({ mood: 'smug', sticker: pick(MOOD_STICKER.smug, rand) });
  }
  return null;
}

// ---------- 菜单放哪 ----------

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const overlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

/**
 * 菜单（w×h）贴着头像（anchor）放：先试朝屏幕中心那一侧，再试另外三侧；夹在可见区里（留 margin），
 * 和"禁区"（手牌、操作按钮）以及头像本身压得最少的那个位置胜出，一样少时按试的顺序。
 */
/** 菜单、面板在这么宽的屏幕上实际多宽：最多 w，两边各留 margin（0.11.2；390 竖屏上 440 宽的面板会伸出屏幕） */
export function fitMenuWidth(w: number, viewWidth: number, margin = 8): number {
  return Math.max(0, Math.min(w, viewWidth - 2 * margin));
}

/** w 是想要的宽度，窄屏上按 fitMenuWidth 收窄后再摆（页面上的盒子也要按同样的宽度画，table-fun 用 CSS 的 min()） */
export function placeMenu(anchor: Box, want: number, h: number, view: { width: number; height: number }, avoid: readonly Box[] = [], margin = 8, gap = 10): { left: number; top: number } {
  const w = fitMenuWidth(want, view.width, margin);
  const cx = anchor.left + anchor.width / 2;
  const cy = anchor.top + anchor.height / 2;
  const right = { left: anchor.left + anchor.width + gap, top: cy - h / 2 };
  const left = { left: anchor.left - gap - w, top: cy - h / 2 };
  const below = { left: cx - w / 2, top: anchor.top + anchor.height + gap };
  const above = { left: cx - w / 2, top: anchor.top - gap - h };
  // 朝中心：水平离中心远就先左右，否则先上下
  const dx = view.width / 2 - cx;
  const dy = view.height / 2 - cy;
  const order = Math.abs(dx) / view.width >= Math.abs(dy) / view.height ? (dx >= 0 ? [right, below, above, left] : [left, below, above, right]) : dy >= 0 ? [below, right, left, above] : [above, right, left, below];
  const clamp = (p: { left: number; top: number }): Box => ({
    left: Math.max(margin, Math.min(view.width - margin - w, p.left)),
    top: Math.max(margin, Math.min(view.height - margin - h, p.top)),
    width: w,
    height: h,
  });
  let best: Box | null = null;
  let bestCost = Infinity;
  for (const c of order.map(clamp)) {
    const cost = [anchor, ...avoid].reduce((s, b) => s + overlap(c, b), 0);
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
      if (cost === 0) break;
    }
  }
  return { left: best!.left, top: best!.top };
}

/**
 * 头像旁的一句话（w×h）放哪（0.18.2）：先试朝屏幕中心那一侧、和头像顶边对齐（原来的样子），再试另一侧、头像上方、下方；
 * 夹在可见区里（留 margin），和头像本身、"互动"按钮、各家名牌筹码、禁区压得最少的那个胜出，一样少时按试的顺序。
 * 竖屏自己的气泡原来总在右边、被"互动"按钮压住半截，点头像的提示盖住对家的名字和筹码（麻将报）
 */
export function placeBubble(anchor: Box, w: number, h: number, view: { width: number; height: number }, avoid: readonly Box[] = [], margin = 4, gap = 6): { left: number; top: number } {
  const cx = anchor.left + anchor.width / 2;
  const right = { left: anchor.left + anchor.width + gap, top: anchor.top - gap };
  const left = { left: anchor.left - gap - w, top: anchor.top - gap };
  const above = { left: cx - w / 2, top: anchor.top - gap - h };
  const below = { left: cx - w / 2, top: anchor.top + anchor.height + gap };
  const order = cx < view.width / 2 ? [right, left, above, below] : [left, right, above, below];
  const clamp = (p: { left: number; top: number }): Box => ({
    left: Math.max(margin, Math.min(view.width - margin - w, p.left)),
    top: Math.max(margin, Math.min(view.height - margin - h, p.top)),
    width: w,
    height: h,
  });
  let best: Box | null = null;
  let bestCost = Infinity;
  for (const c of order.map(clamp)) {
    const cost = [anchor, ...avoid].reduce((s, b) => s + overlap(c, b), 0);
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
      if (cost === 0) break;
    }
  }
  return { left: best!.left, top: best!.top };
}

// ---------- 聊天的版式（0.19.0，docs/chat.md 第 5 节） ----------

/** 电脑版（牌桌一角常驻聊天框）还是手机版（"聊天"按钮 + 贴底输入条）：按可见区大小分，不看指针（无头浏览器报的指针不可靠） */
export type ChatMode = 'desk' | 'phone';
export function chatMode(view: { width: number; height: number }): ChatMode {
  return view.width >= 960 && view.height >= 560 ? 'desk' : 'phone';
}

/** 气泡、弹幕、聊天框的字号：电脑 18–22px 按短边放大，手机 ≥ 15px（所有者：电脑上气泡太小） */
export function chatFont(view: { width: number; height: number }, mode: ChatMode = chatMode(view)): number {
  const m = Math.min(view.width, view.height);
  return mode === 'desk' ? Math.max(18, Math.min(22, Math.round(m / 48))) : m >= 480 ? 16 : 15;
}

/** 弹幕的数字：同屏上限、轨道数、横穿一屏的时长和速度上下限（px/秒）、条与条的间距、排队上限 */
export const DANMAKU = { maxDesk: 12, maxPhone: 6, lanesDesk: 6, lanesPhone: 4, crossMs: 8000, minSpeed: 90, maxSpeed: 260, gap: 32, queue: 8 } as const;

/** 弹幕速度（px/毫秒）：横穿 area 宽度约 crossMs，夹在上下限里；所有条同一速度，后一条追不上前一条 */
export function danmakuSpeed(width: number): number {
  return Math.max(DANMAKU.minSpeed, Math.min(DANMAKU.maxSpeed, (width * 1000) / DANMAKU.crossMs)) / 1000;
}

/**
 * 弹幕轨道（每条轨道的 top）：在 area 里按 4px 一档往下找高 lineH 的横条，和 blocked（手牌、按钮、名牌、头像、聊天框）一点不压的优先，
 * 从上往下贪心取、互不重叠；一条不压的都没有时只取压得最少的那一条（宁可从边上擦过也要看得见）。多了均匀挑 max 条，按从上到下排
 */
export function danmakuLanes(area: Box, lineH: number, blocked: readonly Box[], max: number, step = 4): number[] {
  if (max <= 0 || lineH <= 0 || area.height < lineH) return [];
  const cost = (top: number): number => blocked.reduce((s, b) => s + overlap({ left: area.left, top, width: area.width, height: lineH }, b), 0);
  const free: number[] = [];
  let best = area.top;
  let bestCost = Infinity;
  for (let top = area.top; top + lineH <= area.top + area.height + 0.5; top += step) {
    const c = cost(top);
    if (c < bestCost) {
      best = top;
      bestCost = c;
    }
    if (c === 0 && (free.length === 0 || top >= free[free.length - 1]! + lineH)) free.push(top);
  }
  if (free.length === 0) return [best];
  if (free.length <= max) return free;
  const k = free.length / max;
  return Array.from({ length: max }, (_, i) => free[Math.floor(i * k)]!);
}

/**
 * 挨着 anchor 放一个 w×h 的东西（手机版"聊天"按钮挨着"互动"按钮）：右、左、上、下依次试，中线对齐，
 * 夹在可见区里，和 anchor、avoid 压得最少的胜出
 */
export function placeBeside(anchor: Box, w: number, h: number, view: { width: number; height: number }, avoid: readonly Box[] = [], margin = 4, gap = 8): { left: number; top: number } {
  const cx = anchor.left + anchor.width / 2 - w / 2;
  const cy = anchor.top + anchor.height / 2 - h / 2;
  const order = [
    { left: anchor.left + anchor.width + gap, top: cy },
    { left: anchor.left - gap - w, top: cy },
    { left: cx, top: anchor.top - gap - h },
    { left: cx, top: anchor.top + anchor.height + gap },
  ];
  let best = order[0]!;
  let bestCost = Infinity;
  for (const p of order) {
    const c = { left: Math.max(margin, Math.min(view.width - margin - w, p.left)), top: Math.max(margin, Math.min(view.height - margin - h, p.top)), width: w, height: h };
    const cost = [anchor, ...avoid].reduce((s, b) => s + overlap(c, b), 0);
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
      if (cost === 0) break;
    }
  }
  return { left: best.left, top: best.top };
}

/** 挑一条空出来的轨道：freeAt[i] 是第 i 条轨道上一条的尾巴离开起点的时刻；从上往下第一条到点的，都没到点 -1 */
export function pickLane(freeAt: readonly number[], now: number): number {
  return freeAt.findIndex((t) => t <= now);
}

/**
 * 电脑版聊天框（w×h）放牌桌哪个角：左下、右下、左上、右上依次试，和禁区压得最少的胜出（游戏给了位置就不用这个）。
 * 上面两个角从屏幕高度的 9% 往下：几个游戏的顶栏（回大厅、设置）都在那一条里，kit 不知道它们的位置
 */
export function placeDock(view: { width: number; height: number }, w: number, h: number, avoid: readonly Box[] = [], margin = 12): { left: number; top: number } {
  const l = margin;
  const r = Math.max(margin, view.width - margin - w);
  const t = Math.max(margin, Math.round(view.height * 0.09));
  const b = Math.max(margin, view.height - margin - h);
  let best = { left: l, top: b };
  let bestCost = Infinity;
  for (const c of [{ left: l, top: b }, { left: r, top: b }, { left: l, top: t }, { left: r, top: t }]) {
    const cost = avoid.reduce((s, x) => s + overlap({ ...c, width: w, height: h }, x), 0);
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
      if (cost === 0) break;
    }
  }
  return best;
}

/**
 * 手机版输入条的底边（y）：贴在下半屏手牌、操作按钮的上面，不挡它们；上面留不下 h 高（那些东西占了大半屏）就贴屏幕底。
 * 键盘弹起时页面另按可见区再往上挪
 */
export function barBottom(view: { width: number; height: number }, h: number, avoid: readonly Box[] = [], margin = 8): number {
  const low = avoid.filter((b) => b.top > view.height * 0.4 && b.width > 0 && b.height > 0).map((b) => b.top);
  const y = low.length ? Math.min(...low) - margin : view.height - margin;
  return y - h < view.height * 0.12 ? view.height - margin : y;
}

/** 聊天记录、弹幕里名字的颜色：按座位号，自己另用金色高亮 */
export const SEAT_COLORS = ['#ffd36a', '#7fd0ff', '#ff9f8a', '#a8e07a', '#d4a2ff', '#ffb86b', '#6fe3d0', '#ff8fc7'] as const;
export function seatColor(seat: number): string {
  return SEAT_COLORS[((seat % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length]!;
}

// ---------- 编号 ----------

/**
 * 编号怎么排（和房间转发的 emote id 一致）：短语 0..P-1，表情 P..P+11，道具 P+12..P+19。P 是游戏短语表的长度。
 * 游戏的 RoomGame.emotes 写 funIdCount(P)。
 */
export function funIdCount(phrases: number): number {
  return phrases + 12 + 8;
}

export type FunItem = { kind: 'phrase'; index: number } | { kind: 'sticker'; index: number } | { kind: 'prop'; index: number };

export function funItem(id: number, phrases: number): FunItem | null {
  if (!Number.isInteger(id) || id < 0 || id >= funIdCount(phrases)) return null;
  if (id < phrases) return { kind: 'phrase', index: id };
  if (id < phrases + 12) return { kind: 'sticker', index: id - phrases };
  return { kind: 'prop', index: id - phrases - 12 };
}

export const stickerId = (phrases: number, index: number): number => phrases + index;
export const propId = (phrases: number, index: number): number => phrases + 12 + index;

/** 电脑的表情对应的情绪（页面收到电脑的表情时配一句话用）；不是情绪表情的回 null */
export function stickerMood(s: StickerId): FunMood | null {
  for (const [mood, list] of Object.entries(MOOD_STICKER) as [FunMood, readonly StickerId[]][]) if (list.includes(s)) return mood;
  return null;
}

/** 房间用：真人发来的编号换成给 botReact 的"被扔"（冲人来的道具、点名短语才算，表情、不点名的短语不算） */
export function hitEvent(id: number, phrases: number, from: number, to?: number): Extract<FunEvent, { kind: 'hit' }> | null {
  const it = funItem(id, phrases);
  if (!it || to === undefined || to === from || it.kind === 'sticker') return null;
  return it.kind === 'prop' ? { kind: 'hit', from, to, prop: PROPS[it.index]! } : { kind: 'hit', from, to };
}

/** 房间用：电脑的反应换成要经 botEmote 发的编号。先表情（页面会配上一句话），回扔时再加道具 */
export function botEmoteIds(a: BotAction, phrases: number): { id: number; to?: number }[] {
  const out: { id: number; to?: number }[] = [{ id: stickerId(phrases, STICKERS.indexOf(a.sticker)) }];
  if (a.prop && a.to !== undefined) out.push({ id: propId(phrases, PROPS.indexOf(a.prop)), to: a.to });
  return out;
}
