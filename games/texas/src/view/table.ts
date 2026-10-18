/**
 * 牌桌画面：座位、公共牌、池子、下注、庄家按钮，和一步一步的动画（发牌、推筹码、翻牌、摊牌、分池）。
 *
 * 画面只读规则给的视图（View），不算规则：每一步拿到"之前的视图、之后的视图、谁做了什么"，
 * 先把"之前"摆出来，按差别一段段播动画，最后摆成"之后"。动画全用 transform / opacity，走合成层。
 *
 * 0.1.1（试玩反馈："每一把结束后直接开了…看都看不清"）：
 * - 一手打完规则先停着（hold），结果从 lastHand 摆出来：亮出的牌、赢的五张、牌型、结果条，一直摆到下一手发牌时才收；
 * - 节奏放慢一档：发牌从庄家顺时针一张张发两圈，翻牌三张依次翻、转牌河牌前停一下，摊牌一家家亮，池子一个个飞给赢家；
 * - 每个座位这一轮做了什么（"跟注 40"）一直挂着，到下一轮才收；名牌上的数变动时跳着走；
 * - 筹码按面额分颜色一摞摞摆（art.ts 的 chipPile），池子在公共牌下面，有边池时分开写。
 */
import type { Card } from '../core/cards.ts';
import { categoryOf, evalCards } from '../core/eval.ts';
import type { Action, HandResult, LogEntry, Owner, Status } from '../core/table.ts';
import type { View } from '../core/view.ts';
import { avatarSvg, chipPile, HUMAN_BG, makeCard, ME_LOOK, setCard } from './art.ts';
import { el, setText, toggle } from './dom.ts';
import { betPos, boardPos, buttonPos, dealerSpots, deckPos, felt, isTop, potPos, resultPos, seatPos, type Geo, type Pt } from './layout.ts';
import { Dealer } from './dealer.ts';
import { coinBurst, edgeGlow, spotlight } from './fx.ts';
import { play } from './sound.ts';
import type { StickerId } from 'arcade-kit/fun';
import { bluffer, putIn } from '../core/fame.ts';
import { stickerFor, Talk, type Moment } from './talk.ts';
import { chips, handName, madeHand, personaName, personaStyle } from './text.ts';

/** 画面上一个座位此刻的样子（和视图不完全一样：动画中途、一手的结尾要摆出规则已经翻过去的那一刻） */
interface SeatFrame {
  owner: Owner;
  persona: number;
  stack: number;
  bet: number;
  status: Status;
  away: boolean;
  leaving: boolean;
  /** 手里的牌：null 是背面；空数组是没牌 */
  cards: (Card | null)[];
  /** 摊牌时的牌型名 */
  hand: string;
  win: boolean;
  /** 这一轮做了什么（"跟注 40"），挂在头像上方，到下一轮才收 */
  tag: string;
}

interface Frame {
  handNo: number;
  board: Card[];
  /** 收进池子的（不含各座位面前这一轮的下注），按主池、边池分开；一个都没有时是空的 */
  pots: number[];
  button: number;
  toAct: number | null;
  bb: number;
  seats: SeatFrame[];
  /** 一手打完、停着：这一手的结果（结果条、赢的五张高亮） */
  result: HandResult | null;
}

interface SeatNodes {
  root: HTMLDivElement;
  avatar: HTMLDivElement;
  plate: HTMLDivElement;
  name: HTMLSpanElement;
  stack: HTMLSpanElement;
  hole: HTMLDivElement;
  cards: HTMLDivElement[];
  bubble: HTMLDivElement;
  badge: HTMLSpanElement;
  clock: SVGSVGElement;
  hand: HTMLSpanElement;
  bet: HTMLDivElement;
  betChips: HTMLSpanElement;
  betAmt: HTMLSpanElement;
  look: number;
  /** 名牌上现在显示的数（跳数字的起点） */
  shown: number | null;
  tween: number;
}

export interface TableViewOpts {
  /** 我的名字（平台昵称） */
  myName: () => string;
  /** 动画速度：1 正常，越小越快 */
  pace: () => number;
  /** 点了某个座位（好友房里接管电脑用） */
  onSeat?: (seat: number) => void;
  /** 不看嘲讽和道具（0.3.0 总开关）：电脑说话也一起收起 */
  quiet?: () => boolean;
  /** 这个座位被我屏蔽了（0.6.0：真人、电脑都能屏蔽）：电脑说话也不显示 */
  muted?: (seat: number) => boolean;
  /** 电脑说话时配一个表情包（0.3.0，和真人发的同一套画法，kit 的 STICKERS） */
  sticker?: (seat: number, id: StickerId) => void;
  /** 催促炸弹按钮上的图（kit 的 bomb） */
  bombIcon?: () => string;
}

/** 好友房里每个座位上的人：真人的昵称、状态小字（掉线、电脑代打、买入中），能不能点它接管 */
export interface SeatPeople {
  name: string | null;
  tag: string | null;
  takeable: boolean;
}

/**
 * 各段动画的时长（毫秒，pace 为 1 时）。0.1.1 整体放慢一档，参照真人牌桌：
 * 发一张牌约 0.3 秒、翻牌三张依次翻、转牌河牌前停半秒多，每一下都看得清是谁、做了什么
 */
const MS = {
  chip: 380,
  check: 420,
  muck: 380,
  collect: 460,
  street: 650,
  flopGap: 360,
  boardFly: 300,
  flip: 320,
  dealGap: 170,
  dealFly: 320,
  blinds: 340,
  reveal: 560,
  potFly: 760,
  potGap: 260,
  clear: 420,
};

/** 不许盖的操作区：按钮、加注那一行、快捷下注、胜率、预选（看对手的卡、kit 的互动菜单都避开） */
const KEEP_OUT = '.actions .buttons, .actions .raise-panel, .actions .quick, .actions .odds, .pre';

export class TableView {
  readonly root: HTMLDivElement;
  private readonly feltEl: HTMLDivElement;
  private readonly markEl: HTMLDivElement;
  /** 荷官（0.18.3）：站在桌子顶边后面，牌从他手里发出、收回他那里；没地方站时照旧从庄家位置发、收回桌心 */
  private readonly croupier: Dealer;
  /** 荷官现在站的点（没站是 null） */
  private croupierAt: Pt | null = null;
  private readonly potEl: HTMLDivElement;
  private readonly potMain: HTMLDivElement;
  private readonly potSides: HTMLDivElement;
  private readonly resultEl: HTMLDivElement;
  private readonly boardCards: HTMLDivElement[] = [];
  private readonly dealer: HTMLDivElement;
  private readonly fx: HTMLDivElement;
  private seats: SeatNodes[] = [];
  /** 顶上一排刚赢的：名字那一行先写赢数（0.3.1） */
  private readonly won = new Map<number, string>();
  private me = 0;
  private g: Geo = { w: 960, h: 540, tall: false };
  private frame: Frame | null = null;
  /** 看对手的小卡（0.2.2）：同一时间一张 */
  private card: HTMLDivElement | null = null;
  private cardTimer = 0;
  private readonly talk = new Talk();
  private urgeEl: HTMLButtonElement | null = null;
  private people: SeatPeople[] | null = null;
  private clockAnim: Animation | null = null;
  private readonly opts: TableViewOpts;

  constructor(parent: HTMLElement, opts: TableViewOpts) {
    this.opts = opts;
    this.root = el('div', 'table', parent);
    this.feltEl = el('div', 'felt', this.root);
    this.markEl = el('div', 'felt-mark', this.feltEl, '德州扑克');
    this.croupier = new Dealer(this.root, this.feltEl);
    this.potEl = el('div', 'pot', this.root);
    this.potMain = el('div', 'pot-main', this.potEl);
    this.potSides = el('div', 'pot-sides', this.potEl);
    for (let i = 0; i < 5; i++) {
      const c = makeCard('board');
      this.root.appendChild(c);
      this.boardCards.push(c);
    }
    this.resultEl = el('div', 'result', this.root);
    this.dealer = el('div', 'dealer', this.root, 'D');
    this.fx = el('div', 'fx', this.root);
  }

  /**
   * 加注面板打开时，被它盖住的座位挪开（r 是操作区在屏幕上的位置），收起时放回去。
   * 按实际位置算：不同人数、不同屏幕宽，盖住的是哪个座位不一样。先试整个座位往上挪到面板上方，再试往左挪到面板左边，
   * 都放不下就只留名牌（名字和筹码）塞到面板上方（.tucked，头像、底牌、动作签先藏起来）。挪过去不许压到别的座位、出舞台
   * （0.9.0 之前只往上挪，6 人桌右下的座位叠到右上那个上面）
   */
  /** 桌心的字：主题房的名字（0.18.1，rooms.ts） */
  setMark(text: string): void {
    setText(this.markEl, text);
    this.placeCroupier();
  }

  avoid(r: DOMRect | null): void {
    const stage = this.root.getBoundingClientRect();
    // 屏幕像素换回舞台单位（舞台整体缩放过）
    const scale = stage.height / (this.root.offsetHeight || 1);
    // 各座位没挪时占的地方：轮到我时操作区一更新就会再问一次，座位可能已经挪过、还在挪的动画里，减掉此刻挪到哪了
    // （不然第二次量到的是挪了一半的位置，0.3.0 冒烟抓到）
    const boxes = this.seats.map((n) => {
      const [mx = 0, my = 0] = (getComputedStyle(n.root).translate.match(/-?[\d.]+/g) ?? []).map(Number);
      const parts = [n.avatar, n.plate, ...n.cards.filter((c) => !c.classList.contains('hidden'))].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
      return {
        left: Math.min(...parts.map((b) => b.left)) - mx * scale,
        right: Math.max(...parts.map((b) => b.right)) - mx * scale,
        top: Math.min(...parts.map((b) => b.top)) - my * scale,
        bottom: Math.max(...parts.map((b) => b.bottom)) - my * scale,
      };
    });
    type Box = (typeof boxes)[number];
    const overlap = (a: Box, b: Box | DOMRect): boolean => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    const shift = (a: Box, dx: number, dy: number): Box => ({ left: a.left + dx, right: a.right + dx, top: a.top + dy, bottom: a.bottom + dy });
    // 面板刚打开时还在往上升的动画里（低 8 个单位），再留 6 个单位的缝
    const gap = 14 * scale;
    for (const [i, n] of this.seats.entries()) {
      const box = boxes[i]!;
      // 我的座位不挪（操作区在右下角，碰不到我；万一碰到也不能把自己的牌挪走）
      if (!r || i === this.me || !overlap(box, r)) {
        n.root.style.translate = '';
        toggle(n.root, 'tucked', false);
        toggle(n.root, 'shifted', false);
        continue;
      }
      const fits = (b: Box): boolean => b.top >= stage.top && b.left >= stage.left && !overlap(b, r) && boxes.every((o, k) => k === i || !overlap(b, o));
      const p = n.plate.getBoundingClientRect();
      const [mx = 0, my = 0] = (getComputedStyle(n.root).translate.match(/-?[\d.]+/g) ?? []).map(Number);
      const plate = { left: p.left - mx * scale, right: p.right - mx * scale, top: p.top - my * scale, bottom: p.bottom - my * scale };
      const up = -(box.bottom - r.top + gap);
      const left = -(box.right - r.left + gap);
      const tuck = -(plate.bottom - r.top + gap);
      let move: [number, number, Box] = [0, 0, box];
      if (fits(shift(box, 0, up))) move = [0, up, shift(box, 0, up)];
      else if (fits(shift(box, left, 0))) move = [left, 0, shift(box, left, 0)];
      else if (fits(shift(plate, 0, tuck))) move = [0, tuck, shift(plate, 0, tuck)];
      toggle(n.root, 'tucked', move[2] !== box && move[2].bottom - move[2].top < box.bottom - box.top);
      // 整个挪开的座位：动作签换到名牌朝桌心那一侧（0.18.3），头像上方那一格现在是别人的名牌
      toggle(n.root, 'shifted', move[2] !== box && !n.root.classList.contains('tucked'));
      // 挪过去的座位也算占了地方，后面的座位别再挪到这里
      boxes[i] = move[2];
      n.root.style.translate = move[0] || move[1] ? `${Math.round(move[0] / scale)}px ${Math.round(move[1] / scale)}px` : '';
    }
  }

  /** 好友房：座位上的人（null 是单机，按电脑的性格起名） */
  setPeople(p: SeatPeople[] | null): void {
    this.people = p;
    if (this.frame) this.draw(this.frame);
  }

  /** 好友房：轮到谁、什么时候到点（房间的时间），在他的头像外面转一圈；seat 为 null 收起 */
  setClock(seat: number | null, deadline: number | null, totalMs: number): void {
    this.clockAnim?.cancel();
    this.clockAnim = null;
    this.seats.forEach((n, i) => toggle(n.clock, 'on', i === seat && deadline !== null));
    const n = seat === null ? undefined : this.seats[seat];
    if (!n || deadline === null) return;
    const left = Math.max(0, deadline - Date.now());
    const c = n.clock.querySelector('circle')!;
    const from = CLOCK_LEN * Math.min(1, 1 - left / totalMs);
    this.clockAnim = c.animate([{ strokeDashoffset: `${from}` }, { strokeDashoffset: `${CLOCK_LEN}` }], { duration: left, fill: 'forwards' });
  }

  /** 换一桌（人数或我的座位变了）时重建座位 */
  setup(size: number, me: number): void {
    for (const s of this.seats) {
      s.root.remove();
      s.bet.remove();
    }
    this.me = me;
    this.frame = null;
    this.won.clear();
    this.seats = Array.from({ length: size }, (_, i) => this.makeSeat(i));
    this.layout(this.g);
  }

  layout(g: Geo): void {
    this.g = g;
    const w = g.w;
    const f = felt(g);
    Object.assign(this.feltEl.style, { left: `${f.cx - f.rx}px`, top: `${f.cy - f.ry}px`, width: `${f.rx * 2}px`, height: `${f.ry * 2}px` });
    place(this.potEl, potPos(g));
    place(this.resultEl, resultPos(g));
    this.placeCroupier();
    this.boardCards.forEach((c, i) => place(c, boardPos(g, i)));
    const size = this.seats.length;
    this.seats.forEach((s, i) => {
      const p = seatPos(i, this.me, size, g);
      place(s.root, p);
      place(s.bet, betPos(p, g, i === this.me));
      // 我的下注按底边摆、往上长：筹码多了也不压到自己的底牌
      s.bet.classList.toggle('mine', i === this.me);
      // 别人的底牌放在头像朝桌子中间的那一侧，不压名牌
      const side = p.x > w / 2 + 1 ? 'right' : p.x < w / 2 - 1 ? 'left' : 'mid';
      s.root.classList.toggle('left', side === 'left');
      s.root.classList.toggle('right', side === 'right');
      const top = isTop(p, g);
      s.root.classList.toggle('top', top);
      // 顶上一排贴着左边的（6、7 人桌左上角）：动作标签放头像左边会出屏（0.3.1，线上 1280×800 实测），改放头像正上方
      s.root.classList.toggle('edge', top && p.x < 150);
    });
    if (this.frame) this.draw(this.frame);
  }

  /** 直接摆成这个视图（进桌、刷新、动画之后）；一手打完停着的，摆这一手的结果 */
  show(v: View): void {
    this.draw(frameOf(v));
  }

  /**
   * 播一步。prev / next 是这一步前后的视图，seat / action 是谁做了什么（系统的事是 null）。
   * 播完才 resolve：单机等动画播完，电脑才接着出手。
   */
  async play(prev: View, next: View, seat: number | null, action: Action | null): Promise<void> {
    // 画面出错（0.10.0 线上：全下的音效抛错）只记一笔、直接摆成结果：牌局永远不因为画面停住
    try {
      await this.animate(prev, next, seat, action);
    } catch (e) {
      console.error('texas: 这一步的动画出错，直接摆成结果', e);
    }
    this.show(next);
  }

  private async animate(prev: View, next: View, seat: number | null, action: Action | null): Promise<void> {
    const ended = prev.phase !== 'idle' && next.lastHand !== null && next.lastHand.handNo === prev.handNo;
    const fresh = next.phase !== 'idle' && (ended || prev.phase === 'idle' || next.handNo !== prev.handNo);
    const f = frameOf(prev);
    this.draw(f);

    // 1. 这一步的操作：冒一句话、推筹码或弃牌
    if (seat !== null && action && isBetting(action) && prev.seats[seat]?.status === 'active') {
      // 一手在这一步打完时，停着的视图（hold）里 log 还是这一手的；老的房间状态（不停）已经是下一手了，只能按动作说
      const log = ended && !next.hold ? null : (next.log.slice(prev.log.length).find((e) => e.seat === seat) ?? null);
      const put = ended ? putBy(prev, seat, action) : Math.max(0, next.seats[seat]!.total - prev.seats[seat]!.total);
      const s = f.seats[seat]!;
      const folded = log ? log.act === 'fold' : action.t === 'fold' || (action.t === 'timeout' && put === 0 && prev.currentBet > s.bet);
      s.tag = log ? tagOf(log) : tagFor(action, put, s.stack, s.bet + put);
      this.draw(f);
      this.pop(seat);
      // 电脑全下：按性格偶尔说一句
      if (log?.allin && s.owner === 'house' && seat !== this.me && log.act !== 'sb' && log.act !== 'bb') this.speak(seat, s.persona, prev.handNo, log.act === 'call' ? 'callAllin' : 'allin');
      if (folded) {
        play('fold');
        await this.muck(seat, f);
      } else if (put > 0) {
        play(log?.allin ? 'allin' : 'chip');
        // 全下（不算交盲注交到没钱）：桌子暗下去、聚光打在他身上（0.18.3）
        if (log?.allin && log.act !== 'sb' && log.act !== 'bb') spotlight(this.fx, this.seatPt(seat), this.opts.pace());
        await this.fly(chipNode(put), this.seatPt(seat), this.betPt(seat), MS.chip);
        s.stack -= put;
        s.bet += put;
        if (s.stack === 0) s.status = 'allin';
        this.draw(f);
      } else {
        play('check');
        await this.pause(MS.check);
      }
    } else if (seat !== null && action?.t === 'leave' && prev.seats[seat]?.status === 'active') {
      play('fold');
      await this.muck(seat, f);
    }

    if (ended) {
      // 停着的视图里 log 是这一手完整的；老的房间状态只能用上一步的（少最后一下，一般是跟注，不影响认诈唬）
      await this.finish(f, next.lastHand!, next.hold ? next.log : prev.log);
    } else if (next.board.length > prev.board.length) {
      // 2. 这一轮结束：收注，发公共牌
      await this.pause(MS.street * 0.4);
      await this.collect(f, next.pots);
      await this.dealBoard(f, next.board, prev.board.length);
    }

    // 3. 新的一手：先把上一手的结果收掉，再挪按钮、交盲注、一张张发底牌
    if (fresh) {
      await this.clear(ended ? null : f);
      await this.newHand(next);
    }
  }

  // ---------- 一手打完 ----------

  /** 收池、补发的公共牌、亮牌、分池；播完停在结果上（结果条、赢的五张），由下一手发牌时收 */
  private async finish(f: Frame, r: HandResult, log: readonly LogEntry[]): Promise<void> {
    await this.pause(MS.street * 0.4);
    // 没人跟的那部分这时还在他面前的下注里：先一起收进池子，再退回给他
    await this.collect(f, r.uncalled ? [...potsOf(r).slice(0, -1), (potsOf(r).at(-1) ?? 0) + r.uncalled.amount] : potsOf(r));
    // 全下后补发的公共牌：一张一张慢慢翻，最有看头
    if (r.board.length > f.board.length) await this.dealBoard(f, r.board, f.board.length, r.byFold ? 1 : 1.8);
    if (r.uncalled) {
      const u = r.uncalled;
      f.pots = shave(f.pots, u.amount);
      this.draw(f);
      await this.fly(chipNode(u.amount), potPos(this.g), this.seatPt(u.seat), MS.chip);
      f.seats[u.seat]!.stack += u.amount;
      this.draw(f);
    }
    const bluffs: number[] = [];
    if (!r.byFold) {
      // 亮牌：一家一家翻过来，标上牌型；最后下注的人只有高牌，是诈唬，标出来
      for (const sh of r.shown) {
        const s = f.seats[sh.seat]!;
        s.cards = [...sh.hole];
        s.hand = showName(log, sh);
        if (s.hand.endsWith('诈唬')) bluffs.push(sh.seat);
        this.draw(f);
        play('reveal');
        await this.pause(MS.reveal);
      }
    }
    // 结果条先出来、赢的五张亮起来，再一个池子一个池子分给赢的人
    f.result = r;
    this.draw(f);
    // 大池子（40 个大盲以上）收给赢家：筹码哗啦一串
    const big = r.pots.reduce((a, p) => a + p.amount, 0) >= 40 * f.bb;
    if (big) {
      play('bigpot');
      edgeGlow(this.fx, this.opts.pace());
    }
    for (const [k, pot] of r.pots.entries()) {
      await Promise.all(
        pot.winners.map(async (w) => {
          await this.fly(chipNode(w.won, 'big'), potPos(this.g), this.seatPt(w.seat), MS.potFly, 1, r.pots.length > 1 ? potName(k, r.pots.length) : '');
          f.seats[w.seat]!.stack += w.won;
          f.seats[w.seat]!.win = true;
        }),
      );
      f.pots = f.pots.slice(1);
      this.draw(f);
      if (k < r.pots.length - 1) await this.pause(MS.potGap);
    }
    f.pots = [];
    this.draw(f);
    const mine = r.pots.reduce((a, p) => a + (p.winners.find((x) => x.seat === this.me)?.won ?? 0), 0);
    if (mine > 0) play('win');
    // 摊牌我亮了牌却没赢到：轻轻两个往下的音（弃牌认输不响）
    else if (!r.byFold && r.shown.some((x) => x.seat === this.me)) play('lose');
    const winners = new Set(r.pots.flatMap((p) => p.winners.map((x) => x.seat)));
    for (const seat of winners) {
      // 赢家头像里迸出金币（0.18.3；大锅更多更远）
      coinBurst(this.fx, this.seatPt(seat), this.opts.pace(), big, isTop(this.seatPt(seat), this.g));
      this.float(seat, `+${chips(r.pots.reduce((a, p) => a + (p.winners.find((x) => x.seat === seat)?.won ?? 0), 0))}`);
    }
    this.afterHand(f, r, winners, bluffs, log);
  }

  /**
   * 一手打完电脑说一句（一手最多一句）：亮出来是诈唬的，被抓了、成了都有反应；
   * 下了注别人都弃了的，偶尔得意一句（不亮牌，说的话和他真拿的什么无关，不漏底牌）；赢了大池子的得意一句
   */
  private afterHand(f: Frame, r: HandResult, winners: Set<number>, bluffs: number[], log: readonly LogEntry[]): void {
    const house = (i: number): boolean => f.seats[i]?.owner === 'house' && i !== this.me;
    const b = bluffs.find(house);
    if (b !== undefined) return void this.speak(b, f.seats[b]!.persona, r.handNo, winners.has(b) ? 'bluffWon' : 'caught', true);
    const w = [...winners].find(house);
    if (w !== undefined) {
      const pot = r.pots.reduce((a, p) => a + p.amount, 0);
      const lastBet = log.findLast((e) => e.act === 'bet' || e.act === 'raise');
      if (r.byFold && lastBet?.seat === w && pot >= 10 * f.bb) return void this.speak(w, f.seats[w]!.persona, r.handNo, 'bluffWon');
      if (pot >= 40 * f.bb) return void this.speak(w, f.seats[w]!.persona, r.handNo, 'bigWin', true);
    }
    // 输了大池子：这一手投进去 ≥ 40 个大盲、又没赢的电脑，偶尔嘟囔一句
    const loser = [...putIn(log)].find(([s, v]) => v >= 40 * f.bb && !winners.has(s) && house(s));
    if (loser) this.speak(loser[0], f.seats[loser[0]]!.persona, r.handNo, 'bigLoss');
  }

  /** 头像旁边冒一句话，过一会儿自己消失 */
  private speak(seat: number, persona: number, handNo: number, m: Moment, must = false): void {
    if (this.opts.quiet?.() || this.opts.muted?.(seat)) return;
    const text = this.talk.line(seat, persona, handNo, m, must);
    if (!text) return;
    this.bubble(seat, text);
    this.opts.sticker?.(seat, stickerFor(persona, m));
  }

  /**
   * 催促炸弹（0.3.0 朋友们："谁出得慢就炸他"）：轮到的真人想了 8 秒以上，他头像旁边冒一个小炸弹，别人点了就对他扔。seat 为 null 收起。
   * 只是个按钮：不缩短他的计时、不碰规则
   */
  urge(seat: number | null, onClick: () => void): void {
    this.urgeEl?.remove();
    this.urgeEl = null;
    if (seat === null || seat === this.me || !this.seats[seat]) return;
    const p = this.seatPt(seat);
    const b = el('button', 'urge', this.root);
    b.type = 'button';
    b.title = '催他一下';
    b.setAttribute('aria-label', '催他一下');
    b.innerHTML = this.opts.bombIcon?.() ?? '';
    // 头像右上角（顶上的座位放右下，免得出画面）
    place(b, { x: p.x + 34, y: p.y + (isTop(p, this.g) ? 30 : -34) });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    this.urgeEl = b;
  }

  /** 被道具砸中（kit 的 onHit）：头像抖一下、缩一下 */
  hit(seat: number): void {
    // 被砸的那一下，这个人的动作气泡（"加注到 70"）先让开，不和番茄叠在一起
    const root = this.seats[seat]?.root;
    if (root) {
      root.classList.add('hit');
      window.clearTimeout(Number(root.dataset.hitTimer));
      root.dataset.hitTimer = String(window.setTimeout(() => root.classList.remove('hit'), 1_400));
    }
    const a = this.seats[seat]?.avatar;
    a?.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(.86) rotate(-8deg)' }, { transform: 'scale(1.04) rotate(6deg)' }, { transform: 'scale(1)' }],
      { duration: 420, easing: 'ease-out' },
    );
  }

  /**
   * 头像旁边冒一句话，过一会儿自己消失：电脑说话、好友房的嘲讽共用（0.3.0）。
   * 不挡点击（pointer-events: none）；我自己的放在头像左边，不压我的底牌和右下的操作区
   */
  bubble(seat: number, text: string, ms = 2_600): void {
    const p = this.seatPt(seat);
    // 同一个人上一句还没收：换成新的，不叠
    this.fx.querySelector(`.speech[data-seat="${seat}"]`)?.remove();
    const side = seat === this.me ? 'left' : isTop(p, this.g) ? 'below' : p.x < felt(this.g).cx ? 'right' : 'left';
    const e = el('div', `speech ${side}`, this.fx, text);
    e.dataset.seat = String(seat);
    play('taunt');
    place(
      e,
      // 两边的贴着名牌往里摆：头像上面要放赢了多少（float），旁边是亮出来的牌
      // 我自己的放在头像左上（0.6.1：原来和头像一样高，盖住左下角的"歇一手""嘲讽"）
      seat === this.me ? { x: p.x - 196, y: p.y - 30 } : side === 'below' ? { x: p.x, y: p.y + 92 } : { x: p.x + (side === 'right' ? 80 : -80), y: p.y + 58 },
    );
    window.setTimeout(() => e.remove(), ms * this.opts.pace());
  }

  /** 这个座位头像在屏幕上的位置（道具往这儿扔，0.3.0）；按实际画出来的算，横竖屏、9 人桌都对。空座位、没摆出来回 null */
  avatarRect(seat: number): DOMRect | null {
    const n = this.seats[seat];
    if (!n || n.root.classList.contains('empty')) return null;
    const r = n.avatar.getBoundingClientRect();
    return r.width > 0 ? r : null;
  }

  /**
   * 互动菜单、面板不许盖的地方（kit 的 TableFun 的 avoid，docs/table-fun.md 第 1 节）：我的底牌和操作区，屏幕矩形。
   * 0.13.0 起头像菜单是 kit 画的，这里只报位置
   */
  keepOut(): DOMRect[] {
    const mine = this.seats[this.me]?.cards.filter((c) => !c.classList.contains('hidden')) ?? [];
    const parts = [...mine, ...(this.root.parentElement?.querySelectorAll<HTMLElement>(KEEP_OUT) ?? [])];
    return parts.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  }

  /** 收掉桌上上一手的牌和结果（下一手发牌前）。f 为 null 时按现在摆着的收 */
  private async clear(f0: Frame | null): Promise<void> {
    const f = f0 ?? this.frame;
    if (!f) return;
    const out: Promise<void>[] = [];
    f.seats.forEach((s, i) => {
      if (s.cards.length) out.push(this.muck(i, f, true));
      s.hand = '';
      s.win = false;
      s.tag = '';
    });
    f.board.forEach((_, i) => out.push(this.flyFrom(this.boardCards[i]!, boardPos(this.g, i), this.deckPt(), MS.clear)));
    f.board = [];
    f.result = null;
    f.pots = [];
    this.draw(f);
    await Promise.all(out);
  }

  private async newHand(v: View): Promise<void> {
    const f = frameOf(v);
    // 先摆成"还没发牌、盲注还在面前"的样子
    const dealt = f.seats.map((s) => s.cards.length);
    const blinds = f.seats.map((s) => s.bet);
    for (const s of f.seats) {
      s.cards = [];
      s.stack += s.bet;
      s.bet = 0;
      s.tag = '';
    }
    this.draw(f);
    await this.pause(MS.blinds * 0.6);
    // 盲注
    const sb = v.log.find((e) => e.act === 'sb');
    const bb = v.log.find((e) => e.act === 'bb');
    await Promise.all(
      blinds.map(async (b, i) => {
        if (!b) return;
        await this.fly(chipNode(b), this.seatPt(i), this.betPt(i), MS.blinds);
        f.seats[i]!.stack -= b;
        f.seats[i]!.bet = b;
        f.seats[i]!.tag = i === sb?.seat ? `小盲 ${chips(b)}` : i === bb?.seat ? `大盲 ${chips(b)}` : '';
      }),
    );
    play('shuffle');
    if (blinds.some((b) => b > 0)) play('chip');
    this.draw(f);
    // 从按钮下家开始顺时针，一人一张发两圈；牌从庄家那里发出
    const size = f.seats.length;
    const order: number[] = [];
    for (let k = 1; k <= size; k++) {
      const i = (v.button + k) % size;
      if (dealt[i]) order.push(i);
    }
    const from = this.croupierAt ? this.deckPt() : buttonPos(this.seatPt(v.button), this.g, v.button === this.me);
    const target = frameOf(v);
    const flights: Promise<void>[] = [];
    let n = 0;
    // 发牌总时长按两圈 12 张封顶：9 人桌 18 张照 170 毫秒一张要 3 秒多（0.3.0 实打嫌一手太慢）
    const gap = MS.dealGap * Math.min(1, 12 / (order.length * 2));
    this.croupier.deal((gap * order.length * 2 + MS.dealFly) * this.opts.pace());
    for (let round = 0; round < 2; round++) {
      for (const i of order) {
        const delay = n++ * gap;
        flights.push(
          (async () => {
            await this.pause(delay);
            play('card');
            await this.fly(backNode(i === this.me ? 'mine' : 'small'), from, this.holePt(i, round), MS.dealFly);
            f.seats[i]!.cards = target.seats[i]!.cards.slice(0, round + 1).map((c) => (i === this.me ? null : c));
            this.draw(f);
          })(),
        );
      }
    }
    await Promise.all(flights);
    // 我的两张翻过来
    if (target.seats[this.me]?.cards.length) {
      play('flip');
      f.seats[this.me]!.cards = target.seats[this.me]!.cards;
      this.draw(f);
      await this.pause(MS.flip);
    }
  }

  // ---------- 小动画 ----------

  /** 这一轮的下注都推进池子；pots 是收完以后的主池、边池 */
  private async collect(f: Frame, pots: number[]): Promise<void> {
    const bets = f.seats.map((s, i) => [i, s.bet] as const).filter(([, b]) => b > 0);
    for (const s of f.seats) if (s.status !== 'folded') s.tag = '';
    if (!bets.length) {
      this.draw(f);
      return;
    }
    for (const [i] of bets) f.seats[i]!.bet = 0;
    this.draw(f);
    play('collect');
    await Promise.all(bets.map(([i, b]) => this.fly(chipNode(b), this.betPt(i), potPos(this.g), MS.collect)));
    f.pots = pots.length ? [...pots] : [f.pots.reduce((a, x) => a + x, 0) + bets.reduce((a, [, b]) => a + b, 0)];
    this.draw(f);
    bump(this.potEl);
  }

  /** 翻牌三张依次翻，转牌、河牌前停一下；slow 是全下后补发时放慢的倍数 */
  private async dealBoard(f: Frame, board: Card[], from: number, slow = 1): Promise<void> {
    for (let i = from; i < board.length; i++) {
      await this.pause((i < 3 ? (i === from ? MS.street * 0.5 : MS.flopGap) : MS.street) * slow);
      play('card');
      this.croupier.deal(MS.boardFly * this.opts.pace());
      await this.fly(backNode('board'), this.deckPt(), boardPos(this.g, i), MS.boardFly);
      f.board = board.slice(0, i + 1);
      this.draw(f);
      play('flip');
      flipIn(this.boardCards[i]!, MS.flip * this.opts.pace());
    }
    await this.pause(MS.flip + 120);
  }

  /** 弃牌：牌飞回牌堆 */
  private async muck(seat: number, f: Frame, quiet = false): Promise<void> {
    const s = f.seats[seat]!;
    const n = s.cards.length;
    if (!n) return;
    s.cards = [];
    if (!quiet) s.status = 'folded';
    this.draw(f);
    const flights = [];
    for (let k = 0; k < n; k++) flights.push(this.fly(backNode(seat === this.me ? 'mine' : 'small'), this.holePt(seat, k), this.deckPt(), MS.muck, 0.4));
    await Promise.all(flights);
  }

  /** 这个座位刚做的事：气泡弹一下（之后缩成小标签挂着） */
  private pop(seat: number): void {
    const b = this.seats[seat]?.bubble;
    if (!b) return;
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
  }

  private float(seat: number, text: string): void {
    const p = this.seatPt(seat);
    // 顶上一排：赢数写在自己名牌的名字那一行，停一会儿换回名字。头顶放会被屏幕上沿裁掉、压住标题（0.3.0 实打），
    // 压在头像下沿又挡住名字（0.3.1），两边是邻座的牌和名牌（9 人桌只隔 190 个单位），没有空地方飘
    const n = this.seats[seat];
    if (seat !== this.me && p.y < 110 && n) {
      this.won.set(seat, text);
      setText(n.name, text);
      n.name.classList.add('won');
      window.setTimeout(() => {
        this.won.delete(seat);
        n.name.classList.remove('won');
        setText(n.name, n.name.dataset.real ?? '');
      }, 2_400 * this.opts.pace());
      return;
    }
    const e = el('div', 'float', this.fx, text);
    // 我的赢数放在名牌右边：头顶是我的两张底牌，白底上看不清
    place(e, seat === this.me ? { x: p.x + 130, y: p.y + 18 } : { x: p.x, y: p.y - 40 });
    e.animate([{ transform: 'translate(-50%, 0)', opacity: 0 }, { transform: 'translate(-50%, -14px)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%, -34px)', opacity: 0 }], {
      duration: 2400 * this.opts.pace(),
      easing: 'ease-out',
    }).finished.then(() => e.remove(), () => e.remove());
  }

  private pause(ms: number): Promise<void> {
    const t = ms * this.opts.pace();
    return t <= 0 ? Promise.resolve() : new Promise((ok) => window.setTimeout(ok, t));
  }

  /** 一个临时节点从 a 飞到 b（舞台坐标），落地后删掉；label 是跟着飞的小字（"主池"） */
  private async fly(node: HTMLElement, a: Pt, b: Pt, ms: number, fade = 1, label = ''): Promise<void> {
    if (label) el('span', 'fly-label', node, label);
    this.fx.appendChild(node);
    place(node, a);
    const d = ms * this.opts.pace();
    if (d > 0) {
      const anim = node.animate(
        [
          { transform: 'translate(-50%, -50%) translate(0, 0)', opacity: 1 },
          { transform: `translate(-50%, -50%) translate(${b.x - a.x}px, ${b.y - a.y}px)`, opacity: fade },
        ],
        { duration: d, easing: 'cubic-bezier(.25,.75,.35,1)', fill: 'forwards' },
      );
      // 兜底：动画没按时结束（被挂起、浏览器没推进时间线）也最多多等 500 ms，不让牌局等一个永远不来的 finished
      await Promise.race([anim.finished.catch(() => {}), new Promise<void>((ok) => window.setTimeout(ok, d + 500))]);
    }
    node.remove();
  }

  /** 让一张已经摆着的牌飞走（收牌）：先藏起原来的，用一个牌背代替飞 */
  private flyFrom(card: HTMLElement, a: Pt, b: Pt, ms: number): Promise<void> {
    card.classList.add('gone');
    return this.fly(backNode('board'), a, b, ms, 0.3).then(() => card.classList.remove('gone'));
  }

  // ---------- 位置 ----------

  /** 牌从哪里发出、收回哪里：荷官的右手（dealer.ts 的画法，缩到 0.8 后手在桌边上方 15、右边 15），没有荷官就是桌心 */
  private deckPt(): Pt {
    const d = this.croupierAt;
    return d ? { x: d.x + 15, y: d.y - 15 } : deckPos(this.g);
  }

  /**
   * 荷官站哪：layout 给的几个点里挑第一个不碰顶栏的（顶栏左边的字随玩法变长短，按实际位置量）；都碰就不出现。
   * 摆座位时、顶栏的字变了时（setMark 跟着 drawTop 来）各挑一次
   */
  private placeCroupier(): void {
    const bar = [...(this.root.closest('.stage')?.querySelectorAll('.topbar > :not(.spacer)') ?? [])]
      .map((e) => e.getBoundingClientRect())
      .filter((b) => b.width > 0);
    this.croupierAt = null;
    for (const p of dealerSpots(this.g, this.seats.length)) {
      this.croupier.place(p);
      const r = this.croupier.root.getBoundingClientRect();
      // 没显示（标题页时牌桌是藏着的）量不出来：先按第一个点摆着，进桌后顶栏一变会再挑
      if (r.width === 0 || bar.every((b) => b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom)) {
        this.croupierAt = p;
        return;
      }
    }
    this.croupier.place(null);
  }

  private seatPt(i: number): Pt {
    return seatPos(i, this.me, this.seats.length, this.g);
  }
  private betPt(i: number): Pt {
    return betPos(this.seatPt(i), this.g, i === this.me);
  }
  /** 底牌第 k 张的中心（和 style.css 里 .hole 的摆法对上） */
  private holePt(i: number, k: number): Pt {
    const p = this.seatPt(i);
    if (i === this.me) return { x: p.x + (k ? 36 : -36), y: p.y - 46 };
    const side = p.x > this.g.w / 2 + 1 ? -1 : 1;
    return { x: p.x + side * 54 + (k ? 8 : -8), y: p.y - 6 };
  }

  /**
   * 看对手（0.2.2）：点名牌弹一张小卡，名字、风格、这一场的数；放在座位往桌心那一侧，点别处或 5 秒后收起。
   * tag 是按这一场的数给的标签，电脑再加上它的性格那一句。0.13.0 起点头像是 kit 的互动菜单，这张卡只放数（DESIGN.md 13.7）
   */
  showCard(seat: number, tag: string, rows: string[]): void {
    this.hideCard();
    const s = this.frame?.seats[seat];
    if (!s || s.owner === 'none' || seat === this.me) return;
    const card = el('div', 'read-card', this.root);
    el('div', 'rc-name', card, this.nameOf(seat, s));
    if (s.owner === 'house') el('div', 'rc-style', card, personaStyle(s.persona));
    el('div', 'rc-tag', card, tag);
    for (const r of rows) el('div', 'rc-row', card, r);
    // 贴着座位朝桌心那一边摆，不盖住这个人自己的头像和名字：顶上的往下，两边的往里
    const p = this.seatPt(seat);
    const side = isTop(p, this.g) ? 'below' : p.x < felt(this.g).cx ? 'right' : 'left';
    card.classList.add(side);
    place(card, side === 'below' ? { x: p.x, y: p.y + 100 } : { x: p.x + (side === 'right' ? 80 : -80), y: p.y });
    this.clearOf(card);
    this.card = card;
    this.cardTimer = window.setTimeout(() => this.hideCard(), 5_000);
    // 下一次点哪里都收起（这一次的点击已经冒泡完了）
    window.setTimeout(() => window.addEventListener('pointerdown', () => this.hideCard(), { once: true }), 0);
  }

  /** 卡片不许盖操作按钮、加注那一行和预选（规范 1 节）：压到了就整张往上挪，挪到舞台顶为止 */
  private clearOf(card: HTMLElement): void {
    const r = card.getBoundingClientRect();
    if (!r.height) return;
    const k = r.height / card.offsetHeight || 1;
    let lift = 0;
    for (const e of this.root.parentElement?.querySelectorAll<HTMLElement>(KEEP_OUT) ?? []) {
      const o = e.getBoundingClientRect();
      if (!o.height || o.right < r.left || o.left > r.right || o.bottom < r.top || o.top > r.bottom) continue;
      lift = Math.max(lift, r.bottom - o.top + 8 * k);
    }
    const top = this.root.getBoundingClientRect().top;
    lift = Math.min(lift, r.top - top - 8 * k);
    if (lift > 0) card.style.top = `${parseFloat(card.style.top) - lift / k}px`;
  }

  hideCard(): void {
    window.clearTimeout(this.cardTimer);
    this.card?.remove();
    this.card = null;
  }

  private nameOf(i: number, s: SeatFrame): string {
    const who = this.people?.[i];
    if (i === this.me && (s.owner === 'player' || who?.name)) return '你';
    return who?.name ?? (s.owner === 'house' ? personaName(s.persona) : '空位');
  }

  // ---------- 摆出来 ----------

  private makeSeat(i: number): SeatNodes {
    const mine = i === this.me;
    const root = el('div', `seat${mine ? ' me' : ''}`, this.root);
    root.dataset.seat = String(i);
    const hole = el('div', 'hole', root);
    const cards = [makeCard(mine ? 'mine' : 'small'), makeCard(mine ? 'mine' : 'small')];
    for (const c of cards) hole.appendChild(c);
    const avatar = el('div', 'avatar', root);
    const plate = el('div', 'plate', root);
    const name = el('span', 'name', plate);
    const stack = el('span', 'stack', plate);
    const badge = el('span', 'badge', root);
    const hand = el('span', 'hand', root);
    const bubble = el('div', 'bubble', root);
    const clock = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    clock.setAttribute('class', 'clock');
    clock.setAttribute('viewBox', '0 0 72 72');
    clock.innerHTML = `<circle cx="36" cy="36" r="34" stroke-dasharray="${CLOCK_LEN}"/>`;
    root.appendChild(clock);
    root.addEventListener('click', () => this.opts.onSeat?.(i));
    const bet = el('div', 'bet', this.root);
    const betChips = el('span', 'bet-chips', bet);
    const betAmt = el('span', 'bet-amt', bet);
    return { root, avatar, plate, name, stack, hole, cards, bubble, badge, clock, hand, bet, betChips, betAmt, look: -2, shown: null, tween: 0 };
  }

  private draw(f: Frame): void {
    this.frame = f;
    this.drawPot(f.pots);
    this.boardCards.forEach((c, i) => {
      const card = f.board[i];
      toggle(c, 'hidden', card === undefined);
      if (card !== undefined) setCard(c, card);
    });
    const b = f.button >= 0 && f.button < this.seats.length ? f.button : -1;
    toggle(this.dealer, 'hidden', b < 0);
    if (b >= 0) place(this.dealer, buttonPos(this.seatPt(b), this.g, b === this.me));
    f.seats.forEach((s, i) => this.drawSeat(this.seats[i]!, s, i, f));
    this.drawResult(f);
  }

  private drawPot(pots: number[]): void {
    const total = pots.reduce((a, x) => a + x, 0);
    toggle(this.potEl, 'empty', total === 0);
    const key = pots.join(',');
    if (this.potEl.dataset.k === key) return;
    this.potEl.dataset.k = key;
    this.potMain.innerHTML = total ? `<span class="pile">${chipPile(total)}</span><span class="pot-label">底池</span><b>${chips(total)}</b>` : '';
    // 有边池时分开写：主池、边池（一、二……）
    this.potSides.innerHTML = pots.length > 1 ? pots.map((x, k) => `<span class="side">${potName(k, pots.length)} <b>${chips(x)}</b></span>`).join('') : '';
  }

  /** 结果条：一手打完停着时，谁赢了多少、什么牌；分池时每个池子一行 */
  private drawResult(f: Frame): void {
    const r = f.result;
    toggle(this.root, 'showdown', !!r && !r.byFold);
    for (const c of this.root.querySelectorAll('.best')) c.classList.remove('best');
    if (!r) {
      this.resultEl.classList.remove('on', 'mine');
      this.resultEl.dataset.k = '';
      return;
    }
    const key = `${r.handNo}`;
    if (this.resultEl.dataset.k !== key) {
      this.resultEl.dataset.k = key;
      const lines = resultLines(r, (i) => this.nameOf(i, f.seats[i]!), this.me);
      // 赢家横幅（0.10.0）：左边圆框里是赢家的头像（分池、平分时放第一个池子的第一个赢家）
      const face = this.seats[r.pots[0]?.winners[0]?.seat ?? -1]?.avatar.innerHTML ?? '';
      this.resultEl.innerHTML = (face ? `<span class="r-face">${face}</span>` : '') + `<div class="r-lines">${lines.map((l) => `<div class="r-line${l.mine ? ' mine' : ''}">${l.html}</div>`).join('')}</div>`;
      toggle(this.resultEl, 'mine', lines.some((l) => l.mine));
      this.resultEl.classList.remove('on');
      void this.resultEl.offsetWidth;
      this.resultEl.classList.add('on');
    }
    // 摊牌赢的那五张亮起来，其余变暗
    if (r.byFold) return;
    const best = new Set<Card>();
    for (const pot of r.pots) {
      for (const w of pot.winners) {
        const sh = r.shown.find((s) => s.seat === w.seat);
        if (sh) for (const c of bestFive([...sh.hole, ...r.board])) best.add(c);
      }
    }
    this.boardCards.forEach((c, i) => toggle(c, 'best', best.has(f.board[i]!)));
    this.seats.forEach((n, i) => n.cards.forEach((c, k) => toggle(c, 'best', best.has(f.seats[i]!.cards[k] as Card))));
  }

  private drawSeat(n: SeatNodes, s: SeatFrame, i: number, f: Frame): void {
    const mine = i === this.me;
    const who = this.people?.[i];
    // 好友房里坐下了、买入还没到账的真人也不算空位
    const empty = s.owner === 'none' && !who?.name;
    const human = s.owner === 'player' || !!who?.name;
    toggle(n.root, 'empty', empty);
    // 头像：电脑按性格；我；好友房里别的真人用我的脸换座位的底色（look 记成 100 + 座位）
    const look = empty ? -1 : mine && human ? ME_LOOK : human ? 100 + i : s.persona;
    if (n.look !== look) {
      n.look = look;
      n.avatar.innerHTML = look < 0 ? '' : look >= 100 ? avatarSvg(ME_LOOK, HUMAN_BG[i % HUMAN_BG.length]) : avatarSvg(look);
    }
    const name = empty ? '空位' : (who?.name ?? (mine ? this.opts.myName() : personaName(s.persona)));
    n.name.dataset.real = name;
    setText(n.name, this.won.get(i) ?? name);
    toggle(n.root, 'takeable', who?.takeable === true);
    const allin = s.status === 'allin';
    this.drawStack(n, empty ? null : s.stack, allin);
    toggle(n.root, 'allin', allin);
    toggle(n.root, 'folded', s.status === 'folded');
    toggle(n.root, 'acting', f.toAct === i);
    toggle(n.root, 'win', s.win);
    toggle(n.root, 'house', s.owner === 'house');
    const badge = who?.tag ?? (s.away ? '暂离' : s.leaving ? '离桌' : !empty && s.stack === 0 && s.status === 'out' ? '没筹码' : '');
    setText(n.badge, badge);
    toggle(n.badge, 'on', badge !== '');
    // 这一轮做了什么：挂在头像上方（我的在底牌右边）
    setText(n.bubble, s.tag);
    toggle(n.bubble, 'on', s.tag !== '');
    toggle(n.bubble, 'fold', s.tag === '弃牌');
    // 翻牌后我在这一手里：底牌旁边显示现在凑成的牌；摊牌时换成摊牌的牌型
    const live =
      mine && !s.hand && f.board.length >= 3 && (s.status === 'active' || s.status === 'allin') && s.cards.length === 2 && s.cards.every((c) => c !== null)
        ? madeHand([...(s.cards as Card[]), ...f.board])
        : '';
    setText(n.hand, s.hand || live);
    toggle(n.hand, 'on', (s.hand || live) !== '');
    toggle(n.hand, 'live', live !== '');
    toggle(n.hand, 'bluff', s.hand.endsWith('诈唬'));
    n.cards.forEach((c, k) => {
      const card = s.cards[k];
      toggle(c, 'hidden', card === undefined);
      if (card !== undefined) setCard(c, card);
    });
    toggle(n.bet, 'hidden', s.bet === 0);
    if (s.bet > 0) {
      setText(n.betAmt, chips(s.bet));
      const key = `${s.bet}`;
      if (n.betChips.dataset.k !== key) {
        n.betChips.dataset.k = key;
        n.betChips.innerHTML = chipPile(s.bet);
      }
    }
  }

  /** 名牌上的数：变了就跳着走过去（涨绿跌红闪一下），全下时写"全下" */
  private drawStack(n: SeatNodes, value: number | null, allin: boolean): void {
    if (value === null) {
      n.shown = null;
      setText(n.stack, '');
      return;
    }
    if (allin && value === 0) {
      n.shown = 0;
      setText(n.stack, '全下');
      return;
    }
    const from = n.shown;
    n.shown = value;
    if (from === null || from === value || this.opts.pace() < 0.5) {
      setText(n.stack, chips(value));
      return;
    }
    toggle(n.plate, 'up', value > from);
    toggle(n.plate, 'down', value < from);
    const id = ++n.tween;
    const t0 = performance.now();
    const dur = 520 * this.opts.pace();
    const tick = (now: number): void => {
      if (n.tween !== id) return;
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      setText(n.stack, chips(Math.round(from + (value - from) * e)));
      if (k < 1) requestAnimationFrame(tick);
      else window.setTimeout(() => n.tween === id && n.plate.classList.remove('up', 'down'), 300);
    };
    requestAnimationFrame(tick);
  }
}

// ---------- 视图 → 画面 ----------

function frameOf(v: View): Frame {
  // 一手打完停着：摆这一手的结尾（公共牌、亮出的牌、谁赢了），筹码已经分完
  const r = v.hold ? v.lastHand : null;
  const tags = r ? [] : tagsOf(v);
  return {
    handNo: v.handNo,
    board: r ? [...r.board] : [...v.board],
    pots: r ? [] : [...v.pots],
    button: v.phase === 'idle' && v.handNo === 0 ? -1 : v.button,
    toAct: v.toAct,
    bb: v.bb,
    seats: v.seats.map((s, i) => {
      const sh = r?.shown.find((x) => x.seat === i);
      return {
        owner: s.owner,
        persona: s.persona,
        stack: s.stack,
        bet: s.bet,
        status: s.status,
        away: s.away,
        leaving: s.leaving,
        cards: sh ? [...sh.hole] : s.status === 'active' || s.status === 'allin' ? (i === v.me && v.hole.length ? [...v.hole] : [null, null]) : [],
        hand: sh && !r!.byFold ? showName(v.log, sh) : '',
        win: !!r?.pots.some((p) => p.winners.some((w) => w.seat === i)),
        tag: tags[i] ?? (s.status === 'folded' ? '弃牌' : ''),
      };
    }),
    result: r,
  };
}

/** 每个座位这一轮最后做的事（log 里最后一次发公共牌之后的） */
function tagsOf(v: View): string[] {
  const out: string[] = [];
  let start = 0;
  v.log.forEach((e, k) => {
    if (e.seat < 0) start = k + 1;
  });
  for (const e of v.log.slice(start)) if (e.seat >= 0) out[e.seat] = tagOf(e);
  return out;
}

/** 一条记录说成一句短话："跟注 40""加注到 120""全下 1,840" */
/** 摊牌亮出来的牌型；最后下注的人只有高牌，后面标"诈唬" */
function showName(log: readonly LogEntry[], sh: HandResult['shown'][number]): string {
  return handName(sh.value) + (bluffer(log, sh.seat, categoryOf(sh.value)) ? ' · 诈唬' : '');
}

function tagOf(e: LogEntry): string {
  const amt = chips(e.amount);
  if (e.allin && e.act !== 'sb' && e.act !== 'bb') return `全下`;
  switch (e.act) {
    case 'fold':
      return e.auto ? '超时弃牌' : '弃牌';
    case 'check':
      return e.auto ? '超时过牌' : '过牌';
    case 'call':
      return `跟注 ${amt}`;
    case 'bet':
      return `下注 ${amt}`;
    case 'raise':
      return `加注到 ${amt}`;
    case 'sb':
      return `小盲 ${amt}`;
    case 'bb':
      return `大盲 ${amt}`;
    default:
      return '';
  }
}

/** 一手在这一步就结束时没有这一步的记录（之后的视图已经是结果了）：按动作说 */
function tagFor(a: Action, put: number, stack: number, to: number): string {
  if (put > 0 && put >= stack) return '全下';
  switch (a.t) {
    case 'fold':
      return '弃牌';
    case 'check':
      return '过牌';
    case 'call':
      return `跟注 ${chips(put)}`;
    case 'raise':
      return `加注到 ${chips(to)}`;
    case 'timeout':
      return put ? '' : '超时';
    default:
      return '';
  }
}

/** 第几个池子叫什么：主池、边池（只有一个时）或边池一、边池二……（不用数字：挨着金额会读成"1 600"） */
const potName = (k: number, n: number): string => (k === 0 ? '主池' : n <= 2 ? '边池' : `边池${'一二三四五六七八'[k - 1] ?? k}`);

/** 一手的结果分成几行字（结果条）：只有一个池子时一行，分池时每个池子一行 */
export function resultLines(r: HandResult, name: (seat: number) => string, me: number): { html: string; mine: boolean }[] {
  const val = (seat: number): string => {
    const sh = r.shown.find((x) => x.seat === seat);
    return sh ? handName(sh.value) : '';
  };
  const who = (seats: number[]): string => seats.map((s) => esc(name(s))).join('、');
  if (r.byFold) {
    const w = r.pots[0]!.winners[0]!;
    return [{ html: `大家都弃牌，<b>${who([w.seat])}</b> 拿下 <em>${chips(w.won)}</em>`, mine: w.seat === me }];
  }
  // 几个池子都是同一拨人赢的：并成一行写总数（"主池 3,850 稳哥赢 3,850、边池 600 稳哥赢 600"读着啰嗦）
  const key = (p: HandResult['pots'][number]): string => p.winners.map((w) => w.seat).join(',');
  const pots = r.pots.every((p) => key(p) === key(r.pots[0]!))
    ? [{ amount: r.pots.reduce((a, p) => a + p.amount, 0), winners: r.pots[0]!.winners.map((w) => ({ ...w, won: r.pots.reduce((a, p) => a + (p.winners.find((x) => x.seat === w.seat)?.won ?? 0), 0) })) }]
    : r.pots;
  return pots.map((p, k) => {
    const seats = p.winners.map((w) => w.seat);
    const mine = seats.includes(me);
    const head = pots.length > 1 ? `<span class="r-pot">${potName(k, pots.length)} ${chips(p.amount)}</span> ` : '';
    const hand = val(seats[0]!);
    if (seats.length > 1) return { html: `${head}平分：<b>${who(seats)}</b> 各 <em>${chips(p.winners[0]!.won)}</em>${hand ? ` · ${hand}` : ''}`, mine };
    if (mine && pots.length === 1) return { html: `你赢了 <em>+${chips(p.winners[0]!.won)}</em>${hand ? ` · ${hand}` : ''}`, mine };
    return { html: `${head}<b>${who(seats)}</b>${hand ? ` ${hand}` : ''} 赢 <em>${chips(p.winners[0]!.won)}</em>`, mine };
  });
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 这一手结果里各个池子的数（收池动画收完以后应该是这些） */
const potsOf = (r: HandResult): number[] => r.pots.map((p) => p.amount);

/** 没人跟的那部分从最后一个池子里退回 */
function shave(pots: number[], amount: number): number[] {
  const out = [...pots];
  for (let k = out.length - 1; k >= 0 && amount > 0; k--) {
    const d = Math.min(out[k]!, amount);
    out[k]! -= d;
    amount -= d;
  }
  return out.filter((x) => x > 0);
}

/** 倒计时圈的周长（半径 34） */
const CLOCK_LEN = 214;

const isBetting = (a: Action): boolean => ['fold', 'check', 'call', 'raise', 'allin', 'timeout'].includes(a.t);

/** 一手在这一步结束时，这个座位这一步投了多少（之后的视图已经是结果了，只能按之前的视图算） */
function putBy(v: View, seat: number, a: Action): number {
  const s = v.seats[seat]!;
  const toCall = Math.min(s.stack, Math.max(0, v.currentBet - s.bet));
  switch (a.t) {
    case 'call':
      return toCall;
    case 'raise':
      return Math.min(s.stack, a.to - s.bet);
    case 'allin':
      return s.stack;
    default:
      return 0;
  }
}

/** 7 张里组成最大牌型的那 5 张（只用来高亮，21 种组合挨个比） */
function bestFive(cards: Card[]): Card[] {
  let best = -1;
  let pick: Card[] = [];
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) {
      const five = cards.filter((_, i) => i !== a && i !== b);
      if (five.length !== 5) continue;
      const v = evalCards(five);
      if (v > best) {
        best = v;
        pick = five;
      }
    }
  return pick;
}

function place(e: HTMLElement, p: Pt): void {
  e.style.left = `${p.x}px`;
  e.style.top = `${p.y}px`;
}

function chipNode(amount: number, cls = ''): HTMLElement {
  const d = document.createElement('div');
  d.className = `fly-chips ${cls}`;
  d.innerHTML = chipPile(amount);
  return d;
}

function backNode(cls: string): HTMLElement {
  const c = makeCard(`${cls} fly`);
  setCard(c, null);
  return c;
}

function flipIn(c: HTMLElement, ms: number): void {
  c.animate([{ transform: 'translate(-50%, -50%) rotateY(180deg)' }, { transform: 'translate(-50%, -50%) rotateY(0deg)' }], {
    duration: ms,
    easing: 'ease-out',
  });
}

/** 池子收进筹码时鼓一下 */
function bump(e: HTMLElement): void {
  e.animate([{ transform: 'translate(-50%, -50%) scale(1)' }, { transform: 'translate(-50%, -50%) scale(1.12)' }, { transform: 'translate(-50%, -50%) scale(1)' }], { duration: 300 });
}
