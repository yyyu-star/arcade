/**
 * 掼蛋自己多出来的两样互动（其余的头像菜单、面板、冷却、电脑反应都在 arcade-kit/table-fun，见 TableScene.buildFun）：
 * - 顺手提示：公开事件后在"互动"按钮旁冒 1–2 句（suggest.ts 算），一点就发，6 秒后收起；
 * - 催促炸弹：轮到的人想了 8 秒以上，别人能对他扔一个炸弹；单机里我想太久，爱闹的电脑也会扔一个（每手最多一次）。
 *   只是画面和声音，不缩短计时、不影响规则。
 * 发出去走和 kit 同一个通道（好友房经房间转发，单机本地播），收到时由 kit 照常播。
 */
import Phaser from 'phaser';
import { PROPS } from 'arcade-kit/table-fun';
import type { FunBot } from 'arcade-kit/fun-logic';
import { PROP_BASE, emoteOf } from '../../net/emotes.ts';
import { URGE_AFTER_MS, slowUrge } from '../../variants/guandan/net/fun-moments.ts';
import { getSettings } from '../store.ts';
import { COLOR, TYPE } from '../theme.ts';
import { iconButton, text } from '../ui/kit.ts';
import type { SeatView } from './seats.ts';

/** 顺手提示留多久 */
const SUGGEST_MS = 6000;

export interface NudgeHost {
  scene: Phaser.Scene;
  seats: SeatView[];
  /** 能不能发（好友房坐下了、没有弹窗） */
  canSend(): boolean;
  send(id: number, toView?: number): void;
  /** 单机：电脑扔过来（走 kit 的收：同样的冷却、护盾、连击） */
  botThrow(from: number, id: number, to: number): void;
  /** 顺手提示放哪（世界坐标，提示条的左边、中线） */
  tipAt: { x: number; y: number };
}

export class Nudges {
  private tip: Phaser.GameObjects.Container | null = null;
  private tipTimer: Phaser.Time.TimerEvent | null = null;
  private urge: Phaser.GameObjects.Container | null = null;
  private urgeSeat = -1;
  /** 已经对这一手的这个人扔过催促炸弹（一手只给一次按钮，免得一直顶着） */
  private urged = '';
  private turnKey = '';
  private turnSince = 0;
  /** 单机：我这一手从什么时候开始想、电脑催过的那一手 */
  private soloKey = '';
  private soloSince = 0;
  private readonly soloUrged = { key: '' };
  private readonly h: NudgeHost;

  constructor(h: NudgeHost) {
    this.h = h;
    h.scene.events.once('shutdown', () => this.destroy());
  }

  /** 冒烟用：提示条、催促炸弹的位置（世界坐标） */
  controls(out: Record<string, { x: number; y: number; enabled: boolean; visible: boolean }>): void {
    this.tip?.list.forEach((o) => {
      const k = o.getData('key') as string | undefined;
      const c = o as Phaser.GameObjects.Container;
      if (k) out[k] = { x: c.x, y: c.y, enabled: true, visible: true };
    });
    if (this.urge) out['urge'] = { x: this.urge.x, y: this.urge.y, enabled: true, visible: true };
  }

  suggest(ids: number[]): void {
    if (ids.length === 0 || !getSettings().taunts || !this.h.canSend()) return;
    this.clearTip();
    const s = this.h.scene;
    const root = s.add.container(0, 0).setDepth(3900);
    ids.slice(0, 2).forEach((id, i) => {
      const e = emoteOf(id);
      if (!e || (e.kind !== 'taunt' && e.kind !== 'phrase')) return;
      root.add(this.chip(this.h.tipAt.x + 80 + i * 168, this.h.tipAt.y, 160, 34, e.text, () => {
        this.clearTip();
        this.h.send(id);
      }, `tip${i}`));
    });
    root.setAlpha(0);
    s.tweens.add({ targets: root, alpha: 1, duration: 160 });
    this.tip = root;
    this.tipTimer = s.time.delayedCall(SUGGEST_MS, () => this.clearTip());
  }

  clearTip(): void {
    this.tipTimer?.remove();
    this.tipTimer = null;
    this.tip?.destroy();
    this.tip = null;
  }

  /**
   * 每 250 毫秒调一次：轮到别人（画面座位 turn）、他已经想了 URGE_AFTER_MS 以上，就在他头像旁冒一个小炸弹按钮。
   * key 区分"这一手"（座位 + 截止时间）
   */
  tickTurn(turn: number | null, key: string): void {
    const now = Date.now();
    if (key !== this.turnKey) {
      this.turnKey = key;
      this.turnSince = now;
    }
    const want = turn !== null && turn !== 0 && this.h.canSend() && getSettings().taunts && now - this.turnSince >= URGE_AFTER_MS && this.urged !== key ? turn : -1;
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
      this.h.send(PROP_BASE + PROPS.indexOf('bomb'), want);
    }, 40).setDepth(450);
    s.tweens.add({ targets: b, scale: 1.18, duration: 380, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.urge = b;
  }

  /**
   * 单机每半秒调一次：key 是我这一手（没轮到我给 null），bots 是电脑和性格。想了 URGE_AFTER_MS 以上，爱闹的电脑按概率扔一个炸弹
   */
  tickSolo(key: string | null, bots: readonly FunBot[], now = Date.now()): void {
    if (key === null || !getSettings().taunts || !this.h.canSend()) return;
    if (key !== this.soloKey) {
      this.soloKey = key;
      this.soloSince = now;
      return;
    }
    const seat = slowUrge(this.soloUrged, key, now - this.soloSince, bots, Math.random);
    if (seat !== null) this.h.botThrow(seat, PROP_BASE + PROPS.indexOf('bomb'), 0);
  }

  private chip(x: number, y: number, w: number, h: number, label: string, fn: () => void, key: string): Phaser.GameObjects.Container {
    const s = this.h.scene;
    const c = s.add.container(x, y);
    const g = s.add.graphics();
    g.fillStyle(0x7a2a1e, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    g.lineStyle(1.5, COLOR.gold, 0.6).strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    c.add([g, text(s, 0, 0, label, { size: TYPE.small - 1, bold: true, color: 0xfff6e0 })]);
    // 点击区域比画出来的大一圈，手机上好点
    c.setSize(w + 6, h + 8).setInteractive({ useHandCursor: true });
    c.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      fn();
    });
    c.setData('key', key);
    return c;
  }

  destroy(): void {
    this.clearTip();
    this.urge?.destroy();
    this.urge = null;
  }
}
