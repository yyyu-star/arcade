import Phaser from 'phaser';
import { LIVE_TIERS, difficultiesView, difficultyDef, liveTierById, personaById, personasView, type LiveTier, type PersonaId, type PersonaView } from '../../core/index.ts';
import type { WalletView } from '../../platform/live.ts';
import { LIVE_RULE, LIVE_WALLET_NOTE, chips } from '../liveText.ts';
import { bestKey, isDifficultyUnlocked, isPersonaUnlocked, type Profile } from '../../platform/profile.ts';
import { difficultyKey, hasArt, personaKey } from '../assets.ts';
import { jiggle } from '../fx/effects.ts';
import type { Animator } from '../fx/anim.ts';
import { bestText, difficultyLockText, levelLabel, personaLockText } from '../labels.ts';
import { sound } from '../sound.ts';
import { COLOR, TYPE } from '../theme.ts';
import { addGlyph, addImage, addSlice } from '../ui/art.ts';
import { Button } from '../ui/button.ts';
import { Dialog } from '../ui/dialog.ts';
import { addText, setColor } from '../ui/text.ts';
import { bindTooltip } from '../ui/tooltip.ts';
import { tipOnButton, wanShort } from './bits.ts';
import { phoneLayout } from '../viewport.ts';
import { ellipsize } from '../../core/format.ts';

const W = 1200;
const H = 660;
const CARD_W = 212;
const CARD_H = 262;
const CARD_GAP = 14;
const CARDS_Y = 84;
const BADGE = 72;
const BADGES_Y = 452;

/** 一套布局尺寸（电脑一套、手机横屏一套）。 */
interface Geo {
  w: number;
  h: number;
  cardW: number;
  cardH: number;
  cardGap: number;
  cardsY: number;
  badge: number;
  badgesY: number;
  /** 选中人设那一行（本钱 · 短话）的中心 y，下面一行是介绍 */
  personaY: number;
  /** 难度一句话的中心 y，下面一行是完整说明 */
  diffY: number;
  side: number;
}

const DESKTOP: Geo = { w: W, h: H, cardW: CARD_W, cardH: CARD_H, cardGap: CARD_GAP, cardsY: CARDS_Y, badge: BADGE, badgesY: BADGES_Y, personaY: CARDS_Y + CARD_H + 20, diffY: BADGES_Y + BADGE / 2 + 48, side: 32 };
/**
 * 手机横屏（960×444）：人设卡改成横卡（立绘在左，名字两行 + 本钱在右），难度徽章缩到 48，
 * 字号不变，只是收紧间距。
 */
const PHONE_GEO: Geo = { w: 940, h: 430, cardW: 170, cardH: 100, cardGap: 10, cardsY: 64, badge: 48, badgesY: 250, personaY: 182, diffY: 322, side: 24 };

/** 人设立绘（缺素材时画一个带首字的圆，不出烂图）。 */
export function addPortrait(scene: Phaser.Scene, x: number, y: number, p: Pick<PersonaView, 'id' | 'name'>, locked: boolean, w = 150): Phaser.GameObjects.GameObject[] {
  const h = (w * 300) / 240;
  const key = personaKey(p.id, locked);
  if (hasArt(scene.textures, key)) return [addImage(scene, x, y, key, w, h)];
  const r = Math.min(w, h) * 0.38;
  const c = scene.add.circle(x, y, r, locked ? 0x8d7b84 : COLOR.accent).setStrokeStyle(3, COLOR.ink, 1);
  const t = addText(scene, x, y, locked ? '?' : Array.from(p.name).slice(-2).join(''), { size: Math.round(r * 0.7), bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
  return [c, t];
}

/** 难度徽记（缺素材时画一个带数字的圆）。 */
export function addBadge(scene: Phaser.Scene, x: number, y: number, level: number, size = BADGE): Phaser.GameObjects.GameObject[] {
  const key = difficultyKey(level);
  if (hasArt(scene.textures, key)) return [addImage(scene, x, y, key, size)];
  const c = scene.add.circle(x, y, size * 0.42, 0xffb03a).setStrokeStyle(3, COLOR.ink, 1);
  return [c, addText(scene, x, y, String(level), { size: Math.round(size * 0.4), bold: true, originX: 0.5, originY: 0.5 })];
}

/**
 * 0.6.8 桌上还有一局没结（别的设备上开的、或者本机记录丢了）：不拦开新局，左下角提示一句，给「回去接着打」「原样退回」。
 * here = 那一份正是本机记录里作废、出错留着的，接不着打，只给「原样退回」。
 */
export interface LiveAside {
  amount: number;
  count: number;
  here: boolean;
  onResume: () => void;
  onRefund: () => void;
}

interface SetupOpts {
  profile: Profile;
  initial: { persona: PersonaId; difficulty: number };
  anim: Animator;
  onStart: (persona: PersonaId, difficulty: number) => void;
  /** 0.5：这一局用真实行情（难度改用 realDesc / realDetail 的说法） */
  real?: boolean;
  /**
   * 0.6.0 实盘：给了就是实盘模式，八个难度徽章换成四张档位卡，开始按钮写"带 2,000 进场"。
   * wallet 是 GET /api/wallet 看到的钱包（连不上为 null）；blocked 是开不了的原因（另一台设备上有一局、上一局还没结完……），能开为 null。
   */
  live?: { wallet: WalletView | null; blocked: string | null; tier: LiveTier; onStart: (persona: PersonaId, tier: LiveTier) => void; aside?: LiveAside | null };
  /** 顶上的「娱乐 | 实盘」开关：点了另一边就关掉这个面板，由调用方按那个模式重开（带上选好的人设） */
  onMode?: (mode: 'fun' | 'live', persona: PersonaId) => void;
}

/**
 * 「新的一局」（0.5 去文字化）：上排 5 张人设卡（立绘 + 名字 + 本钱），下排 8 枚难度徽章（徽章 + 名字）；
 * 选中的人设、难度各一行「一句短话」，完整说明、解锁条件都在悬停里。右下角「开局」。
 * 默认选中上次的组合，所以老玩家点「新游戏」→「开局」两下就开；新手直接用标题页的「快速开始」。
 */
export class SetupPanel extends Dialog {
  private persona: PersonaId;
  private difficulty: number;
  private readonly profile: Profile;
  private readonly rings = new Map<string, Phaser.GameObjects.Shape>();
  private readonly personaMoney: Phaser.GameObjects.Text;
  private readonly personaText: Phaser.GameObjects.Text;
  private readonly diffText: Phaser.GameObjects.Text;
  /** 0.5.1：人设一句介绍、难度的完整一句、叠加的前几级小徽章（0.5 都在悬停里） */
  private readonly personaDesc: Phaser.GameObjects.Text;
  private readonly diffDesc: Phaser.GameObjects.Text;
  private readonly stack: Phaser.GameObjects.Container;
  private readonly best: Phaser.GameObjects.Text;
  private readonly cards = new Map<string, Phaser.GameObjects.Container>();
  private real = false;
  private readonly g: Geo;
  /** 0.6.0 实盘模式（opts.live）：选中的档位、开始按钮（文字跟着档位变） */
  private readonly live: SetupOpts['live'] | null;
  private tier: LiveTier = 'small';
  private startBtn: Button | null = null;

  constructor(scene: Phaser.Scene, opts: SetupOpts) {
    const g = phoneLayout(scene) ? PHONE_GEO : DESKTOP;
    super(scene, g.w, g.h, '新一局');
    this.g = g;
    const W = g.w;
    const H = g.h;
    this.real = !!opts.real;
    this.profile = opts.profile;
    this.live = opts.live ?? null;
    if (this.live) this.tier = this.live.tier;
    const unlockedP = (id: PersonaId): boolean => isPersonaUnlocked(this.profile, id);
    this.persona = unlockedP(opts.initial.persona) ? opts.initial.persona : 'newbie';
    this.difficulty = isDifficultyUnlocked(this.profile, opts.initial.difficulty) ? opts.initial.difficulty : 1;

    const people = personasView();
    const x0 = (W - (g.cardW * people.length + g.cardGap * (people.length - 1))) / 2;
    people.forEach((p, i) => this.personaCard(p, x0 + i * (g.cardW + g.cardGap), g.cardsY, unlockedP(p.id), opts.anim));
    // 选中的人设：一行「本钱 · 一句短话」
    const ly = g.personaY;
    this.personaMoney = addText(scene, W / 2, ly, '', { size: TYPE.title, bold: true, num: true, color: COLOR.accentDark, originX: 1, originY: 0.5 });
    this.personaText = addText(scene, W / 2, ly, '', { size: TYPE.title, color: COLOR.ink, originY: 0.5 });
    this.personaDesc = addText(scene, W / 2, ly + (g === DESKTOP ? 24 : 23), '', { size: TYPE.label, color: COLOR.muted, originX: 0.5, originY: 0.5 });
    this.inner.add([this.personaMoney, this.personaText, this.personaDesc]);

    if (this.live) this.tierCards(opts.anim);
    else {
      const levels = difficultiesView();
      const slot = (W - 84) / levels.length;
      levels.forEach((d, i) => this.badge(d.level, d.name, 42 + slot * i + slot / 2, opts.anim));
    }
    if (opts.onMode) this.modeSwitch(opts.onMode);
    this.diffText = addText(scene, W / 2, g.diffY, '', { size: TYPE.title, color: COLOR.ink, originX: 0.5, originY: 0.5 });
    this.diffDesc = addText(scene, W / 2, g.diffY + (g === DESKTOP ? 26 : 23), '', { size: TYPE.label, color: COLOR.muted, originX: 0.5, originY: 0.5 });
    this.stack = scene.add.container(g === DESKTOP ? 176 : 140, H - (g === DESKTOP ? 42 : 36));
    this.inner.add([this.diffText, this.diffDesc, this.stack]);

    // 手机：底部一排收窄（开局 170×46、返回 100×40），贴着 24 的边
    const sw = g === DESKTOP ? 200 : 170;
    const sh = g === DESKTOP ? 50 : 46;
    const sy = g === DESKTOP ? H - 68 : H - 60;
    const start = new Button(scene, W - g.side - sw, sy, { width: sw, height: sh, label: '开 局', variant: 'primary', fontSize: this.live ? 18 : 20, hotkey: '回车' });
    this.startBtn = start;
    start.setHandler(() => {
      this.close();
      if (this.live) this.live.onStart(this.persona, this.tier);
      else opts.onStart(this.persona, this.difficulty);
    });
    if (this.live) start.onDenied(() => this.liveBlock());
    // 底部一排的中线：电脑 H-43（沿用原来的坐标），手机和开局按钮对齐
    const mid = g === DESKTOP ? H - 43 : sy + sh / 2;
    const back = new Button(scene, g.side, mid - 19, { width: g === DESKTOP ? 120 : 100, height: 40, label: '返回', fontSize: 15, hotkey: 'Esc' });
    back.setHandler(() => this.close());
    // 这个组合的最好成绩：奖杯 + 数字，完整说法在悬停
    const bx = W - g.side - sw - 20;
    const cup = addGlyph(scene, bx - 6, mid, 'trophy', 30);
    this.best = addText(scene, bx - 28, mid, '', { size: TYPE.label, bold: true, num: true, color: COLOR.muted, originX: 1, originY: 0.5 });
    const bestHit = scene.add.rectangle(bx - 190, mid - 19, 190, 40, 0xffffff, 0.001).setOrigin(0, 0);
    bindTooltip(bestHit, () => ({ x: this.inner.x + bx - 190, y: this.inner.y + mid - 19, w: 190, h: 40 }), () => ({ title: '这个组合的最好成绩', body: bestText(this.profile.best[bestKey(this.persona, this.difficulty)]) }));
    this.inner.add([start, back, cup, this.best, bestHit]);
    // 实盘没有"这个组合的最好成绩"
    if (this.live) for (const o of [cup, this.best, bestHit]) o.setVisible(false);
    tipOnButton(start, () => ({ x: this.inner.x + W - g.side - sw, y: this.inner.y + sy, w: sw, h: sh }), () => {
      const p = personasView().find((x) => x.id === this.persona);
      // 24 小时的期限只在这里提一次（设计稿第 5 节：局里不倒计时）
      if (this.live) {
        const t = liveTierById(this.tier);
        return p ? { title: '这一局实盘', body: `${p.name} · ${t.name} ${chips(t.stake)}\n带入以后一天内打完；放着不打，一天后本金原样退回。` } : null;
      }
      const d = difficultiesView()[this.difficulty - 1];
      return p && d ? { title: '这一局', body: `${p.name} · ${levelLabel(d.level, d.name)}` } : null;
    });
    this.named['setup:start'] = start;
    this.named['setup:back'] = back;
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') start.press();
    };
    scene.input.keyboard?.on('keydown', onKey);
    this.once(Phaser.GameObjects.Events.DESTROY, () => scene.input.keyboard?.off('keydown', onKey));
    this.refresh();
  }

  private personaCard(p: PersonaView, x: number, y: number, unlocked: boolean, anim: Animator): void {
    const s = this.scene;
    const c = s.add.container(x, y);
    const CARD_W = this.g.cardW;
    const CARD_H = this.g.cardH;
    const W = this.g.w;
    c.add(addSlice(s, 0, 0, CARD_W, CARD_H, 'card_holding'));
    if (this.g !== DESKTOP) this.phoneCardBody(c, p, unlocked);
    else {
      c.add(addPortrait(s, CARD_W / 2, 104, p, !unlocked, 148));
      c.add(addText(s, CARD_W / 2, 196, p.name, { size: TYPE.title, bold: true, color: unlocked ? COLOR.ink : COLOR.muted, originX: 0.5 }));
      if (unlocked) {
        // 本钱：钱包 + 数字
        const money = addText(s, CARD_W / 2 + 14, 236, wanShort(p.account), { size: TYPE.title, bold: true, num: true, color: COLOR.accentDark, originX: 0.5, originY: 0.5 });
        c.add(addGlyph(s, CARD_W / 2 + 14 - money.width / 2 - 18, 236, 'wallet', 28));
        c.add(money);
      } else if (hasArt(s.textures, 'ui:codex_lock')) {
        c.add(addImage(s, CARD_W / 2, 236, 'ui:codex_lock', 30));
      }
    }
    const ring = s.add.rectangle(-4, -4, CARD_W + 8, CARD_H + 8).setOrigin(0, 0).setRounded(16).setStrokeStyle(4, COLOR.accent, 1).setVisible(false);
    c.add(ring);
    const hit = s.add.rectangle(0, 0, CARD_W, CARD_H, 0xffffff, 0.001).setOrigin(0, 0).setInteractive({ useHandCursor: unlocked });
    hit.on(Phaser.Input.Events.POINTER_UP, () => {
      if (!unlocked) {
        sound.ui('denied');
        jiggle(anim, c, 0.25);
        this.personaMoney.setText('');
        this.personaDesc.setText(personaLockText(p.unlockBy));
        this.personaText.setText(`${p.name} · 还没解锁`).setX(W / 2).setOrigin(0.5, 0.5);
        setColor(this.personaText, COLOR.danger);
        return;
      }
      sound.ui('select');
      this.persona = p.id;
      this.refresh();
    });
    bindTooltip(hit, () => ({ x: this.inner.x + x, y: this.inner.y + y, w: CARD_W, h: CARD_H }), () =>
      unlocked ? { title: `${p.name}（${p.title}）`, body: `${p.desc}${p.flavor ? `\n「${p.flavor}」` : ''}` } : { title: `${p.name} · 还没解锁`, body: personaLockText(p.unlockBy), color: COLOR.danger },
    );
    c.add(hit);
    this.inner.add(c);
    this.rings.set(`p:${p.id}`, ring);
    this.cards.set(p.id, c);
    this.named[`setup:persona:${p.id}`] = { center: () => ({ x: this.inner.x + x + CARD_W / 2, y: this.inner.y + y + CARD_H / 2 }) };
  }

  /** 手机的横卡：立绘在左，右边名字（最多两行）和本钱（没解锁时是锁）。 */
  private phoneCardBody(c: Phaser.GameObjects.Container, p: PersonaView, unlocked: boolean): void {
    const s = this.scene;
    const { cardW, cardH } = this.g;
    c.add(addPortrait(s, 42, cardH / 2, p, !unlocked, 72));
    // 名字最长 6 个字：右栏 84 宽一行放 5 个字，最多折成两行
    const tx = 80;
    const tw = cardW - tx - 6;
    // 放不下一行时在称呼前折（「职场新人 / 阿韭」），不按宽度硬折成「职场新人阿 / 韭」
    const chars = [...p.name];
    const label = chars.length > 5 ? `${chars.slice(0, -2).join('')}\n${chars.slice(-2).join('')}` : p.name;
    const name = addText(s, tx, 12, label, { size: TYPE.label + 3, bold: true, color: unlocked ? COLOR.ink : COLOR.muted, wrap: tw, lineSpacing: 1 });
    c.add(name);
    const my = Math.max(name.y + name.height + 16, cardH - 24);
    if (unlocked) {
      c.add(addGlyph(s, tx + 10, my, 'wallet', 22));
      c.add(addText(s, tx + 24, my, wanShort(p.account), { size: TYPE.label + 3, bold: true, num: true, color: COLOR.accentDark, originY: 0.5 }));
    } else if (hasArt(s.textures, 'ui:codex_lock')) {
      c.add(addImage(s, tx + 12, my, 'ui:codex_lock', 24));
    }
  }

  private badge(level: number, name: string, cx: number, anim: Animator): void {
    const s = this.scene;
    const BADGE = this.g.badge;
    const BADGES_Y = this.g.badgesY;
    // 点击区域：电脑 120 宽；手机一格只有 107 宽，收到 104
    const hw = this.g === DESKTOP ? 120 : 104;
    const unlocked = isDifficultyUnlocked(this.profile, level);
    const c = s.add.container(cx, BADGES_Y);
    const art = addBadge(s, 0, 0, level, BADGE);
    c.add(art);
    c.add(addText(s, 0, BADGE / 2 + 12, name, { size: TYPE.label + 1, bold: true, color: unlocked ? COLOR.ink : COLOR.dim, originX: 0.5 }));
    if (!unlocked) {
      c.setAlpha(0.5);
      for (const o of art) if (o instanceof Phaser.GameObjects.Image) o.setTint(0x9c9496);
      if (hasArt(s.textures, 'ui:codex_lock')) c.add(addImage(s, BADGE / 2 - 6, -BADGE / 2 + 8, 'ui:codex_lock', 24));
    }
    const ring = s.add.circle(0, 0, BADGE / 2 + 7).setStrokeStyle(4, COLOR.accent, 1).setVisible(false);
    c.add(ring);
    const hit = s.add.rectangle(-hw / 2, -BADGE / 2 - 8, hw, BADGE + 36, 0xffffff, 0.001).setOrigin(0, 0).setInteractive({ useHandCursor: unlocked });
    hit.on(Phaser.Input.Events.POINTER_UP, () => {
      if (!unlocked) {
        sound.ui('denied');
        jiggle(anim, c, 0.25);
        this.diffText.setText(`${name} · ${difficultyLockText(level)}`);
        this.diffDesc.setText('');
        setColor(this.diffText, COLOR.danger);
        return;
      }
      sound.ui('select');
      this.difficulty = level;
      this.refresh();
    });
    const levels = difficultiesView().length;
    const d = difficultiesView()[level - 1];
    if (d) bindTooltip(hit, () => ({ x: this.inner.x + cx - hw / 2, y: this.inner.y + BADGES_Y - BADGE / 2 - 8, w: hw, h: BADGE + 36 }), () => {
        const t = this.levelText(d.level, d.desc, d.detail);
        const lines = [t.desc];
        if (t.detail) lines.push(t.detail);
        if (d.all.length > 1) lines.push(`还包含前面几级：${d.all.slice(0, -1).map((x) => x.name).join('、')}`);
        if (!unlocked) lines.push(difficultyLockText(level));
        return { title: `${d.name} · ${d.level}/${levels}`, body: lines.join('\n'), color: unlocked ? undefined : COLOR.danger };
      });
    c.add(hit);
    this.inner.add(c);
    this.rings.set(`d:${level}`, ring);
    this.named[`setup:diff:${level}`] = { center: () => ({ x: this.inner.x + cx, y: this.inner.y + BADGES_Y }) };
  }

  /** 「娱乐 | 实盘」两段开关，放在标题行正中。 */
  private modeSwitch(onMode: NonNullable<SetupOpts['onMode']>): void {
    const s = this.scene;
    const desk = this.g === DESKTOP;
    const bw = desk ? 96 : 84;
    const bh = desk ? 38 : 34;
    const y = desk ? 18 : 12;
    const x0 = this.g.w / 2 - bw - 4;
    ([['fun', '娱乐'], ['live', '实盘']] as const).forEach(([mode, label], i) => {
      const on = (mode === 'live') === !!this.live;
      const b = new Button(s, x0 + i * (bw + 8), y, { width: bw, height: bh, label, fontSize: 16, icon: mode === 'live' ? 'moneybag' : undefined });
      b.setSelected(on);
      b.setHandler(() => {
        if (on) return;
        this.close();
        onMode(mode, this.persona);
      });
      this.inner.add(b);
      this.named[`setup:mode:${mode}`] = b;
    });
  }

  /** 实盘的四张档位卡：档位名、一份多少（大字）、对应的难度（徽章 + 名字）。钱包里不够这一档的变灰（0.6.5：平台只要求够这次带入；开盘一档就是一份，少带就换小一档）。 */
  private tierCards(anim: Animator): void {
    const s = this.scene;
    const desk = this.g === DESKTOP;
    const cw = desk ? 260 : 200;
    const ch = desk ? 100 : 72;
    const gap = desk ? 16 : 12;
    // 上面是人设的一句介绍（电脑到 y≈400），卡片从它下面开始
    const y = this.g.badgesY - ch / 2 + (desk ? 8 : 6);
    const x0 = (this.g.w - (cw * LIVE_TIERS.length + gap * (LIVE_TIERS.length - 1))) / 2;
    LIVE_TIERS.forEach((t, i) => {
      const x = x0 + i * (cw + gap);
      const c = s.add.container(x, y);
      const afford = this.affords(t.stake);
      const d = difficultiesView()[t.difficulty - 1];
      c.add(addSlice(s, 0, 0, cw, ch, 'card_holding'));
      c.add(addText(s, 14, desk ? 12 : 8, desk ? t.name : `${t.name} · ${d?.name ?? ''}`, { size: desk ? TYPE.title : TYPE.label + 2, bold: true, color: COLOR.ink }));
      c.add(addBadge(s, cw - (desk ? 28 : 22), desk ? 28 : 22, t.difficulty, desk ? 36 : 28));
      const sy = desk ? 48 : 46;
      c.add(addGlyph(s, 26, sy, 'moneybag', desk ? 28 : 22));
      c.add(addText(s, 44, sy, chips(t.stake), { size: desk ? TYPE.big : TYPE.title + 2, bold: true, num: true, color: COLOR.accentDark, originY: 0.5 }));
      if (desk) c.add(addText(s, 14, 68, d ? `难度 ${t.difficulty} · ${d.name}` : '', { size: TYPE.label, color: COLOR.muted }));
      if (!afford) c.setAlpha(0.5);
      const ring = s.add.rectangle(-4, -4, cw + 8, ch + 8).setOrigin(0, 0).setRounded(16).setStrokeStyle(4, COLOR.accent, 1).setVisible(false);
      c.add(ring);
      const hit = s.add.rectangle(0, 0, cw, ch, 0xffffff, 0.001).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      hit.on(Phaser.Input.Events.POINTER_UP, () => {
        if (!this.affords(t.stake)) {
          sound.ui('denied');
          jiggle(anim, c, 0.25);
        } else sound.ui('select');
        this.tier = t.id;
        this.refresh();
      });
      bindTooltip(hit, () => ({ x: this.inner.x + x, y: this.inner.y + y, w: cw, h: ch }), () => {
        const lines = [`一份 ${chips(t.stake)} 筹码；难度 ${t.difficulty}${d ? ` ${d.name}` : ''}`];
        if (d) lines.push(this.levelText(d.level, d.desc, d.detail).desc);
        if (!this.affords(t.stake)) lines.push('钱包不够这一档');
        return { title: t.name, body: lines.join('\n'), color: this.affords(t.stake) ? undefined : COLOR.danger };
      });
      c.add(hit);
      this.inner.add(c);
      this.rings.set(`t:${t.id}`, ring);
      this.named[`setup:tier:${t.id}`] = { center: () => ({ x: this.inner.x + x + cw / 2, y: this.inner.y + y + ch / 2 }) };
    });
  }

  /** 钱包够不够这一份（连不上时不知道，按够算，开不了由 blocked 说） */
  private affords(stake: number): boolean {
    const w = this.live?.wallet;
    return !w || w.balance >= stake;
  }

  /** 实盘开不了的原因（没有为 null） */
  private liveBlock(): string | null {
    const l = this.live;
    if (!l) return null;
    if (l.blocked) return l.blocked;
    if (!l.wallet) return '钱包暂时连不上，可以先玩娱乐模式';
    if (!this.affords(liveTierById(this.tier).stake)) return '钱包不够这一档';
    return null;
  }

  /** 难度的说法：真实行情下用 realDesc / realDetail（有的话）。 */
  private levelText(level: number, desc: string, detail: string | null): { desc: string; detail: string | null } {
    if (!this.real) return { desc, detail };
    const def = difficultyDef(level);
    return { desc: def.realDesc ?? desc, detail: def.realDetail ?? detail };
  }

  /** 难度的一句短话（≤12 字）。 */
  private levelShort(level: number): string {
    const def = difficultyDef(level);
    const short = this.real ? (def.realShort ?? def.short) : def.short;
    return short ?? (this.real ? (def.realDesc ?? def.desc) : def.desc);
  }

  private refresh(): void {
    const W = this.g.w;
    for (const [k, r] of this.rings) r.setVisible(k === `p:${this.persona}` || k === `d:${this.difficulty}` || (!!this.live && k === `t:${this.tier}`));
    const p = personasView().find((x) => x.id === this.persona);
    if (p) {
      const short = personaById(p.id).short ?? p.title;
      this.personaMoney.setText(wanShort(p.account));
      this.personaText.setText(` · ${short}`).setOrigin(0, 0.5);
      // 两段合起来居中
      const total = this.personaMoney.width + this.personaText.width;
      this.personaMoney.setX(W / 2 - total / 2 + this.personaMoney.width);
      this.personaText.setX(W / 2 - total / 2 + this.personaMoney.width);
      setColor(this.personaText, COLOR.ink);
    }
    if (this.live) {
      this.refreshLive();
      if (p) this.personaDesc.setText(ellipsize(`${p.desc}${p.flavor ? `「${p.flavor}」` : ''}`, 56));
      return;
    }
    this.diffText.setText(this.levelShort(this.difficulty));
    setColor(this.diffText, COLOR.ink);
    const d = difficultiesView()[this.difficulty - 1];
    if (d) {
      const t = this.levelText(d.level, d.desc, d.detail);
      this.diffDesc.setText(ellipsize(t.desc === this.levelShort(this.difficulty) ? (t.detail ?? t.desc) : t.desc, 48));
      // 叠加的几级：一排小徽章（第 1 级时写「最普通的市场」）
      this.stack.removeAll(true);
      const s = this.scene;
      if (d.all.length > 1) {
        const lab = addText(s, 0, 0, '叠加', { size: TYPE.label, bold: true, color: COLOR.muted, originY: 0.5 });
        this.stack.add(lab);
        d.all.forEach((x, i) => this.stack.add(addBadge(s, lab.width + 22 + i * 32, 0, x.level, 30)));
      } else {
        this.stack.add(addGlyph(s, 10, 0, 'face_calm', 24));
        this.stack.add(addText(s, 28, 0, '最普通的市场', { size: TYPE.label, color: COLOR.muted, originY: 0.5 }));
      }
    }
    if (p) this.personaDesc.setText(ellipsize(`${p.desc}${p.flavor ? `「${p.flavor}」` : ''}`, 56));
    const b = this.profile.best[bestKey(this.persona, this.difficulty)];
    this.best.setText(!b || b.runs === 0 ? '—' : b.wins > 0 ? `${b.wins}/${b.runs} · ${wanShort(b.bestAccount)}` : `${b.bestMonths}/12`);
  }

  /** 实盘模式：钱包余额（或开不了的原因）、规则一句、开始按钮"带 2,000 进场"。 */
  private refreshLive(): void {
    const l = this.live;
    if (!l) return;
    const block = this.liveBlock();
    const w = l.wallet;
    this.diffText.setText(block && block !== '钱包不够这一档' ? block : w ? `钱包 ${chips(w.balance)} 筹码（${LIVE_WALLET_NOTE}）` : '');
    setColor(this.diffText, block && block !== '钱包不够这一档' ? COLOR.danger : COLOR.ink);
    this.diffDesc.setText(block === '钱包不够这一档' ? '钱包里的筹码不够这一档：换小一档少带一点，或者去大厅领补给' : LIVE_RULE);
    setColor(this.diffDesc, block === '钱包不够这一档' ? COLOR.danger : COLOR.muted);
    this.stack.removeAll(true);
    this.asideRow(l.aside ?? null);
    this.startBtn?.setLabel(`带 ${chips(liveTierById(this.tier).stake)} 进场`).setEnabled(block === null);
  }

  /** 左下角一排：还有一局实盘没结（几份、多少筹码）+「回去接着打」「原样退回」 */
  private asideRow(a: LiveAside | null): void {
    delete this.named['setup:aside:resume'];
    delete this.named['setup:aside:refund'];
    if (!a) return;
    const s = this.scene;
    const ph = this.g !== DESKTOP;
    const what = a.count > 1 ? `你还有 ${a.count} 局实盘没结（共 ${chips(a.amount)} 筹码）` : `你还有一局实盘没结（${chips(a.amount)} 筹码）`;
    const t = addText(s, 0, 0, what, { size: ph ? 13 : TYPE.label, color: COLOR.ink, originY: 0.5 });
    t.setInteractive();
    bindTooltip(t, () => ({ x: this.inner.x + this.stack.x, y: this.inner.y + this.stack.y - 12, w: t.width, h: 24 }), () => ({
      title: '还有一局实盘没结',
      body: a.here
        ? '这一份是这台设备上那局没结成的，接不着打了，可以原样退回钱包；放着不管一天后也会原样退回。'
        : '那局在另一台设备上：回那台设备打开开盘，点「继续」接着打；也可以在这里原样退回钱包。放着不管一天后会原样退回。',
    }));
    this.stack.add(t);
    let x = t.width + 12;
    const bh = ph ? 34 : 36;
    const mk = (key: string, label: string, w: number, fn: () => void): void => {
      const b = new Button(s, x, -bh / 2, { width: w, height: bh, label, fontSize: ph ? 13 : 14 });
      b.setHandler(fn);
      this.stack.add(b);
      this.named[key] = b;
      x += w + 8;
    };
    if (!a.here) mk('setup:aside:resume', '回去接着打', ph ? 96 : 108, () => {
      this.close();
      a.onResume();
    });
    mk('setup:aside:refund', '原样退回', ph ? 88 : 96, () => {
      this.close();
      a.onRefund();
    });
  }

  /** 当前选择（自动化用）。 */
  get choice(): { persona: PersonaId; difficulty: number; tier: LiveTier | null } {
    return { persona: this.persona, difficulty: this.difficulty, tier: this.live ? this.tier : null };
  }
}
