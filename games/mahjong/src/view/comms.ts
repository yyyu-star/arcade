/**
 * 牌桌上的交流（DESIGN.md 第 6 节），单机和好友房同一套：短语（可以点名）、表情包、扔道具、顺手提示、催促炸弹、名场面横幅，
 * 设置里有总开关、屏蔽所有人、按人屏蔽（真人、电脑都能屏蔽）。
 * 编号见 game/emotes.ts；表情包和道具直接用 arcade-kit/fun（kit 0.7.0），不自己画。所有人一样、免费，不挂筹码，不影响对局：
 * 不停计时、不盖牌和按钮（图层点击穿透），牌局也不读这里的任何东西。
 */
import { createFunLayer, playFunSound, PROPS, propSvg, showSticker, STICKERS, stickerSvg, throwAt, type FunLayer } from 'arcade-kit/fun';
import { PHRASE_COUNT, PROP_BASE, PROP_COUNT, STICKER_BASE, STICKER_COUNT } from '../game/emotes.ts';
import { dialogHooks } from './dialog.ts';
import { button, el } from './dom.ts';
import { audioOut, play } from './sound.ts';
import { PHRASES } from './text.ts';

/** 屏蔽所有人（只是自己不看，别人照样看得到你发的） */
export const MUTE_KEY = 'mahjong.mute';
/** 总开关：关了就什么都不显示、不提示，自己也不发 */
export const OFF_KEY = 'mahjong.comms';
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
  /** 按人屏蔽（座位号，这一桌有效） */
  private readonly blocked = new Set<number>();
  private tab: 'phrase' | 'sticker' | 'prop' | 'set' = 'phrase';
  /** 短语点名冲着谁（undefined 是对大家说） */
  private phraseTo: number | undefined;
  /** 选了道具、等点对象 */
  private aiming: number | null = null;
  private hints: number[] = [];
  private hintAt = 0;
  private urgeTimer = 0;
  private urgeKey = '';

  constructor(parent: HTMLElement, host: CommsHost, send: (id: number, to?: number) => void) {
    this.host = host;
    this.send = send;
    this.muted = readFlag(MUTE_KEY);
    this.off = readFlag(OFF_KEY);
    this.layer = createFunLayer();
    // 弹窗在舞台里（带缩放的层叠上下文），z-index 夹不到中间：开弹窗时把好玩图层藏起来
    dialogHooks({ open: () => this.layer.hide(), close: () => this.layer.show() });
    this.root = el('div', 'comms', parent);
    button('comms-btn', this.root, '聊', () => this.toggle());
    this.root.classList.toggle('off', this.off);
    this.panel = el('div', 'comms-panel', this.root);
    this.panel.hidden = true;
  }

  destroy(): void {
    window.clearTimeout(this.urgeTimer);
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
    if (id < PROP_BASE + PROP_COUNT && to !== undefined) {
      const prop = PROPS[id - PROP_BASE]!;
      void throwAt(this.layer, this.host.avatarRect(seat), this.host.avatarRect(to), prop, {
        target: to,
        sound: (p, phase) => {
          const a = audioOut();
          if (a) playFunSound(a.ctx, a.out, p, phase);
        },
        onHit: () => {
          const av = this.host.avatarEl(to);
          av?.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.86) rotate(-6deg)' }, { transform: 'scale(1)' }], { duration: 320 });
        },
      });
    }
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
    return seat === this.host.me() || (!this.muted && !this.blocked.has(seat));
  }

  /** 别的有人的座位 */
  private others(): number[] {
    const me = this.host.me();
    return [0, 1, 2, 3].filter((s) => s !== me && this.host.occupied(s));
  }

  private toggle(): void {
    this.panel.hidden = !this.panel.hidden;
    this.aiming = null;
    if (!this.panel.hidden) this.paint();
  }

  private close(): void {
    this.panel.hidden = true;
    this.aiming = null;
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
      ['phrase', '说一句'],
      ['sticker', '表情'],
      ['prop', '道具'],
      ['set', '设置'],
    ] as const) {
      button(`chip${this.tab === id ? ' on' : ''}`, tabs, text, () => {
        this.tab = id;
        this.aiming = null;
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
        const b = button('pic', body, '', () => this.fire(STICKER_BASE + i));
        b.innerHTML = stickerSvg(s);
      });
    } else if (this.aiming === null) {
      PROPS.forEach((s, i) => {
        const b = button('pic', body, '', () => {
          this.aiming = PROP_BASE + i;
          this.paint();
        });
        b.innerHTML = propSvg(s);
      });
    } else {
      el('div', 'aim', body, '扔给谁？');
      for (const s of this.others()) button('act soft', body, this.nameOf(s), () => this.fire(this.aiming!, s));
    }
  }

  private paintSettings(body: HTMLElement): void {
    const row = (label: string, on: boolean, flip: () => void): void => {
      button(`chip set-row${on ? ' on' : ''}`, body, `${label}${on ? '：开' : '：关'}`, () => {
        flip();
        this.paint();
      });
    };
    row('互动', true, () => this.setOff(true));
    row('屏蔽所有人', this.muted, () => {
      this.muted = !this.muted;
      writeFlag(MUTE_KEY, this.muted);
    });
    for (const s of this.others()) {
      row(`屏蔽 ${this.nameOf(s)}`, this.muted || this.blocked.has(s), () => {
        if (this.blocked.has(s)) this.blocked.delete(s);
        else this.blocked.add(s);
      });
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
    }
    this.paint();
  }

  private nameOf(seat: number): string {
    return this.host.avatarEl(seat)?.parentElement?.querySelector('.name')?.textContent ?? `${seat + 1} 号`;
  }

  private phrase(box: HTMLElement, i: number, cls: string): void {
    button(`phrase ${cls}`, box, PHRASES[i]!, () => this.fire(i, this.phraseTo));
  }

  private fire(id: number, to?: number): void {
    this.send(id, to);
    this.close();
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
