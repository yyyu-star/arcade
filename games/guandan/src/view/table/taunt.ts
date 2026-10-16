/**
 * 牌桌互动（好友房 0.6.0，单机 0.7.1 起同一套；0.11.0 按仓库根 docs/table-fun.md 和德州、麻将对齐）：
 * 左下"互动"按钮的面板（短语 / 表情 / 道具三个页签）、点别人头像的小菜单（一排道具、点名短语、屏蔽他）、点自己头像发表情、
 * 首次进牌桌的提示、有人想太久时的"催促炸弹"、公开事件后的顺手提示，以及收到别人发的东西时怎么播（arcade-kit/fun 的图层）：
 * 冷却（道具 1.5 秒、表情和短语 1 秒）、被扔上限（10 秒 6 次，多了亮"护盾"不播）、连击"×N"、"回敬！"。
 * 发出去走 FunChannel：好友房经房间转发（房间只转发编号），单机在本地直接播、再交给电脑去回（net/banter.ts）。
 *
 * 公平：所有表情、道具、短语人人一样、免费，不能买、不和筹码挂钩；只是画面和声音，不停任何计时、不改规则；
 * 不转发任何隐藏信息，电脑出牌也不读这些；动画在 DOM 图层里、点击穿透，落在被扔的人头像上，不盖自己的手牌和操作按钮。
 * 屏蔽：设置里"互动：不看"一刀切；点头像"屏蔽他"、面板里"全部屏蔽"只对这个房间（单机：这一局）有效（sessionStorage，key 带 guandan. 前缀）。
 */
import Phaser from 'phaser';
import { PROPS, STICKERS, createFunLayer, showSticker, throwAt, type FunLayer, type RectLike } from 'arcade-kit/fun';
import { EMOTES, PROP_BASE, STICKER_BASE, TAUNTS, TAUNT_BASE, emoteOf, taunt } from '../../net/emotes.ts';
import { audio } from '../audio.ts';
import { FunTally } from '../fun-tally.ts';
import { bakeFun } from '../textures.ts';
import { seatName } from '../labels.ts';
import { KEYS, getBlocked, getSettings, rawStore, setBlocked } from '../store.ts';
import { COLOR, TYPE, minHit } from '../theme.ts';
import { iconButton, setHit, text, worldH, worldW } from '../ui/kit.ts';
import { BUTTON_Y } from './layout.ts';
import type { SeatView } from './seats.ts';

/** 想了多久以后别人能对他扔"催促炸弹" */
export const URGE_AFTER_MS = 8000;
/** 顺手提示留多久 */
const SUGGEST_MS = 6000;
/** 自己发的冷却：道具 1.5 秒，表情和短语 1 秒（docs/table-fun.md 第 2 节） */
export const PROP_COOLDOWN_MS = 1500;
export const TALK_COOLDOWN_MS = 1000;
/** 首次提示留多久 */
const HINT_MS = 3000;
/** 头像菜单里的三句点名短语 */
const MENU_TAUNTS = ['就这？', '等着瞧', '等得花都谢了'] as const;
/** 操作按钮（出牌、提示……）的顶边：菜单、表情面板的底边不能盖过它 */
const BUTTON_TOP = BUTTON_Y - 36;

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
  /** 聊天按钮的点按区域右边最多到哪（世界坐标）：再往右是"理牌"按钮 */
  chatRight: number;
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
  private stickers: Phaser.GameObjects.Container | null = null;
  /** 自己上一次发道具、发表情或短语的时间（冷却） */
  private lastProp = -Infinity;
  private lastTalk = -Infinity;
  private readonly fun = new FunTally();

  private readonly h: TauntHost;

  constructor(h: TauntHost) {
    this.h = h;
    this.layer = createFunLayer();
    const s = h.scene;
    void bakeFun(s).then(() => (this.baked = true), () => (this.baked = true));
    // 我的头像右边：聊天按钮（0.5.5 起的位置）。点按区域夹在我的头像（layout.ts：中心 x 60，至少 minHit() 见方）和"理牌"之间，不重叠
    const left = 60 + Math.max(72, minHit()) / 2;
    const w = Math.max(48, Math.min(Math.max(56, minHit()), h.chatRight - left));
    // "互动"按钮（原来的"聊"）：笑脸图标，下面一行字
    this.btn = iconButton(s, left + w / 2, 390, 'smile', () => (this.panel ? this.closePanel() : this.openPanel()), 46).setDepth(400);
    this.btn.add(text(s, 0, 34, '互动', { size: TYPE.small, bold: true, color: 0xfff6e0, stroke: 0x2b1d14, strokeWidth: 4 }));
    setHit(this.btn, w, Math.max(64, minHit()));
    for (let v = 1; v < 4; v++) h.seats[v]!.onTap(() => this.openMenu(v));
    h.seats[0]!.onTap(() => (this.stickers ? this.closeStickers() : this.openStickers()));
    s.events.once('shutdown', () => this.destroy());
    this.hintLater(1500);
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
    out['avatar0'] = { x: this.h.seats[0]!.a.ax, y: this.h.seats[0]!.a.ay, enabled: true, visible: true };
    add(this.panel);
    add(this.menu);
    add(this.stickers);
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
      root.add(this.chip(x0 + 92 + i * 152, y0 + 26, 140, 36, ['短语', '表情', '道具'][i]!, on ? COLOR.red : 0x5a3a22, () => this.openPanel(t), `tab:${t}`));
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
        this.toast(all3 ? '看得到大家的互动了' : '这一局不看任何人的互动');
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
        root.add(this.pic(x0 + 66 + (i % 4) * 118, top + 92 + Math.floor(i / 4) * 92, 70, `fun:prop:${name}`, () => this.pick(PROP_BASE + i, this.target), `emote${PROP_BASE + i}`, true));
      });
    }
    this.panel = root;
  }

  /** 还要冷却多久（毫秒，0 = 能发）：道具 1.5 秒，表情和短语 1 秒 */
  private coolLeft(prop: boolean, now = Date.now()): number {
    return Math.max(0, prop ? this.lastProp + PROP_COOLDOWN_MS - now : this.lastTalk + TALK_COOLDOWN_MS - now);
  }

  /** 冷却中点了不发、面板不收（道具按钮上转着圈） */
  private pick(id: number, to?: number): void {
    const prop = id >= PROP_BASE;
    const now = Date.now();
    if (this.coolLeft(prop, now) > 0) return;
    if (prop) this.lastProp = now;
    else this.lastTalk = now;
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
    // 一排 8 个道具、一排 3 句点名短语、最后"屏蔽他"（docs/table-fun.md 第 1 节，三个游戏一样）；手机上每格也够 44 CSS 像素
    const cell = Math.max(72, minHit());
    const rowH = Math.max(40, minHit() * 0.75);
    const w = cell * 8 + 24;
    const h = 44 + cell + 12 + (rowH + 10) * 2;
    const W = worldW(s);
    // 菜单在头像朝桌心那侧：左右两家往里，对家（上面）往右；底边不盖自己的操作按钮和手牌
    const side = v === 1 ? a.ax - a.size / 2 - 16 - w : a.ax + a.size / 2 + 16;
    const x = Math.min(W - w - 10, Math.max(10, side));
    const y = Math.max(64, Math.min(a.ay - h / 2, BUTTON_TOP - 12 - h));
    const root = s.add.container(0, 0).setDepth(4000);
    root.add(this.away(() => this.closeMenu()));
    const g = s.add.graphics();
    g.fillStyle(0x2b1d14, 0.94).fillRoundedRect(x, y, w, h, 14);
    g.lineStyle(2, COLOR.gold, 0.9).strokeRoundedRect(x, y, w, h, 14);
    root.add(g);
    root.add(text(s, x + 16, y + 22, `对 ${seatName(v)}`, { size: TYPE.label, bold: true, color: COLOR.goldLight, ox: 0 }));
    PROPS.forEach((name, i) => {
      root.add(this.pic(x + 12 + cell * (i + 0.5), y + 44 + cell / 2, Math.min(58, cell - 18), `fun:prop:${name}`, () => this.pick(PROP_BASE + i, v), `menu:prop${i}`, true));
    });
    const y2 = y + 44 + cell + 12 + rowH / 2;
    const cw = (w - 24 - 20) / 3;
    MENU_TAUNTS.forEach((t, i) => root.add(this.chip(x + 12 + cw / 2 + i * (cw + 10), y2, cw, rowH - 8, t, 0x7a2a1e, () => this.pick(taunt(t), v), `menu:taunt${i}`, TYPE.small)));
    const blocked = this.isBlocked(v);
    root.add(this.chip(x + w / 2, y2 + rowH + 10, 220, rowH - 8, blocked ? '不再屏蔽' : '屏蔽他', 0x3a3a3a, () => {
      this.setBlocked(v, !blocked);
      this.closeMenu();
      this.toast(blocked ? `看得到 ${seatName(v)} 的互动了` : `这一局不看 ${seatName(v)} 的互动`);
    }, 'menu:block', TYPE.small));
    this.menu = root;
  }

  // ───────────── 点自己头像：表情包 ─────────────

  private openStickers(): void {
    if (this.h.busy() || !this.baked || !this.canSend()) return;
    this.closeAll();
    const s = this.h.scene;
    const a = this.h.seats[0]!.a;
    const cell = Math.max(72, minHit());
    const w = cell * 6 + 24;
    const h = cell * 2 + 24;
    // 我的头像在左边：表情往右上方摆，底边不盖操作按钮
    const x = Math.min(worldW(s) - w - 10, a.ax + a.size / 2 + 16);
    const y = Math.max(64, BUTTON_TOP - 12 - h);
    const root = s.add.container(0, 0).setDepth(4000);
    root.add(this.away(() => this.closeStickers()));
    const g = s.add.graphics();
    g.fillStyle(0x2b1d14, 0.94).fillRoundedRect(x, y, w, h, 14);
    g.lineStyle(2, COLOR.gold, 0.9).strokeRoundedRect(x, y, w, h, 14);
    root.add(g);
    STICKERS.forEach((name, i) => {
      root.add(this.pic(x + 12 + cell * ((i % 6) + 0.5), y + 12 + cell * (Math.floor(i / 6) + 0.5), Math.min(60, cell - 16), `fun:sticker:${name}`, () => this.pick(STICKER_BASE + i), `me:sticker${i}`));
    });
    this.stickers = root;
  }

  closeStickers(): void {
    this.stickers?.destroy();
    this.stickers = null;
  }

  closeMenu(): void {
    this.menu?.destroy();
    this.menu = null;
  }

  closeAll(): void {
    this.closePanel();
    this.closeMenu();
    this.closeStickers();
    this.clearTip();
  }

  // ───────────── 首次提示 ─────────────

  /** 第一次进牌桌：在一个电脑（或别人）的头像上冒"点头像扔道具"，3 秒后收起，只出一次。忙着（弹窗、发牌）就过一会儿再试 */
  private hintLater(ms: number): void {
    if (rawStore.read(KEYS.hintFun)) return;
    this.h.scene.time.delayedCall(ms, () => {
      if (rawStore.read(KEYS.hintFun) || !this.h.chan.seated() || !getSettings().taunts) return;
      if (this.h.busy() || this.panel || this.menu || this.stickers) return this.hintLater(2000);
      rawStore.write(KEYS.hintFun, 1);
      this.h.seats[1]!.say('点头像扔道具', HINT_MS);
      this.h.log('提示 点头像');
    });
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
      const r = this.fun.hit(from, to!, Date.now());
      if (r.shield) {
        // 被扔太多了：不播，头像上亮一下护盾
        this.flash(to!, '护盾', 0x9fd8ff);
        this.h.log(`护盾 ${to}`);
        return;
      }
      void throwAt(this.layer, this.h.avatarRect(from), this.h.avatarRect(to!), name, {
        sound: (p, phase) => audio.fun(p, phase),
        onHit: () => {
          target.hit();
          if (r.combo >= 2) this.flash(to!, `×${r.combo}`, COLOR.goldLight);
        },
        target: to,
      });
      if (r.revenge) this.flash(to!, '回敬！', 0xffb070, -0.95);
      this.h.log(`道具 ${from}>${to}:${name}${r.combo >= 2 ? ` ×${r.combo}` : ''}${r.revenge ? ' 回敬' : ''}`);
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

  /** 头像上方冒一个字（连击 ×N、回敬、护盾）：放大弹一下再飘走 */
  private flash(v: number, label: string, color: number, dy = -0.72): void {
    const s = this.h.scene;
    const a = this.h.seats[v]!.a;
    const t = text(s, a.ax + a.size * 0.38, a.ay + a.size * dy, label, { size: TYPE.title, bold: true, color, stroke: 0x2b1d14, strokeWidth: 6 }).setDepth(4050);
    t.setScale(0.4);
    s.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.easeOut' });
    s.tweens.add({ targets: t, alpha: 0, y: t.y - 24, delay: 900, duration: 360, onComplete: () => t.destroy() });
  }

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

  /** prop：道具按钮，冷却中盖一层转圈的暗影，显示还剩多久 */
  private pic(x: number, y: number, size: number, tex: string, fn: () => void, key: string, prop = false): Phaser.GameObjects.Container {
    const s = this.h.scene;
    const c = s.add.container(x, y);
    const g = s.add.graphics();
    g.fillStyle(0x4a3220, 1).fillRoundedRect(-size / 2 - 6, -size / 2 - 6, size + 12, size + 12, 12);
    c.add([g, s.add.image(0, 0, tex).setDisplaySize(size, size)]);
    const left = prop ? this.coolLeft(true) : 0;
    if (left > 0) {
      const shade = s.add.graphics();
      const r = size / 2 + 4;
      const st = { f: left / PROP_COOLDOWN_MS };
      const draw = (): void => {
        if (!shade.active) return;
        shade.clear().fillStyle(0x000000, 0.55).slice(0, 0, r, -Math.PI / 2, -Math.PI / 2 + st.f * Math.PI * 2, false).fillPath();
      };
      draw();
      c.add(shade);
      const tw = s.tweens.add({ targets: st, f: 0, duration: left, onUpdate: draw, onComplete: () => shade.destroy() });
      // 面板先收起了：停掉转圈，免得往销毁了的图上画
      c.once('destroy', () => tw.stop());
    }
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
