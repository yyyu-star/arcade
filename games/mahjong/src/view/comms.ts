/**
 * 牌桌上的交流（DESIGN.md 第 6 节），单机和好友房同一套：短语（可以点名）、表情包、扔道具、顺手提示、催促炸弹、名场面横幅，
 * 设置里有总开关、屏蔽所有人、按人屏蔽（真人、电脑都能屏蔽）。
 * 编号见 game/emotes.ts；表情包和道具直接用 arcade-kit/fun（kit 0.7.0），不自己画。所有人一样、免费，不挂筹码，不影响对局：
 * 不停计时、不盖牌和按钮（图层点击穿透），牌局也不读这里的任何东西。
 */
import { createFunLayer, playFunSound, PROPS, propSvg, showSticker, STICKERS, stickerSvg, throwAt, type FunLayer, type RectLike } from 'arcade-kit/fun';
import { COOL_PROP_MS, COOL_TALK_MS, FunTally } from '../game/banter.ts';
import { PHRASE_COUNT, PROP_BASE, PROP_COUNT, STICKER_BASE, STICKER_COUNT } from '../game/emotes.ts';
import './comms.css';
import { dialogHooks } from './dialog.ts';
import { button, el } from './dom.ts';
import { audioOut, play } from './sound.ts';
import { PHRASES } from './text.ts';

/** 屏蔽所有人（只是自己不看，别人照样看得到你发的） */
export const MUTE_KEY = 'mahjong.mute';
/** 总开关：关了就什么都不显示、不提示，自己也不发 */
export const OFF_KEY = 'mahjong.comms';
/** 按人屏蔽（sessionStorage，存名字：只在这个标签页里、这一桌的人有效，关页面就清） */
export const BLOCK_KEY = 'mahjong.block';
/** 第一次进牌桌的提示出过了 */
export const HINT_KEY = 'mahjong.hint.fun';
/** 头像菜单里的三句点名短语（PHRASES 的下标）：又点炮了哇、快点嘛、好牌服了 */
const MENU_PHRASES = [3, 7, 12];
/** 善意的道具：命中冒爱心或星星，不留污渍 */
const KIND_PROPS = new Set<string>(['rose', 'like', 'cheers']);
const HINT_SHOW_MS = 3_000;
/** 轮到的人想了这么久，别人才能扔催促炸弹（纯画面，不缩计时） */
export const URGE_AFTER_MS = 8_000;
const BOMB = PROP_BASE + PROPS.indexOf('bomb');
/** 顺手提示留多久 */
const HINT_MS = 12_000;
/** 名场面横幅留多久 */
const BANNER_MS = 2_400;

/** 牌桌那边要给的：头像在哪、冒气泡、自己是几号 */
export interface CommsHost {
  me(): number | null;
  avatarRect(seat: number): DOMRect;
  avatarEl(seat: number): HTMLElement | null;
  bubble(seat: number, text: string): void;
  /** 这个座位有人（能当对象） */
  occupied(seat: number): boolean;
  /** 这个座位是电脑（首次提示挑电脑头像；没给就挑任意别人） */
  isBot?(seat: number): boolean;
}

/** 牌局里刚发生的公开的事（顺手提示用） */
export type CommsEvent = { e: 'hu'; seat: number; from: number | null } | { e: 'kan'; seat: number };

export class Comms {
  private readonly layer: FunLayer;
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly host: CommsHost;
  private readonly send: (id: number, to?: number) => void;
  private muted: boolean;
  private off: boolean;
  private tab: 'phrase' | 'sticker' | 'prop' | 'set' = 'phrase';
  /** 短语点名冲着谁（undefined 是对大家说） */
  private phraseTo: number | undefined;
  /** 道具页先选的人 */
  private propTo: number | null = null;
  private hints: number[] = [];
  private hintAt = 0;
  private urgeTimer = 0;
  private urgeKey = '';
  /** 扔道具的画面账：目标保护、连击、回敬 */
  private readonly tally = new FunTally();
  /** 自己的冷却到几点（道具、表情和短语分开算） */
  private propUntil = 0;
  private talkUntil = 0;
  /** 头像旁的菜单（挂在 body 上，用屏幕坐标：舞台是缩放的，菜单字号不跟着缩） */
  private menu: HTMLElement | null = null;
  private menuSeat = -1;
  private closedSeat = -1;
  private closedAt = 0;
  private readonly timers = new Set<number>();
  private readonly onOutside = (e: Event): void => {
    if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu(true);
  };
  private readonly onResize = (): void => this.closeMenu();

  constructor(parent: HTMLElement, host: CommsHost, send: (id: number, to?: number) => void) {
    this.host = host;
    this.send = send;
    this.muted = readFlag(MUTE_KEY);
    this.off = readFlag(OFF_KEY);
    this.layer = createFunLayer();
    // 弹窗在舞台里（带缩放的层叠上下文），z-index 夹不到中间：开弹窗时把好玩图层藏起来
    dialogHooks({
      open: () => {
        this.layer.hide();
        this.closeMenu();
      },
      close: () => this.layer.show(),
    });
    this.root = el('div', 'comms', parent);
    const btn = button('comms-btn', this.root, '', () => this.toggle());
    btn.setAttribute('aria-label', '互动');
    btn.innerHTML = `${SMILE}<span>互动</span>`;
    this.root.classList.toggle('off', this.off);
    this.panel = el('div', 'comms-panel', this.root);
    this.panel.hidden = true;
    window.addEventListener('resize', this.onResize);
    this.later(() => this.firstHint(0), 1_500);
  }

  destroy(): void {
    window.clearTimeout(this.urgeTimer);
    for (const t of this.timers) window.clearTimeout(t);
    this.timers.clear();
    this.closeMenu();
    window.removeEventListener('resize', this.onResize);
    document.querySelector('.fun-hint')?.remove();
    dialogHooks({ open() {}, close() {} });
    this.layer.destroy();
    this.root.remove();
    document.querySelector('.urge')?.remove();
  }

  /** 房间转发来的（含自己发的；单机是自己和电脑发的） */
  receive(seat: number, id: number, to?: number): void {
    if (!this.shows(seat)) return;
    if (id < PHRASE_COUNT) {
      if (to === undefined) return this.host.bubble(seat, PHRASES[id]!);
      // 点名：气泡里带上对象，对象的头像晃一下
      this.host.bubble(seat, `@${this.nameOf(to)} ${PHRASES[id]!}`);
      this.host.avatarEl(to)?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 300, delay: 200 });
      return;
    }
    if (id < STICKER_BASE + STICKER_COUNT) {
      play('emote');
      void showSticker(this.layer, this.host.avatarRect(seat), STICKERS[id - STICKER_BASE]!);
      return;
    }
    if (id < PROP_BASE + PROP_COUNT && to !== undefined) this.throwProp(seat, id, to);
  }

  private throwProp(from: number, id: number, to: number): void {
    const prop = PROPS[id - PROP_BASE]!;
    const info = this.tally.hit(from, to, Date.now());
    // 目标保护：10 秒里被打中太多次，多的不播，只在头像上闪一下护盾
    if (info.shield) return this.shield(to);
    void throwAt(this.layer, this.host.avatarRect(from), this.host.avatarRect(to), prop, {
      target: to,
      sound: (p, phase) => {
        const a = audioOut();
        if (a) playFunSound(a.ctx, a.out, p, phase);
      },
      onHit: () => {
        const av = this.host.avatarEl(to);
        av?.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.86) rotate(-6deg)' }, { transform: 'scale(1)' }], { duration: 320 });
        const r = this.host.avatarRect(to);
        if (KIND_PROPS.has(prop)) this.sparkle(r, prop === 'rose' ? '♥' : '★');
        if (info.revenge) this.pop(r, '回敬！', 'back', 0, -6);
        if (info.combo >= 2) this.pop(r, `×${info.combo}`, 'combo', r.width * 0.55, r.height * 0.4);
      },
    });
  }

  /** 头像上闪一个护盾 */
  private shield(seat: number): void {
    const r = this.host.avatarRect(seat);
    const d = el('div', 'fx-shield', this.layer.el);
    d.style.left = `${r.left + r.width / 2}px`;
    d.style.top = `${r.top + r.height / 2}px`;
    d.style.width = d.style.height = `${r.width * 1.25}px`;
    el('b', '', d, '护盾');
    d.animate([{ opacity: 0, transform: 'translate(-50%, -50%) scale(0.7)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1.05)', offset: 0.25 }, { opacity: 0, transform: 'translate(-50%, -50%) scale(1.15)' }], { duration: 700 }).onfinish = () => d.remove();
  }

  /** 善意道具命中：头像上飘几个爱心或星星（不留污渍） */
  private sparkle(r: RectLike, glyph: string): void {
    for (let i = 0; i < 5; i++) {
      const d = el('span', `fx-spark ${glyph === '♥' ? 'heart' : 'star'}`, this.layer.el, glyph);
      const x = r.left + r.width * (0.15 + 0.7 * ((i * 37) % 100) / 100);
      d.style.left = `${x}px`;
      d.style.top = `${r.top + r.height * 0.4}px`;
      d.animate([{ opacity: 0, transform: 'translate(-50%, 0) scale(0.5)' }, { opacity: 1, transform: `translate(-50%, -${r.height * 0.3}px) scale(1.1)`, offset: 0.3 }, { opacity: 0, transform: `translate(-50%, -${r.height * 0.9}px) scale(0.9)` }], { duration: 1_100, delay: i * 80, fill: 'backwards' }).onfinish = () => d.remove();
    }
  }

  /** 头像旁冒一个字（连击 ×2、回敬！）：弹一下再淡出 */
  private pop(r: RectLike, text: string, cls: string, dx: number, dy: number): void {
    const d = el('div', `fx-pop ${cls}`, this.layer.el, text);
    d.style.left = `${r.left + r.width / 2 + dx}px`;
    d.style.top = `${r.top + dy}px`;
    d.animate(
      [
        { opacity: 0, transform: 'translate(-50%, -100%) scale(0.4)' },
        { opacity: 1, transform: 'translate(-50%, -100%) scale(1.4)', offset: 0.2 },
        { opacity: 1, transform: 'translate(-50%, -100%) scale(1)', offset: 0.7 },
        { opacity: 0, transform: 'translate(-50%, -160%) scale(1)' },
      ],
      { duration: 1_200 },
    ).onfinish = () => d.remove();
  }

  /** 电脑按性格说的一句（单机，VOICES 里的话）：和别的交流一样受屏蔽管 */
  say(seat: number, text: string): void {
    if (this.shows(seat)) this.host.bubble(seat, text);
  }

  /** 名场面横幅：牌桌正中偏上，点击穿透，几秒就走 */
  banner(text: string, delay: number): void {
    if (this.off) return;
    window.setTimeout(() => {
      const b = el('div', 'fame', this.layer.el);
      el('small', '', b, '名场面');
      el('b', '', b, text);
      const a = b.animate(
        [
          { opacity: 0, transform: 'translate(-50%, 0) scale(0.7)' },
          { opacity: 1, transform: 'translate(-50%, 0) scale(1.08)', offset: 0.12 },
          { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.85 },
          { opacity: 0, transform: 'translate(-50%, -12px) scale(1)' },
        ],
        { duration: BANNER_MS },
      );
      a.onfinish = () => b.remove();
    }, delay);
  }

  /** 新的公开事件：换一组顺手提示（不发，点了才发） */
  events(evs: readonly CommsEvent[]): void {
    const me = this.host.me();
    if (me === null || this.off) return;
    let pick: number[] | null = null;
    for (const e of evs) {
      if (e.e === 'hu' && e.seat === me) pick = [1, 8];
      else if (e.e === 'hu' && e.from === me) pick = [10, 13];
      else if (e.e === 'hu') pick = [2, 12];
      else if (e.e === 'kan' && e.seat !== me) pick = [5, 2];
      else if (e.e === 'kan') pick = [5, 0];
    }
    if (!pick) return;
    this.hints = pick;
    this.hintAt = Date.now();
    if (!this.panel.hidden) this.paint();
    this.root.classList.add('nudge');
    window.setTimeout(() => this.root.classList.remove('nudge'), 1_200);
  }

  /**
   * 催促炸弹：seat 是现在一个人在想的别的真人（没有就 null），since 是他开始想的时间。想够 8 秒，他头像旁冒一个炸弹，点了冲他扔一个
   * （和道具一样走房间，所有人都看到）；同一手只能扔一次
   */
  urge(seat: number | null, since: number): void {
    const key = seat === null ? '' : `${seat}@${since}`;
    if (key === this.urgeKey) return;
    this.urgeKey = key;
    window.clearTimeout(this.urgeTimer);
    document.querySelector('.urge')?.remove();
    if (seat === null || this.muted || this.off) return;
    this.urgeTimer = window.setTimeout(() => {
      const badge = this.host.avatarEl(seat)?.parentElement;
      if (!badge || this.urgeKey !== key) return;
      const b = button('urge', badge, '', () => {
        b.remove();
        this.send(BOMB, seat);
      });
      b.title = '催一下';
      b.innerHTML = propSvg('bomb');
    }, Math.max(0, since + URGE_AFTER_MS - Date.now()));
  }

  /** 这个座位发的要不要显示：自己发的总显示（总开关关了除外） */
  private shows(seat: number): boolean {
    if (this.off) return false;
    return seat === this.host.me() || (!this.muted && !this.isBlocked(seat));
  }

  /** 别的有人的座位 */
  private others(): number[] {
    const me = this.host.me();
    return [0, 1, 2, 3].filter((s) => s !== me && this.host.occupied(s));
  }

  // ---------- 头像旁的菜单 ----------

  /** 牌桌上有人点了头像：自己 → 表情包；别人 → 道具、点名短语、屏蔽 */
  tapAvatar(seat: number): void {
    // 点的是头像时，外面的 pointerdown 已经把同一个头像的菜单收了：这一下算"再点收起"，别又开
    if (seat === this.closedSeat && Date.now() - this.closedAt < 400) return;
    const me = this.host.me();
    if (this.off || me === null || !this.host.occupied(seat)) return;
    this.closeMenu();
    this.close();
    const m = el('div', 'fun-menu', document.body);
    this.menu = m;
    this.menuSeat = seat;
    if (seat === me) {
      m.classList.add('mine');
      STICKERS.forEach((st, i) => {
        const b = button('pic talk', m, '', () => this.fire(STICKER_BASE + i, undefined, true));
        b.innerHTML = stickerSvg(st);
        b.setAttribute('aria-label', st);
        this.cool(b, 'talk');
      });
    } else {
      const props = el('div', 'fm-props', m);
      PROPS.forEach((pr, i) => {
        const b = button('pic prop', props, '', () => this.fire(PROP_BASE + i, seat, true));
        b.innerHTML = propSvg(pr);
        b.setAttribute('aria-label', pr);
        this.cool(b, 'prop');
      });
      const say = el('div', 'fm-say', m);
      for (const i of MENU_PHRASES) {
        const b = button('phrase talk', say, PHRASES[i]!, () => this.fire(i, seat, true));
        this.cool(b, 'talk');
      }
      const blocked = this.isBlocked(seat);
      button('fm-block', m, blocked ? '取消屏蔽' : '屏蔽他', () => {
        this.setBlocked(seat, !blocked);
        this.closeMenu();
      });
    }
    this.place(m, seat);
    // 下一个 tick 再挂：打开菜单的这一下点击不能把它收掉
    this.later(() => document.addEventListener('pointerdown', this.onOutside, true), 0);
  }

  /** 菜单、提示放在头像朝牌桌中心的那一侧，实时按头像和牌桌的屏幕位置算（头像位置由牌桌布局定，不写死），再避开自己的手牌和操作条 */
  private place(m: HTMLElement, seat: number): void {
    const a = this.host.avatarRect(seat);
    const w = m.offsetWidth;
    const h = m.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const stage = document.querySelector('.stage')?.getBoundingClientRect();
    const cx = stage ? stage.left + stage.width / 2 : vw / 2;
    const cy = stage ? stage.top + stage.height / 2 : vh / 2;
    const dx = cx - (a.left + a.width / 2);
    const dy = cy - (a.top + a.height / 2);
    const gap = 8;
    // 头像都在四个角上：菜单竖着朝桌心那边展开（上面两角往下、下面两角往上），横着和头像靠桌心的那条边对齐，
    // 让开整块名牌（不盖名字和筹码）
    const badge = this.host.avatarEl(seat)?.parentElement?.getBoundingClientRect() ?? a;
    let left = dx > 0 ? Math.min(a.left, badge.left) : Math.max(a.right, badge.right) - w;
    let top = dy > 0 ? badge.bottom + gap : badge.top - gap - h;
    const clamp = (): void => {
      left = Math.max(6, Math.min(vw - w - 6, left));
      top = Math.max(6, Math.min(vh - h - 6, top));
    };
    clamp();
    // 压住手牌或操作条就往上挪到它们上面（头像在手牌行里的自己，菜单本来就在上面）
    for (const sel of ['.my-hand', '.bar']) {
      const o = document.querySelector(sel)?.getBoundingClientRect();
      if (!o || !o.width) continue;
      const hit = left < o.right && left + w > o.left && top < o.bottom && top + h > o.top;
      if (hit) {
        top = o.top - h - 6;
        clamp();
      }
    }
    m.style.left = `${left}px`;
    m.style.top = `${top}px`;
  }

  private closeMenu(byOutside = false): void {
    document.removeEventListener('pointerdown', this.onOutside, true);
    if (!this.menu) return;
    if (byOutside) [this.closedSeat, this.closedAt] = [this.menuSeat, Date.now()];
    this.menu.remove();
    this.menu = null;
  }

  /** 第一次进牌桌：在一个电脑头像旁冒一句"点头像扔道具"，3 秒收起，只出一次 */
  private firstHint(tries: number): void {
    if (this.off || readFlag(HINT_KEY)) return;
    const me = this.host.me();
    const seats = this.others();
    const seat = seats.find((s) => this.host.isBot?.(s)) ?? seats[0];
    const r = seat === undefined || me === null ? null : this.host.avatarRect(seat);
    if (!r?.width) {
      // 牌桌还没画好
      if (tries < 6) this.later(() => this.firstHint(tries + 1), 1_000);
      return;
    }
    writeFlag(HINT_KEY, true);
    const tip = el('div', 'fun-hint', document.body, '点头像扔道具');
    this.place(tip, seat!);
    this.later(() => tip.remove(), HINT_SHOW_MS);
  }

  private later(fn: () => void, ms: number): void {
    const t = window.setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  // ---------- 完整面板 ----------

  private toggle(): void {
    this.closeMenu();
    this.panel.hidden = !this.panel.hidden;
    if (!this.panel.hidden) this.paint();
  }

  private close(): void {
    this.panel.hidden = true;
  }

  private paint(): void {
    const p = this.panel;
    p.replaceChildren();
    if (this.off) {
      // 总开关关着：面板里只有打开的按钮
      const body = el('div', 'comms-body set', p);
      el('div', 'aim', body, '互动关着：看不到也发不了');
      button('act go', body, '打开互动', () => this.setOff(false));
      return;
    }
    const tabs = el('div', 'comms-tabs', p);
    for (const [id, text] of [
      ['phrase', '短语'],
      ['sticker', '表情'],
      ['prop', '道具'],
      ['set', '设置'],
    ] as const) {
      button(`chip${this.tab === id ? ' on' : ''}`, tabs, text, () => {
        this.tab = id;
        this.propTo = null;
        this.paint();
      });
    }
    const body = el('div', `comms-body ${this.tab}`, p);
    if (this.tab === 'set') return this.paintSettings(body);
    if (this.tab === 'phrase') {
      // 点名：先挑对象（默认对大家说），再点短语
      const to = el('div', 'to-row', body);
      el('span', 'aim', to, '对谁说');
      if (this.phraseTo !== undefined && !this.others().includes(this.phraseTo)) this.phraseTo = undefined;
      for (const s of [undefined, ...this.others()]) {
        button(`chip${this.phraseTo === s ? ' on' : ''}`, to, s === undefined ? '大家' : this.nameOf(s), () => {
          this.phraseTo = s;
          this.paint();
        });
      }
      const hints = Date.now() - this.hintAt < HINT_MS ? this.hints : [];
      for (const i of hints) this.phrase(body, i, 'hint');
      for (let i = 0; i < PHRASE_COUNT; i++) if (!hints.includes(i)) this.phrase(body, i, '');
    } else if (this.tab === 'sticker') {
      STICKERS.forEach((s, i) => {
        const b = button('pic talk', body, '', () => this.fire(STICKER_BASE + i));
        b.innerHTML = stickerSvg(s);
        this.cool(b, 'talk');
      });
    } else if (this.propTo === null || !this.others().includes(this.propTo)) {
      // 道具先选人，再选道具
      this.propTo = null;
      el('div', 'aim', body, '扔给谁？');
      for (const s of this.others()) button('act soft', body, this.nameOf(s), () => {
        this.propTo = s;
        this.paint();
      });
    } else {
      const to = this.propTo;
      const head = el('div', 'to-row', body);
      el('span', 'aim', head, `扔给 ${this.nameOf(to)}`);
      button('chip', head, '换人', () => {
        this.propTo = null;
        this.paint();
      });
      PROPS.forEach((s, i) => {
        const b = button('pic prop', body, '', () => this.fire(PROP_BASE + i, to));
        b.innerHTML = propSvg(s);
        b.setAttribute('aria-label', s);
        this.cool(b, 'prop');
      });
    }
  }

  private paintSettings(body: HTMLElement): void {
    const row = (label: string, text: string, on: boolean, flip: () => void): void => {
      button(`chip set-row${on ? ' on' : ''}`, body, `${label}${text}`, () => {
        flip();
        this.paint();
      });
    };
    row('互动', '：开', true, () => this.setOff(true));
    row('全部屏蔽', this.muted ? '：开' : '：关', this.muted, () => {
      this.muted = !this.muted;
      writeFlag(MUTE_KEY, this.muted);
    });
    for (const s of this.others()) {
      row(`屏蔽 ${this.nameOf(s)}`, this.muted || this.isBlocked(s) ? '：开' : '：关', this.muted || this.isBlocked(s), () => this.setBlocked(s, !this.isBlocked(s)));
    }
    el('div', 'aim', body, '只是自己不看，牌局照常');
  }

  private setOff(off: boolean): void {
    this.off = off;
    writeFlag(OFF_KEY, off);
    this.root.classList.toggle('off', off);
    if (off) {
      window.clearTimeout(this.urgeTimer);
      document.querySelector('.urge')?.remove();
      this.urgeKey = '';
      this.closeMenu();
    }
    this.paint();
  }

  private nameOf(seat: number): string {
    return this.host.avatarEl(seat)?.parentElement?.querySelector('.name')?.textContent ?? `${seat + 1} 号`;
  }

  private isBlocked(seat: number): boolean {
    return readNames().includes(this.nameOf(seat));
  }

  private setBlocked(seat: number, on: boolean): void {
    const name = this.nameOf(seat);
    const rest = readNames().filter((n) => n !== name);
    writeNames(on ? [...rest, name] : rest);
  }

  private phrase(box: HTMLElement, i: number, cls: string): void {
    const b = button(`phrase talk ${cls}`, box, PHRASES[i]!, () => this.fire(i, this.phraseTo));
    this.cool(b, 'talk');
  }

  // ---------- 冷却 ----------

  private coolLeft(kind: 'prop' | 'talk'): number {
    return Math.max(0, (kind === 'prop' ? this.propUntil : this.talkUntil) - Date.now());
  }

  /** 冷却中的按钮转圈显示剩余（样式 comms.css 的 .cool），冷却完自己恢复 */
  private cool(b: HTMLElement, kind: 'prop' | 'talk'): void {
    const left = this.coolLeft(kind);
    if (left <= 0) return;
    b.classList.add('cool');
    b.style.setProperty('--cool', `${left}ms`);
    this.later(() => b.classList.remove('cool'), left);
  }

  /** 发出去；冷却没完就不发（按钮还在转圈）。返回有没有发 */
  private fire(id: number, to?: number, fromMenu = false): boolean {
    const kind = id >= PROP_BASE ? 'prop' : 'talk';
    if (this.coolLeft(kind) > 0) return false;
    if (kind === 'prop') this.propUntil = Date.now() + COOL_PROP_MS;
    else this.talkUntil = Date.now() + COOL_TALK_MS;
    this.send(id, to);
    if (fromMenu) this.closeMenu();
    this.close();
    return true;
  }
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    // 存不上就这一次有效
  }
}

function readNames(): string[] {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(BLOCK_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeNames(names: string[]): void {
  try {
    sessionStorage.setItem(BLOCK_KEY, JSON.stringify(names));
  } catch {
    // 存不上就这一次有效
  }
}

/** 互动按钮的笑脸 */
const SMILE =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#f3c86b"/><circle cx="8.5" cy="10" r="1.4" fill="#4a2c0a"/><circle cx="15.5" cy="10" r="1.4" fill="#4a2c0a"/><path d="M7.5 14c1 2.4 3 3.4 4.5 3.4s3.5-1 4.5-3.4" fill="none" stroke="#4a2c0a" stroke-width="1.6" stroke-linecap="round"/></svg>';
