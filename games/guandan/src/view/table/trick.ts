/** 桌面中央：本轮各家出的牌（或"不要"），带牌型名。新一轮开始时清桌。 */
import Phaser from 'phaser';
import { isBomb, type Play } from '../../variants/guandan/core/index.ts';
import { dur, tweenP } from '../anim.ts';
import { playLabel } from '../labels.ts';
import { COLOR, TYPE } from '../theme.ts';
import { text } from '../ui/kit.ts';
import { CardView } from './card.ts';
import type { SeatAnchor } from './layout.ts';

export const PLAYED_W = 60;
const STEP = 26;

export class TrickView {
  private scene: Phaser.Scene;
  private anchors: SeatAnchor[];
  private slots: (Phaser.GameObjects.Container | null)[] = [null, null, null, null];
  /** 每个座位：桌上是出的牌（不是"不要"）时，压着的那手的金框 */
  private glows: (Phaser.GameObjects.Graphics | null)[] = [null, null, null, null];
  private level = 2;
  /** 这一墩到现在的出牌顺序（null = 不要）；读档恢复时不知道前面的，不记 */
  private seq: { seat: number; play: Play | null }[] = [];
  /** 刚收掉的上一墩（给"上一墩"回看用）；新的一副清空 */
  prev: { seat: number; play: Play | null }[] = [];

  constructor(scene: Phaser.Scene, anchors: SeatAnchor[]) {
    this.scene = scene;
    this.anchors = anchors;
  }

  setLevel(level: number): void {
    this.level = level;
  }

  private positions(seat: number, n: number): { x: number; y: number }[] {
    const a = this.anchors[seat]!;
    const span = (n - 1) * STEP;
    const x0 = a.align === 'center' ? a.px - span / 2 : a.align === 'left' ? a.px + PLAYED_W / 2 : a.px - span - PLAYED_W / 2;
    return Array.from({ length: n }, (_, i) => ({ x: x0 + i * STEP, y: a.py }));
  }

  /** 这家的出牌区上现在有没有东西（牌或"不要"）：牌桌互动的首次提示不冒在有牌的那家旁边 */
  occupied(seat: number): boolean {
    return !!this.slots[seat];
  }

  /** 桌上现在每一家出的牌（或"不要"）占的地方（世界坐标，0.24.0）：kit 的弹幕不横穿、气泡不压 */
  boxes(): { x: number; y: number; w: number; h: number }[] {
    return this.slots.flatMap((c) => {
      if (!c) return [];
      const b = c.getBounds();
      return b.width > 0 ? [{ x: b.x, y: b.y, w: b.width, h: b.height }] : [];
    });
  }

  clearSeat(seat: number): void {
    const s = this.slots[seat];
    if (s) s.destroy();
    this.slots[seat] = null;
    this.glows[seat] = null;
  }

  /** 新的一手压上来：别家已经被压住的牌调暗、去掉金框，桌上一眼看出现在要压的是哪一手 */
  private dimOthers(seat: number): void {
    this.glows.forEach((g, s) => {
      if (!g || s === seat) return;
      g.destroy();
      this.glows[s] = null;
      const c = this.slots[s];
      if (c) this.scene.tweens.add({ targets: c, alpha: 0.42, duration: dur(200) });
    });
  }

  /**
   * 出牌：views 给出时（我出的牌，从手牌拿来）直接飞过去；否则从 from 位置（电脑头像）新建牌飞过去。
   */
  async showPlay(seat: number, play: Play, views: CardView[] | null, from: { x: number; y: number }): Promise<void> {
    this.clearSeat(seat);
    this.dimOthers(seat);
    this.seq.push({ seat, play });
    const c = this.scene.add.container(0, 0).setDepth(200 + seat);
    this.slots[seat] = c;
    const pos = this.positions(seat, play.cards.length);
    const scale = PLAYED_W / (views?.[0]?.cw ?? PLAYED_W);
    const list: CardView[] =
      views ??
      play.cards.map((card) => {
        const v = new CardView(this.scene, from.x, from.y, card, this.level, PLAYED_W);
        v.setScale(0.5).setAlpha(0);
        return v;
      });
    // 按出牌的顺序排好（逢人配放在末尾，跟手牌一致）
    const order = new Map(play.cards.map((cd, i) => [cd, i]));
    list.sort((a, b) => (order.get(a.card) ?? 0) - (order.get(b.card) ?? 0));
    list.forEach((v, i) => {
      c.add(v);
      v.setDepth(i);
    });
    const tweens = list.map((v, i) =>
      tweenP(this.scene, {
        targets: v,
        x: pos[i]!.x,
        y: pos[i]!.y,
        scale: views ? scale : 1,
        alpha: 1,
        angle: 0,
        duration: 200,
        delay: i * 14,
        ease: 'Cubic.easeOut',
      }),
    );
    await Promise.all(tweens);
    // 牌型名：普通牌型金色小牌子，炸弹红色
    const label = playLabel(play);
    const bomb = isBomb(play);
    // 压着的那一手：牌后面垫一圈金框（炸弹红框）；飞行途中被清掉了就不画
    if (this.slots[seat] === c) {
      const half = (PLAYED_W * 1.4) / 2 + 7;
      const x0 = pos[0]!.x - PLAYED_W / 2 - 7;
      const w0 = pos[pos.length - 1]!.x - pos[0]!.x + PLAYED_W + 14;
      const glow = this.scene.add.graphics();
      glow.fillStyle(bomb ? COLOR.red : COLOR.gold, 0.22).fillRoundedRect(x0, pos[0]!.y - half, w0, half * 2, 10);
      glow.lineStyle(3, bomb ? COLOR.red : 0xffd25a, 1).strokeRoundedRect(x0, pos[0]!.y - half, w0, half * 2, 10);
      c.addAt(glow, 0);
      this.glows[seat] = glow;
    }
    const a = this.anchors[seat]!;
    const t = text(this.scene, 0, 0, label, { size: TYPE.small, color: bomb ? 0xfff2d0 : 0x3a220e, bold: true });
    const w = t.width + 22;
    // 上下两家（居中排的）牌型名放在牌的右边，左右两家放在牌下面，免得和按钮、提示条挤在一起
    const lastX = pos[pos.length - 1]!.x;
    const lx = a.align === 'center' ? lastX + PLAYED_W / 2 + 10 + w / 2 : a.align === 'left' ? a.px + 40 : a.px - 40;
    const ly = a.align === 'center' ? a.py : a.py + (PLAYED_W * 1.4) / 2 + 16;
    t.setPosition(lx, ly);
    const g = this.scene.add.graphics().setPosition(lx, ly);
    g.fillStyle(bomb ? COLOR.red : COLOR.gold, 0.95).fillRoundedRect(-w / 2, -13, w, 26, 13);
    g.lineStyle(1.5, bomb ? COLOR.gold : 0xfff0c0, 1).strokeRoundedRect(-w / 2, -13, w, 26, 13);
    c.add([g, t]);
    g.setDepth(50);
    t.setDepth(51);
    if (dur(1) > 0) {
      g.setAlpha(0);
      t.setAlpha(0);
      this.scene.tweens.add({ targets: [g, t], alpha: 1, duration: dur(150) });
    }
  }

  showPass(seat: number): void {
    this.clearSeat(seat);
    this.seq.push({ seat, play: null });
    const a = this.anchors[seat]!;
    const c = this.scene.add.container(a.align === 'center' ? a.px : a.align === 'left' ? a.px + 50 : a.px - 50, a.py).setDepth(200 + seat);
    const t = text(this.scene, 0, 0, '不要', { size: TYPE.title, color: 0xe8ddc8, bold: true, font: 'title' });
    const g = this.scene.add.graphics();
    g.fillStyle(0x000000, 0.35).fillRoundedRect(-t.width / 2 - 20, -24, t.width + 40, 48, 24);
    c.add([g, t]);
    this.slots[seat] = c;
    if (dur(1) > 0) {
      c.setScale(0.6).setAlpha(0);
      this.scene.tweens.add({ targets: c, scale: 1, alpha: 1, duration: dur(160), ease: 'Back.easeOut' });
    }
  }

  /** 这一墩桌上压着的那手是谁出的（-1：领出，或刚恢复不知道） */
  topSeat(): number {
    for (let i = this.seq.length - 1; i >= 0; i--) if (this.seq[i]!.play) return this.seq[i]!.seat;
    return -1;
  }

  /** 新的一副：上一墩也不留 */
  forget(): void {
    this.seq = [];
    this.prev = [];
  }

  async clearAll(): Promise<void> {
    if (this.seq.length > 0) this.prev = this.seq;
    this.seq = [];
    const live = this.slots.filter((s): s is Phaser.GameObjects.Container => s !== null);
    this.slots = [null, null, null, null];
    this.glows = [null, null, null, null];
    if (live.length === 0) return;
    if (dur(1) === 0) {
      live.forEach((s) => s.destroy());
      return;
    }
    await tweenP(this.scene, { targets: live, alpha: 0, duration: 180 });
    live.forEach((s) => s.destroy());
  }

  /** 重建（读档或刷新后）：只画出牌，不做动画。 */
  restore(seat: number, play: Play | null): void {
    if (play === null) {
      this.showPass(seat);
      this.slots[seat]?.setScale(1).setAlpha(1);
      this.seq = [];
      return;
    }
    void this.showPlay(seat, play, null, this.positions(seat, play.cards.length)[0]!);
    this.seq = [];
  }
}
