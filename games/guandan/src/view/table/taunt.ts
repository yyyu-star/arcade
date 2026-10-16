/**
 * 嘲讽系统（好友房 0.6.0，单机 0.7.1 起同一套）：快捷按钮的面板（嘲讽 / 表情 / 道具三个页签）、点别人头像的小菜单（扔道具、点名嘲讽、屏蔽他）、
 * 有人想太久时的"催促炸弹"、公开事件后的顺手提示，以及收到别人发的东西时怎么播（arcade-kit/fun 的图层）。
 * 发出去走 FunChannel：好友房经房间转发（房间只转发编号），单机在本地直接播、再交给电脑去回（net/banter.ts）。
 *
 * 公平：所有表情、道具、短语人人一样、免费，不能买、不和筹码挂钩；只是画面和声音，不停任何计时、不改规则；
 * 不转发任何隐藏信息，电脑出牌也不读这些；动画在 DOM 图层里、点击穿透，落在被扔的人头像上，不盖自己的手牌和操作按钮。
 * 屏蔽：设置里"嘲讽和道具：不看"一刀切；点头像"屏蔽他"、面板里"全部屏蔽"只对这个房间（单机：这一局）有效（sessionStorage，key 带 guandan. 前缀）。
 */
import Phaser from 'phaser';
import { PROPS, STICKERS, createFunLayer, showSticker, throwAt, type FunLayer, type RectLike } from 'arcade-kit/fun';
import { EMOTES, PROP_BASE, STICKER_BASE, TAUNTS, TAUNT_BASE, emoteOf } from '../../net/emotes.ts';
import { audio } from '../audio.ts';
import { bakeFun } from '../textures.ts';
import { seatName } from '../labels.ts';
import { getBlocked, getSettings, setBlocked } from '../store.ts';
import { COLOR, TYPE } from '../theme.ts';
import { iconButton, text, worldH, worldW } from '../ui/kit.ts';
import type { SeatView } from './seats.ts';

/** 想了多久以后别人能对他扔"催促炸弹" */
export const URGE_AFTER_MS = 8000;
/** 顺手提示留多久 */
const SUGGEST_MS = 6000;

/** 发出去的路子和屏蔽认人的办法：好友房、单机各给一份（TableScene 里） */
export interface FunChannel {
  /** 能不能发（好友房：坐下了才能发；单机总能） */
  seated(): boolean;
  /** 发：画面座位的对象 */
  send(id: number, toView?: number): void;
  /** 屏蔽名单按这个分开（房间码；单机固定一个） */
  scope(): string;
  /** 画面座位 → 屏蔽时记的身份（真实座位 + 当时坐在那儿的名字）：人走了、换了人就不算 */
  who(v: number): { seat: number; name: string | null };
}

export interface TauntHost {
  scene: Phaser.Scene;
  chan: FunChannel;
  seats: SeatView[];
  /** 画面座位（我 = 0）的头像在屏幕上的矩形 */
  avatarRect(seat: number): RectLike;
  /** 现在有弹窗开着（面板、菜单不该再开） */
  busy(): boolean;
  log(line: string): void;
}

type Tab = 'taunt' | 'sticker' | 'prop';

export class Taunts {
  readonly layer: FunLayer;
  private btn: Phaser.GameObjects.Container;
  private panel: Phaser.GameObjects.Container | null = null;
  private menu: Phaser.GameObjects.Container | null = null;
  private tip: Phaser.GameObjects.Container | null = null;
  private tipTimer: Phaser.Time.TimerEvent | null = null;
  private urge: Phaser.GameObjects.Container | null = null;
  private urgeSeat = -1;
  /** 已经对这一手的这个人扔过催促炸弹（一手只给一次按钮，免得一直顶着） */
  private urged = '';
  private tab: Tab = 'taunt';
  /** 道具页签里选中的对象（画面座位），默认下家 */
  private target = 1;
  private turnKey = '';
  private turnSince = 0;
  /** 表情、道具的图烘焙好了没（面板要用） */
  private baked = false;

  private readonly h: TauntHost;

  constructor(h: TauntHost) {
    this.h = h;
    this.layer = createFunLayer();
    const s = h.scene;
    void bakeFun(s).then(() => (this.baked = true), () => (this.baked = true));
    // 我的头像右边：聊天按钮（0.5.5 起的位置）
    this.btn = iconButton(s, 128, 396, 'chat', () => (this.panel ? this.closePanel() : this.openPanel()), 46).setDepth(400);
    for (let v = 1; v < 4; v++) h.seats[v]!.onTap(() => this.openMenu(v));
    h.seats[0]!.onTap(() => (this.panel ? this.closePanel() : this.openPanel()));
    s.events.once('shutdown', () => this.destroy());
  }

  /** 冒烟用：按钮、面板里各项的位置 */
  controls(out: Record<string, { x: number; y: number; enabled: boolean; visible: boolean }>): void {
    out['chat'] = { x: this.btn.x, y: this.btn.y, enabled: true, visible: true };
    for (let v = 1; v < 4; v++) out[`avatar${v}`] = { x: this.h.seats[v]!.a.ax, y: this.h.seats[v]!.a.ay, enabled: true, visible: true };
    const add = (c: Phaser.GameObjects.Container | null): void =>
      c?.list.forEach((o) => {
        const k = o.getData('key') as string | undefined;
        if (k) out[k] = { x: c.x + (o as Phaser.GameObjects.Container).x, y: c.y + (o as Phaser.GameObjects.Container).y, enabled: true, visible: true };
      });
    add(this.panel);
    add(this.menu);
    add(this.tip);
    if (this.urge) out['urge'] = { x: this.urge.x, y: this.urge.y, enabled: true, visible: true };
  }

  // ───────────── 发 ─────────────

  private send(id: number, toView?: number): void {
    if (!this.h.chan.seated()) return;
    this.h.chan.send(id, toView);
  }

  private canSend(): boolean {
    if (this.h.chan.seated()) return true;
    this.toast('坐下以后才能互动');
    return false;
  }

  private toast(msg: string): void {
    const s = this.h.scene;
    const t = text(s, worldW(s) / 2, 330, msg, { size: TYPE.body, bold: true, color: 0xfff6e0, stroke: 0x2b1d14, strokeWidth: 5 }).setDepth(4100);
    s.tweens.add({ targets: t, alpha: 0, delay: 1200, duration: 300, onComplete: () => t.destroy() });
  }

  // ───────────── 面板：嘲讽 / 表情 / 道具 ─────────────

  openPanel(tab: Tab = this.tab): void {
    if (this.h.busy() || !this.canSend()) return;
    // 图还没烘焙好（刚进房就点）：先只给文字页
    if (!this.baked) tab = 'taunt';
    this.closeAll();
    this.tab = tab;
    const s = this.h.scene;
    const [x0, y0, w, h] = [16, 62, 488, tab === 'taunt' ? 352 : 318];
    const root = s.add.container(0, 0).setDepth(4000);
    root.add(this.away(() => this.closePanel()));
    const g = s.add.graphics();
    g.fillStyle(0x2b1d14, 0.94).fillRoundedRect(x0, y0, w, h, 16);
    g.lineStyle(2, COLOR.gold, 0.9).strokeRoundedRect(x0, y0, w, h, 16);
    root.add(g);
    (['taunt', 'sticker', 'prop'] as Tab[]).forEach((t, i) => {
      const on = t === tab;
      root.add(this.chip(x0 + 92 + i * 152, y0 + 26, 140, 36, ['嘲讽', '表情', '道具'][i]!, on ? COLOR.red : 0x5a3a22, () => this.openPanel(t), `tab:${t}`));
    });
    const top = y0 + 60;
    if (tab === 'taunt') {
      // 客气话在前，嘲讽在后；3 列
      const all = [...EMOTES.map((t, i) => ({ t, id: i })), ...TAUNTS.map((t, i) => ({ t, id: TAUNT_BASE + i }))];
      all.forEach(({ t, id }, i) => {
        root.add(this.chip(x0 + 84 + (i % 3) * 160, top + 14 + Math.floor(i / 3) * 34, 152, 30, t, id >= TAUNT_BASE ? 0x7a2a1e : 0x4a3220, () => this.pick(id), `emote${id}`, TYPE.small - 1));
      });
      // 一键全部屏蔽 / 全部恢复（另外三个人的嘲讽、表情、道具；客气话照常）
      const all3 = [1, 2, 3].every((v) => this.isBlocked(v));
      root.add(this.chip(x0 + w / 2, y0 + h - 22, 220, 28, all3 ? '全部恢复' : '全部屏蔽', 0x3a3a3a, () => {
        for (const v of [1, 2, 3]) this.setBlocked(v, !all3);
        this.closeAll();
        this.toast(all3 ? '看得到大家的嘲讽和道具了' : '这一局不看任何人的嘲讽和道具');
      }, 'blockAll', TYPE.small - 1));
    } else if (tab === 'sticker') {
      STICKERS.forEach((name, i) => {
        root.add(this.pic(x0 + 50 + (i % 6) * 78, top + 50 + Math.floor(i / 6) * 96, 68, `fun:sticker:${name}`, () => this.pick(STICKER_BASE + i), `emote${STICKER_BASE + i}`));
      });
    } else {
      // 扔给谁：三个人的名字，默认下家
      [1, 2, 3].forEach((v, i) => {
        root.add(this.chip(x0 + 92 + i * 152, top + 16, 140, 32, `扔给 ${seatName(v)}`, v === this.target ? 0x3a6a2a : 0x4a3220, () => {
          this.target = v;
          this.openPanel('prop');
        }, `target${v}`, TYPE.small));
      });
      PROPS.forEach((name, i) => {
        root.add(this.pic(x0 + 66 + (i % 4) * 118, top + 92 + Math.floor(i / 4) * 92, 70, `fun:prop:${name}`, () => this.pick(PROP_BASE + i, this.target), `emote${PROP_BASE + i}`));
      });
    }
    this.panel = root;
  }

  private pick(id: number, to?: number): void {
    this.closeAll();
    this.send(id, to);
  }

  closePanel(): void {
    this.panel?.destroy();
    this.panel = null;
  }

  // ───────────── 点头像：对他扔道具、点名嘲讽、屏蔽 ─────────────

  private openMenu(v: number): void {
    if (this.h.busy() || !this.baked || !this.canSend()) return;
    this.closeAll();
    const s = this.h.scene;
    const a = this.h.seats[v]!.a;
    const [w, h] = [300, 250];
    const W = worldW(s);
    // 放在头像旁边、往桌子中间靠，夹在画面里
    const x = Math.min(W - w - 10, Math.max(10, a.ax + (v === 1 ? -w - 60 : 60)));
    const y = Math.min(worldH - h - 150, Math.max(64, a.ay - 40));
    const root = s.add.container(0, 0).setDepth(4000);
    root.add(this.away(() => this.closeMenu()));
    const g = s.add.graphics();
    g.fillStyle(0x2b1d14, 0.94).fillRoundedRect(x, y, w, h, 14);
    g.lineStyle(2, COLOR.gold, 0.9).strokeRoundedRect(x, y, w, h, 14);
    root.add(g);
    root.add(text(s, x + 16, y + 22, `对 ${seatName(v)}`, { size: TYPE.label, bold: true, color: COLOR.goldLight, ox: 0 }));
    PROPS.forEach((name, i) => {
      root.add(this.pic(x + 40 + (i % 4) * 72, y + 70 + Math.floor(i / 4) * 66, 54, `fun:prop:${name}`, () => this.pick(PROP_BASE + i, v), `menu:prop${i}`));
    });
    const quick = [TAUNT_BASE + TAUNTS.indexOf('就这？'), TAUNT_BASE + TAUNTS.indexOf('等得花都谢了')];
    quick.forEach((id, i) => root.add(this.chip(x + 76 + i * 146, y + 182, 138, 30, TAUNTS[id - TAUNT_BASE]!, 0x7a2a1e, () => this.pick(id, v), `menu:taunt${i}`, TYPE.small - 1)));
    const blocked = this.isBlocked(v);
    root.add(this.chip(x + w / 2, y + 222, 200, 30, blocked ? `不再屏蔽 ${seatName(v)}` : `屏蔽 ${seatName(v)}（本局）`, 0x3a3a3a, () => {
      this.setBlocked(v, !blocked);
      this.closeMenu();
      this.toast(blocked ? `看得到 ${seatName(v)} 的嘲讽和道具了` : `这一局不看 ${seatName(v)} 的嘲讽和道具`);
    }, 'menu:block', TYPE.small - 1));
    this.menu = root;
  }

  closeMenu(): void {
    this.menu?.destroy();
    this.menu = null;
  }

  closeAll(): void {
    this.closePanel();
    this.closeMenu();
    this.clearTip();
  }

  // ───────────── 顺手提示 ─────────────

  /** 公开事件后在聊天按钮上冒 1–2 句（suggest.ts 算），一点就发；6 秒后自己收起 */
  suggest(ids: number[]): void {
    if (ids.length === 0 || !getSettings().taunts || !this.h.chan.seated() || this.panel || this.menu || this.h.busy()) return;
    this.clearTip();
    const s = this.h.scene;
    const root = s.add.container(0, 0).setDepth(3900);
    ids.slice(0, 2).forEach((id, i) => {
      const e = emoteOf(id);
      if (!e || (e.kind !== 'taunt' && e.kind !== 'phrase')) return;
      root.add(this.chip(240 + i * 168, 340, 160, 34, e.text, 0x7a2a1e, () => this.pick(id), `tip${i}`, TYPE.small - 1));
    });
    root.setAlpha(0);
    s.tweens.add({ targets: root, alpha: 1, duration: 160 });
    this.tip = root;
    this.tipTimer = s.time.delayedCall(SUGGEST_MS, () => this.clearTip());
  }

  private clearTip(): void {
    this.tipTimer?.remove();
    this.tipTimer = null;
    this.tip?.destroy();
    this.tip = null;
  }

  // ───────────── 催促炸弹 ─────────────

  /**
   * 每 250 毫秒调一次：轮到别人（画面座位 turn）、他已经想了 URGE_AFTER_MS 以上，就在他头像旁冒一个小炸弹按钮，所有其他人都能点。
   * 只是画面和声音：不缩短他的计时，不影响规则。key 区分"这一手"（座位 + 截止时间）
   */
  tickTurn(turn: number | null, key: string): void {
    const now = Date.now();
    if (key !== this.turnKey) {
      this.turnKey = key;
      this.turnSince = now;
    }
    const want = turn !== null && turn !== 0 && this.h.chan.seated() && getSettings().taunts && now - this.turnSince >= URGE_AFTER_MS && this.urged !== key ? turn : -1;
    if (want === this.urgeSeat) return;
    this.urge?.destroy();
    this.urge = null;
    this.urgeSeat = want;
    if (want < 0) return;
    const a = this.h.seats[want]!.a;
    const s = this.h.scene;
    const b = iconButton(s, a.ax + (want === 1 ? -a.size * 0.75 : a.size * 0.75), a.ay - a.size * 0.55, 'bomb', () => {
      this.urged = key;
      this.urge?.destroy();
      this.urge = null;
      this.urgeSeat = -1;
      this.send(PROP_BASE + PROPS.indexOf('bomb'), want);
    }, 40).setDepth(450);
    s.tweens.add({ targets: b, scale: 1.18, duration: 380, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.urge = b;
  }

  // ───────────── 收 ─────────────

  /** 房间转发来的（画面座位）。屏蔽了的、设置里不看的不播（客气话照常） */
  receive(from: number, id: number, to: number | undefined): void {
    const e = emoteOf(id);
    const seat = this.h.seats[from];
    if (!e || !seat) return;
    const quiet = from !== 0 && (!getSettings().taunts || this.isBlocked(from));
    if (e.kind === 'phrase') {
      seat.say(e.text, 2400);
      this.h.log(`短语 ${from}:${id}`);
      return;
    }
    if (quiet) return;
    if (e.kind === 'taunt') {
      const line = to !== undefined && to !== from ? `@${seatName(to)} ${e.text}` : e.text;
      seat.say(line, 2600, 'spicy');
      audio.sfx('taunt');
      this.h.log(`嘲讽 ${from}:${id}`);
    } else if (e.kind === 'sticker') {
      const name = STICKERS[e.index];
      if (!name) return;
      audio.sfx('sticker');
      void showSticker(this.layer, this.h.avatarRect(from), name);
      this.h.log(`表情 ${from}:${name}`);
    } else if (e.kind === 'prop') {
      const name = PROPS[e.index];
      const target = to === undefined ? null : this.h.seats[to];
      if (!name || !target || to === from) return;
      void throwAt(this.layer, this.h.avatarRect(from), this.h.avatarRect(to!), name, {
        sound: (p, phase) => audio.fun(p, phase),
        onHit: () => target.hit(),
        target: to,
      });
      this.h.log(`道具 ${from}>${to}:${name}`);
    }
  }

  // ───────────── 屏蔽（本局） ─────────────
  // 按"真实座位 + 当时坐在那儿的名字"记：被屏蔽的人走了、别人接管这个座位，新来的人不跟着被屏蔽

  isBlocked(v: number): boolean {
    const w = this.h.chan.who(v);
    return getBlocked(this.h.chan.scope()).some((b) => b.seat === w.seat && b.name === w.name);
  }

  private setBlocked(v: number, on: boolean): void {
    const w = this.h.chan.who(v);
    const list = getBlocked(this.h.chan.scope()).filter((b) => b.seat !== w.seat);
    if (on) list.push(w);
    setBlocked(this.h.chan.scope(), list);
  }

  // ───────────── 小部件 ─────────────

  /** 点面板外面收起 */
  private away(fn: () => void): Phaser.GameObjects.Zone {
    const s = this.h.scene;
    const z = s.add.zone(0, 0, worldW(s), worldH).setOrigin(0, 0).setInteractive();
    z.on('pointerdown', fn);
    return z;
  }

  private chip(x: number, y: number, w: number, h: number, label: string, fill: number, fn: () => void, key: string, size: number = TYPE.label): Phaser.GameObjects.Container {
    const s = this.h.scene;
    const c = s.add.container(x, y);
    const g = s.add.graphics();
    g.fillStyle(fill, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    g.lineStyle(1.5, COLOR.gold, 0.6).strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    c.add([g, text(s, 0, 0, label, { size, bold: true, color: 0xfff6e0 })]);
    // 点击区域比画出来的大一圈，手机上好点
    c.setSize(w + 6, h + 8).setInteractive({ useHandCursor: true });
    c.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      fn();
    });
    c.setData('key', key);
    return c;
  }

  private pic(x: number, y: number, size: number, tex: string, fn: () => void, key: string): Phaser.GameObjects.Container {
    const s = this.h.scene;
    const c = s.add.container(x, y);
    const g = s.add.graphics();
    g.fillStyle(0x4a3220, 1).fillRoundedRect(-size / 2 - 6, -size / 2 - 6, size + 12, size + 12, 12);
    c.add([g, s.add.image(0, 0, tex).setDisplaySize(size, size)]);
    c.setSize(size + 12, size + 12).setInteractive({ useHandCursor: true });
    c.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      fn();
    });
    c.setData('key', key);
    return c;
  }

  destroy(): void {
    this.closeAll();
    this.urge?.destroy();
    this.layer.destroy();
  }
}
