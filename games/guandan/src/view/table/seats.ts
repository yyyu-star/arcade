/** 座位：头像（带表情）、名牌、队伍色、剩余张数、轮到谁的光圈、名次印章、台词气泡。 */
import Phaser from 'phaser';
import { PERSONAS, type Mood } from '../art/index.ts';
import { dur, tweenP } from '../anim.ts';
import { audio } from '../audio.ts';
import { PLACE_NAMES, isWatching, seatIdentity, seatName, seatPerson } from '../labels.ts';
import { COLOR, TYPE } from '../theme.ts';
import { bubble, text, type BubbleTone } from '../ui/kit.ts';
import type { SeatAnchor } from './layout.ts';

export class SeatView {
  private scene: Phaser.Scene;
  readonly seat: number;
  /** 这个座位是我自己（不画名牌和剩余张数） */
  readonly self: boolean;
  readonly a: SeatAnchor;
  private root: Phaser.GameObjects.Container;
  private avatar: Phaser.GameObjects.Image;
  private ring: Phaser.GameObjects.Graphics;
  private ringTween: Phaser.Tweens.Tween | null = null;
  private countBox: Phaser.GameObjects.Container | null = null;
  private countText: Phaser.GameObjects.Text | null = null;
  private countBg: Phaser.GameObjects.Graphics | null = null;
  private countPulse: Phaser.Tweens.Tween | null = null;
  private stamp: Phaser.GameObjects.Container | null = null;
  private talk: Phaser.GameObjects.Container | null = null;
  private moodTimer: Phaser.Time.TimerEvent | null = null;
  private thinking: Phaser.GameObjects.Container | null = null;
  private lastCount = -1;
  private plate: Phaser.GameObjects.Graphics;
  private nameText: Phaser.GameObjects.Text;
  /** 联机：电脑头像左下角的小芯片角标（形状区分，不只靠颜色；右下角是剩余张数） */
  private badge: Phaser.GameObjects.Container;
  /** 联机：掉线/代打的小字、这一手的倒计时 */
  private netTag: Phaser.GameObjects.Text;
  private clock: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, seat: number, a: SeatAnchor) {
    this.scene = scene;
    this.seat = seat;
    this.a = a;
    this.root = scene.add.container(a.ax, a.ay).setDepth(50);
    // 下面那个座位是我自己（旁观时是别人：要名牌、剩余张数，0.13.0）
    this.self = seat === 0 && !isWatching();
    const r = a.size / 2;
    this.ring = scene.add.graphics();
    this.ring.lineStyle(6, 0xffd25a, 1).strokeCircle(0, 0, r + 6);
    this.ring.lineStyle(14, 0xffd25a, 0.22).strokeCircle(0, 0, r + 10);
    this.ring.setVisible(false);
    this.root.add(this.ring);
    this.avatar = scene.add.image(0, 0, this.key('normal')).setDisplaySize(a.size, a.size);
    this.root.add(this.avatar);

    // 名牌：队伍色底 + 名字（我自己不放名牌，免得压到手牌）
    const ny = r + 14;
    this.nameText = text(scene, 0, ny, '', { size: TYPE.label, color: 0xfffaf0, bold: true });
    this.plate = scene.add.graphics();
    this.root.add([this.plate, this.nameText]);
    if (this.self) {
      this.plate.setVisible(false);
      this.nameText.setVisible(false);
    }
    this.badge = scene.add.container(-r * 0.72, r * 0.72);
    const bg = scene.add.graphics();
    bg.fillStyle(0x2b1d14, 1).fillRoundedRect(-15, -13, 30, 26, 7);
    bg.lineStyle(2, 0x9fe0ff, 1).strokeRoundedRect(-15, -13, 30, 26, 7);
    this.badge.add([bg, scene.add.image(0, 0, 'icon:robot').setDisplaySize(20, 20).setTint(0x9fe0ff)]);
    this.root.add(this.badge);
    this.netTag = text(scene, 0, this.self ? -r - 18 : ny + 30, '', { size: 16, color: 0xffe3a0, bold: true, stroke: 0x2b1d14, strokeWidth: 4 });
    // 对家头像紧贴顶栏，读秒放头上会压住比分：放到左边（右边是剩余张数）
    const [kx, ky] = seat === 2 ? [-r - 30, 0] : [0, -r - 20];
    this.clock = text(scene, kx, ky, '', { size: TYPE.body, color: 0xffffff, bold: true, font: 'num', stroke: 0x7d121a, strokeWidth: 5 });
    this.root.add([this.netTag, this.clock]);
    this.refreshIdentity();

    if (!this.self) {
      // 剩余张数：三家一个样，头像右下角压一张小牌背 + 数字（art-v3）；≤10 张变红并跳动
      const box = scene.add.container(r * 0.8, r * 0.62);
      const back = scene.add.image(-4, -6, 'back:0').setDisplaySize(30, 42).setAngle(10);
      this.countBg = scene.add.graphics();
      this.countText = text(scene, 0, 2, '27', { size: TYPE.body, color: 0xffffff, bold: true, font: 'num', stroke: 0x2b1d14, strokeWidth: 4 });
      box.add([back, this.countBg, this.countText]);
      this.root.add(box);
      this.countBox = box;
    }
  }

  private key(m: Mood): string {
    return `avatar:${seatPerson(this.seat)}:${m}`;
  }

  /** 按座位上现在是谁重画头像、名牌、角标、掉线状态（联机时有人接管电脑座位、掉线、回来都会变） */
  refreshIdentity(): void {
    const seat = this.seat;
    const team = seat % 2 === 0 ? COLOR.teamUs : COLOR.teamThem;
    const id = seatPerson(seat);
    const who = seatIdentity[seat];
    this.avatar.setTexture(this.key('normal')).setDisplaySize(this.a.size, this.a.size);
    this.nameText.setText(seatName(seat));
    const ny = this.a.size / 2 + 14;
    const nw = Math.max(64, this.nameText.width + 26);
    const g = this.plate.clear();
    g.fillStyle(0x000000, 0.35).fillRoundedRect(-nw / 2, ny - 14 + 2, nw, 28, 14);
    g.fillStyle(id === 'me' ? team : PERSONAS[id].color, 1).fillRoundedRect(-nw / 2, ny - 14, nw, 28, 14);
    g.lineStyle(2, team, 1).strokeRoundedRect(-nw / 2, ny - 14, nw, 28, 14);
    g.fillStyle(team, 1).fillCircle(-nw / 2 + 2, ny, 6);
    // 角标只在联机时出现：电脑座位一直带着，真人托管、走开时也带上（电脑在替他打）
    this.badge.setVisible(!!who && (!who.human || who.auto || !!who.afk));
    this.avatar.setAlpha(who?.away && !who.auto ? 0.45 : 1);
    // 我自己走开了不写"托管中"：我的画面上有"我回来了"，这里的字会和倒计时挤在一起
    this.netTag.setText(who?.auto ? '电脑代打' : who?.away ? '重连中…' : who?.afk && !this.self ? '托管中' : '');
  }

  /**
   * 名牌、剩余张数、托管小字那一块（世界坐标，0.24.0）：kit 的气泡、弹幕、聊天按钮避开它，不盖住名字和张数。
   * 我自己没有名牌和张数，返回 null
   */
  plateBox(): { x: number; y: number; w: number; h: number } | null {
    if (this.self) return null;
    const r = this.a.size / 2;
    const nw = Math.max(64, this.nameText.width + 26);
    const left = Math.min(-nw / 2, -r * 0.8);
    const right = Math.max(nw / 2, r * 0.8 + 20);
    // 上沿是剩余张数那张小牌背的顶，下沿是名牌（有托管小字时再往下一行）
    const top = r * 0.62 - 28;
    const bottom = r + 30 + (this.netTag.text ? 30 : 0);
    return { x: this.a.ax + left, y: this.a.ay + top, w: right - left, h: bottom - top };
  }

  /** 这一手还剩几秒（联机）；null 不显示 */
  setClock(sec: number | null): void {
    this.clock.setText(sec === null ? '' : String(sec)).setColor(sec !== null && sec <= 5 ? '#ffb0a0' : '#ffffff');
  }

  setMood(m: Mood, ms = 2200): void {
    this.avatar.setTexture(this.key(m)).setDisplaySize(this.a.size, this.a.size);
    this.moodTimer?.remove();
    this.moodTimer = null;
    if (m !== 'normal' && ms > 0) {
      this.moodTimer = this.scene.time.delayedCall(ms, () => this.avatar.setTexture(this.key('normal')).setDisplaySize(this.a.size, this.a.size));
    }
  }

  setCount(n: number, finished: boolean): void {
    if (!this.countText || !this.countBg || !this.countBox) return;
    this.countBox.setVisible(!finished && n > 0);
    if (n === this.lastCount) return;
    this.lastCount = n;
    this.countText.setText(String(n));
    const warn = n <= 10;
    this.countBg.clear();
    const w = Math.max(34, this.countText.width + 14);
    this.countBg.fillStyle(warn ? 0xd8262f : 0x2b1d14, warn ? 1 : 0.72).fillRoundedRect(-w / 2, -15, w, 32, 10);
    if (warn) this.countBg.lineStyle(2, 0xffe08a, 1).strokeRoundedRect(-w / 2, -15, w, 32, 10);
    if (warn && !this.countPulse) {
      this.countPulse = this.scene.tweens.add({ targets: this.countBox, scale: 1.15, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    } else if (!warn && this.countPulse) {
      this.countPulse.stop();
      this.countPulse = null;
      this.countBox.setScale(1);
    }
  }

  /** 报牌：剩的张数刚掉到 10 张、3 张以内时在头像旁弹一下（一直红着跳的数字容易看漏） */
  callCount(n: number): void {
    const r = this.a.size / 2;
    const [x, y] = this.seat === 2 ? [this.a.ax + r + 140, this.a.ay] : [this.a.ax, this.a.ay - r - 46];
    const urgent = n <= 3;
    const c = this.scene.add.container(x, y).setDepth(80);
    const t = text(this.scene, 0, 0, urgent ? `只剩 ${n} 张！` : `报牌 剩 ${n} 张`, { size: TYPE.body, color: 0xffffff, bold: true });
    const w = t.width + 28;
    const g = this.scene.add.graphics();
    g.fillStyle(urgent ? 0xd8262f : 0xb4541c, 1).fillRoundedRect(-w / 2, -19, w, 38, 19);
    g.lineStyle(2.5, 0xffe08a, 1).strokeRoundedRect(-w / 2, -19, w, 38, 19);
    c.add([g, t]);
    if (dur(1) === 0) {
      this.scene.time.delayedCall(1, () => c.destroy());
      return;
    }
    c.setScale(0.4).setAlpha(0);
    this.scene.tweens.add({ targets: c, scale: 1, alpha: 1, duration: dur(220), ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: c, alpha: 0, y: y - 16, delay: dur(1800), duration: dur(300), onComplete: () => c.destroy() });
  }

  /** 被道具打中：抖一下、缩一下，委屈一会儿（只是画面） */
  hit(): void {
    if (dur(1) === 0) return;
    const { ax } = this.a;
    this.scene.tweens.killTweensOf(this.root);
    this.root.setPosition(ax, this.a.ay).setScale(1);
    this.scene.tweens.add({ targets: this.root, x: { from: ax - 7, to: ax + 7 }, scale: 0.92, duration: 60, yoyo: true, repeat: 2, onComplete: () => this.root.setPosition(ax, this.a.ay).setScale(1) });
    this.setMood('sad', 1600);
  }

  setTurn(on: boolean): void {
    this.ring.setVisible(on);
    if (on && !this.ringTween) {
      this.ring.setAlpha(1);
      this.ringTween = this.scene.tweens.add({ targets: this.ring, alpha: 0.35, duration: 600, yoyo: true, repeat: -1 });
    } else if (!on && this.ringTween) {
      this.ringTween.stop();
      this.ringTween = null;
    }
  }

  /** 名次印章：从大到小砸下来。place 从 1 开始；null 清掉。 */
  async setPlace(place: number | null, animate: boolean): Promise<void> {
    this.stamp?.destroy();
    this.stamp = null;
    if (place === null) return;
    const name = PLACE_NAMES[place - 1]!;
    const s = this.scene.add.container(this.a.ax + this.a.size * 0.32, this.a.ay - this.a.size * 0.28).setDepth(60);
    const size = this.a.size * 0.78;
    // 印章底下垫一块米色实底（art-v3）：印泥是半透明的墨，直接压在头像上看不清；头游再加一圈金边
    const back = this.scene.add.graphics();
    back.fillStyle(0xfff3d6, 0.94).fillCircle(0, 0, size * 0.46);
    if (place === 1) back.lineStyle(4, COLOR.gold, 1).strokeCircle(0, 0, size * 0.46);
    s.add([back, this.scene.add.image(0, 0, `stamp:${name}`).setDisplaySize(size, size).setAngle(-14)]);
    this.stamp = s;
    if (!animate || dur(1) === 0) return;
    s.setScale(3).setAlpha(0);
    audio.sfx('stamp');
    await tweenP(this.scene, { targets: s, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeIn' });
    this.scene.cameras.main.shake(dur(120), 0.004);
  }

  say(msg: string, ms = 1800, tone: BubbleTone = 'plain'): void {
    this.talk?.destroy();
    const b = bubble(this.scene, this.a.bx, this.a.by, msg, this.a.bdir, tone);
    // 尾巴朝右的气泡（对家）按右边对齐：长短不一的话都贴着头像，不往右盖住记牌条
    if (this.a.bdir === 'right') b.x -= b.width / 2;
    this.talk = b;
    this.scene.time.delayedCall(Math.max(900, dur(ms)), () => {
      if (this.talk !== b) return;
      this.scene.tweens.add({ targets: b, alpha: 0, duration: 200, onComplete: () => b.destroy() });
      this.talk = null;
    });
  }

  /** 电脑思考：头像旁跳动的三个点。 */
  setThinking(on: boolean): void {
    if (!on) {
      this.thinking?.destroy();
      this.thinking = null;
      return;
    }
    if (this.thinking) return;
    const c = this.scene.add.container(this.a.ax + (this.seat === 1 ? -this.a.size * 0.62 : this.a.size * 0.62), this.a.ay - this.a.size * 0.5).setDepth(70);
    const g = this.scene.add.graphics();
    g.fillStyle(0xfffaf0, 0.95).fillRoundedRect(-30, -16, 60, 32, 16);
    g.lineStyle(2, 0x5a3a20, 1).strokeRoundedRect(-30, -16, 60, 32, 16);
    c.add(g);
    for (let i = 0; i < 3; i++) {
      const d = this.scene.add.circle(-14 + i * 14, 0, 4.5, 0x5a3a20);
      c.add(d);
      this.scene.tweens.add({ targets: d, y: -5, duration: 280, yoyo: true, repeat: -1, delay: i * 120 });
    }
    this.thinking = c;
  }

  /** 冒烟用：头像中心。 */
  get center(): { x: number; y: number } {
    return { x: this.a.ax, y: this.a.ay };
  }
}
