/**
 * 交流（DESIGN.md 6.2）：单机和好友房同一个"聊"面板。说一句（可以点名）、表情包、扔道具，设置里有总开关和按人屏蔽。
 * 编号见 game/emotes.ts；表情包和道具直接用 arcade-kit/fun，不自己画。所有人一样、免费，不影响比赛、不停计时。
 * "头像"是名次栏里那一行：短语在那一行冒气泡（点名的带"@名字"，被点的那行晃一下），表情冒在那一行旁边，道具从发的人那行扔到对象那行。
 * 气泡和表情不压车手名（0.1.4）：横屏冒在那一行左边（赛道上；原来气泡挂在行里，被名次栏裁掉了）；竖屏名次栏是两列、左右没地方，短语改冒在名次栏上沿（赛道底边，带那辆车的小棋子），
 * 表情冒在那一行右头（挡位、热量那几格上），和这一行一样高、不出这一行。
 * - 总开关（racing.comms）：关了什么都不显示、不提示，自己也发不了，单机也算；
 * - 屏蔽所有人（racing.mute）：别人的都不显示，自己的照常；
 * - 按人屏蔽：真人、电脑都能屏蔽，只管这一场。
 */
import { createFunLayer, playFunSound, PROPS, propSvg, showSticker, STICKERS, stickerSvg, throwAt, type FunLayer, type StickerId } from 'arcade-kit/fun';
import { PHRASE_COUNT, PROP_BASE, PROP_COUNT, STICKER_BASE, STICKER_COUNT } from '../game/emotes.ts';
import { dialogHooks } from './dialog.ts';
import { button, el } from './dom.ts';
import { audioOut } from './sound.ts';
import { PHRASES } from './text.ts';

export const MUTE_KEY = 'racing.mute';
export const COMMS_KEY = 'racing.comms';

export interface CommsHost {
  me(): number | null;
  /** 这个座位在名次栏里的那一行 */
  rowEl(seat: number): HTMLElement | null;
  name(seat: number): string;
  occupied(seat: number): boolean;
  seats(): number;
}

export class Comms {
  private readonly layer: FunLayer;
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly host: CommsHost;
  private readonly send: (id: number, to?: number) => void;
  private on: boolean;
  private muted: boolean;
  private readonly blocked = new Set<number>();
  private tab: 'phrase' | 'sticker' | 'prop' | 'set' = 'phrase';
  /** 说一句的对象（null 是大家） */
  private target: number | null = null;
  private aiming: number | null = null;

  constructor(parent: HTMLElement, host: CommsHost, send: (id: number, to?: number) => void) {
    this.host = host;
    this.send = send;
    this.on = readFlag(COMMS_KEY) !== 'off';
    this.muted = readFlag(MUTE_KEY) === '1';
    this.layer = createFunLayer();
    dialogHooks({ open: () => this.layer.hide(), close: () => this.layer.show() });
    this.root = el('div', 'comms', parent);
    const b = button('comms-btn', this.root, '聊', () => this.toggle());
    b.title = '说一句、表情、道具';
    this.panel = el('div', 'comms-panel', this.root);
    this.panel.hidden = true;
    this.paintButton();
  }

  destroy(): void {
    dialogHooks({ open() {}, close() {} });
    this.layer.destroy();
    this.root.remove();
  }

  private paintButton(): void {
    this.root.classList.toggle('off', !this.on);
  }

  private rect(seat: number): DOMRect {
    const r = this.host.rowEl(seat)?.querySelector('.dot')?.getBoundingClientRect();
    return r ?? new DOMRect(window.innerWidth - 60, 60, 24, 24);
  }

  private portrait(): boolean {
    return this.host.rowEl(this.host.me() ?? 0)?.closest<HTMLElement>('.stage')?.dataset.orient === 'port';
  }

  /**
   * 横屏表情放哪：kit 的 showSticker 把表情冒在给的框的右上方（框 24 像素时表情 44 像素，中心在框心右 10.8、上 13.2），
   * 所以反过来算一个框，让表情落在那一行左边（赛道上，不压任何一行）
   */
  private stickerRect(seat: number): DOMRect {
    const row = this.host.rowEl(seat)?.getBoundingClientRect();
    if (!row) return this.rect(seat);
    const cx = row.left - 22 - 6;
    const cy = row.top + row.height / 2;
    return new DOMRect(cx - 10.8 - 12, cy + 13.2 - 12, 24, 24);
  }

  /**
   * 竖屏的表情：kit 的表情至少 44 像素，比手机上的一行（不到 20 像素）高得多，会跨出这一行、压到隔壁那一列和热量数字。
   * 所以自己画一个和这一行一样高的，贴在这一行右头（挡位、热量那几格上），不出这一行；挂在 .race 上（名次栏每一步整个重画）
   */
  private rowSticker(seat: number, id: StickerId): void {
    const row = this.host.rowEl(seat);
    const race = row?.closest<HTMLElement>('.side')?.parentElement;
    if (!row || !race) return;
    race.querySelector(`:scope > .row-sticker[data-seat="${seat}"]`)?.remove();
    const d = el('div', 'row-sticker', race);
    d.dataset.seat = String(seat);
    const size = Math.max(10, row.offsetHeight - 4);
    // 行的 offsetParent 就是 .race（名次栏本身没定位）
    Object.assign(d.style, { width: `${size}px`, height: `${size}px`, top: `${row.offsetTop + 2}px`, left: `${row.offsetLeft + row.offsetWidth - size - 4}px` });
    d.innerHTML = stickerSvg(id);
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!still && d.animate) {
      d.animate(
        [
          { transform: 'scale(0.4)', opacity: 0 },
          { transform: 'scale(1)', opacity: 1, offset: 0.08 },
          { transform: 'scale(1)', opacity: 1, offset: 0.8 },
          { transform: 'scale(1)', opacity: 0 },
        ],
        { duration: 2_000, easing: 'ease-out' },
      );
    }
    window.setTimeout(() => d.remove(), 2_000);
  }

  /** 收到一句（房间转发的，或单机里自己、电脑发的） */
  receive(seat: number, id: number, to?: number): void {
    if (!this.on) return;
    if (seat !== this.host.me() && (this.muted || this.blocked.has(seat))) return;
    if (id < PHRASE_COUNT) {
      this.bubble(seat, PHRASES[id]!, to);
      return;
    }
    if (id < STICKER_BASE + STICKER_COUNT) {
      const sticker = STICKERS[id - STICKER_BASE]!;
      if (this.portrait()) this.rowSticker(seat, sticker);
      else void showSticker(this.layer, this.stickerRect(seat), sticker);
      return;
    }
    if (id < PROP_BASE + PROP_COUNT && to !== undefined) {
      void throwAt(this.layer, this.rect(seat), this.rect(to), PROPS[id - PROP_BASE]!, {
        target: to,
        sound: (p, phase) => {
          const a = audioOut();
          if (a) playFunSound(a.ctx, a.out, p, phase);
        },
        onHit: () => this.shake(to),
      });
    }
  }

  private shake(seat: number): void {
    this.host.rowEl(seat)?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 320 });
  }

  /**
   * 名次栏那一行冒一个气泡；点名的带"@名字"，被点的那一行晃一下。气泡挂在 .race 上（名次栏 overflow: hidden，挂在行里会被裁掉，
   * 名次栏每一步还整个重画）：横屏贴在那一行左边，竖屏冒在名次栏上沿、带小棋子（见文件头）
   */
  private bubble(seat: number, text: string, to?: number): void {
    const row = this.host.rowEl(seat);
    const side = row?.closest<HTMLElement>('.side');
    const race = side?.parentElement;
    if (!row || !side || !race) return;
    const words = to === undefined ? text : `@${this.host.name(to)} ${text}`;
    let b: HTMLElement;
    if (this.portrait()) {
      let talk = race.querySelector<HTMLElement>(':scope > .talk');
      if (!talk) talk = el('div', 'talk', race);
      talk.style.top = `${side.offsetTop}px`;
      talk.querySelector(`[data-seat="${seat}"]`)?.remove();
      b = el('div', 'bubble', talk);
      // 左列的冒在左边，右列的冒在右边，尾巴朝下指着那一列
      b.classList.toggle('right', row.offsetLeft > side.offsetLeft + side.clientWidth / 2);
      const dot = row.querySelector('.dot');
      if (dot) el('span', 'dot car-icon', b).innerHTML = dot.innerHTML;
      el('span', '', b, words);
    } else {
      race.querySelector(`:scope > .bubble[data-seat="${seat}"]`)?.remove();
      b = el('div', 'bubble', race, words);
      // 行的 offsetParent 就是 .race（名次栏本身没定位）
      b.style.right = `${race.clientWidth - row.offsetLeft + 6}px`;
      b.style.top = `${row.offsetTop + row.offsetHeight / 2}px`;
    }
    b.dataset.seat = String(seat);
    window.setTimeout(() => b.remove(), 2_600);
    if (to !== undefined) this.shake(to);
  }

  private toggle(): void {
    this.panel.hidden = !this.panel.hidden;
    this.aiming = null;
    if (!this.on) this.tab = 'set';
    if (!this.panel.hidden) this.paint();
  }

  private others(): number[] {
    const me = this.host.me();
    return Array.from({ length: this.host.seats() }, (_, s) => s).filter((s) => s !== me && this.host.occupied(s));
  }

  private paint(): void {
    const p = this.panel;
    p.replaceChildren();
    const tabs = el('div', 'comms-tabs', p);
    const list = this.on
      ? ([
          ['phrase', '说一句'],
          ['sticker', '表情'],
          ['prop', '道具'],
          ['set', '设置'],
        ] as const)
      : ([['set', '设置']] as const);
    for (const [id, text] of list) {
      button(`chip${this.tab === id ? ' on' : ''}`, tabs, text, () => {
        this.tab = id;
        this.aiming = null;
        this.paint();
      });
    }
    const body = el('div', `comms-body ${this.tab}`, p);
    if (this.tab === 'set') return this.paintSettings(body);
    if (this.tab === 'phrase') {
      const who = el('div', 'comms-who', body);
      el('span', 'lbl', who, '对谁说');
      button(`chip${this.target === null ? ' on' : ''}`, who, '大家', () => {
        this.target = null;
        this.paint();
      });
      for (const s of this.others())
        button(`chip${this.target === s ? ' on' : ''}`, who, this.host.name(s), () => {
          this.target = s;
          this.paint();
        });
      for (let i = 0; i < PHRASE_COUNT; i++) button('phrase', body, PHRASES[i]!, () => this.fire(i, this.target ?? undefined));
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
      for (const s of this.others()) button('act soft', body, this.host.name(s), () => this.fire(this.aiming!, s));
    }
  }

  private paintSettings(body: HTMLElement): void {
    const row = (label: string, on: boolean, flip: () => void): void => {
      const r = el('div', 'comms-set', body);
      el('span', '', r, label);
      button(`chip${on ? ' on' : ''}`, r, on ? '开' : '关', flip);
    };
    row('互动总开关', this.on, () => {
      this.on = !this.on;
      writeFlag(COMMS_KEY, this.on ? null : 'off');
      this.tab = this.on ? 'phrase' : 'set';
      this.paintButton();
      this.paint();
    });
    if (!this.on) {
      el('p', 'comms-note', body, '关着：别人的话、表情、道具都不显示，自己也发不了。');
      return;
    }
    row('看别人的', !this.muted, () => {
      this.muted = !this.muted;
      writeFlag(MUTE_KEY, this.muted ? '1' : null);
      this.paint();
    });
    if (this.muted) return;
    el('div', 'comms-note', body, '按人屏蔽（这一场有效）：');
    for (const s of this.others()) {
      const blocked = this.blocked.has(s);
      row(this.host.name(s), !blocked, () => {
        if (blocked) this.blocked.delete(s);
        else this.blocked.add(s);
        this.paint();
      });
    }
  }

  private fire(id: number, to?: number): void {
    if (!this.on) return;
    this.send(id, to);
    this.panel.hidden = true;
    this.aiming = null;
  }
}

function readFlag(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeFlag(key: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    // 存不上就这一次有效
  }
}
