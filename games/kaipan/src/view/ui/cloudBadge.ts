import Phaser from 'phaser';
import type { CloudState, CloudView } from '../../platform/cloud.ts';
import { cloudView, onCloudChange } from '../cloudSync.ts';
import { COLOR, css } from '../theme.ts';
import { addText } from './text.ts';
import { HIT_MIN } from './button.ts';
import { bindTooltip, pinTooltip } from './tooltip.ts';

/**
 * 开始菜单上的云朵（云存档状态，0.5.7）：按状态上色的实心云 + 云上一个白色粗记号 + 底下两三个字，五种一眼分得清。
 * 未登录点一下去平台登录（登录后回到开盘）；别的状态点一下（或悬停、长按）只弹说明，不叫人去登录。
 */

const LOOK: Record<CloudState, { word: string; color: number; tip: string }> = {
  out: { word: '未登录', color: 0x8f8189, tip: '登录后，图鉴、成就、战绩和教程进度会存到云上，换手机、换电脑都在。点一下去登录。' },
  synced: { word: '已同步', color: COLOR.down, tip: '图鉴、成就、战绩和教程进度都存到云上了。打到一半的那一局只存在这台设备上。' },
  syncing: { word: '同步中', color: COLOR.info, tip: '正在和云上的进度对一下。' },
  pending: { word: '待上传', color: COLOR.accent, tip: '有新进度还没传到云上，过一会儿自动传。' },
  merged: { word: '已合并', color: 0x8a4fd8, tip: '和别的设备上的进度合在一起了：图鉴、成就取两边的全部，战绩取较好的。' },
};

/** 平台的登录页，登录后跳回开盘（from 只认平台登记过的游戏 id）。 */
const LOGIN_PATH = '/login?from=kaipan';

export class CloudBadge extends Phaser.GameObjects.Container {
  private readonly icon: Phaser.GameObjects.Graphics;
  private readonly mark: Phaser.GameObjects.Graphics;
  private readonly word: Phaser.GameObjects.Text;
  private spin: Phaser.Tweens.Tween | null = null;
  private view: CloudView = cloudView();

  /** (x, y) 是云朵中心。 */
  constructor(scene: Phaser.Scene, x: number, y: number, lively: boolean) {
    super(scene, x, y);
    this.icon = scene.add.graphics();
    this.mark = scene.add.graphics();
    this.word = addText(scene, 0, 20, '', { size: 12, bold: true, originX: 0.5, originY: 0, stroke: COLOR.paper, strokeWidth: 4 });
    // 点击区：图标加字大约 52×44，手机上补到 HIT_MIN（约 44px）
    const w = Math.max(56, HIT_MIN);
    const h = Math.max(48, HIT_MIN);
    const hit = scene.add.rectangle(-w / 2, -h / 2 + 6, w, h, 0xffffff, 0.001).setOrigin(0, 0);
    this.add([this.icon, this.mark, this.word, hit]);
    hit.setInteractive({ useHandCursor: true });
    const rect = (): { x: number; y: number; w: number; h: number } => {
      const m = this.getBounds();
      return { x: m.x, y: m.y, w: m.width, h: m.height };
    };
    const tip = (): { title: string; body: string } => ({ title: `云存档 · ${LOOK[this.view.state].word}`, body: this.view.note ? `${this.view.note}。` : LOOK[this.view.state].tip });
    hit.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      // 长按是看说明，不算点
      if (p.wasTouch && p.getDuration() >= 400) return;
      ev.stopPropagation();
      if (this.view.state === 'out') globalThis.location?.assign(LOGIN_PATH);
      else pinTooltip(hit, rect(), tip());
    });
    bindTooltip(hit, rect, tip);
    const off = onCloudChange((v) => this.active && this.show(v, lively));
    this.once(Phaser.GameObjects.Events.DESTROY, off);
    this.show(this.view, lively);
    scene.add.existing(this);
  }

  private show(v: CloudView, lively: boolean): void {
    this.view = v;
    const look = LOOK[v.state];
    const g = this.icon;
    g.clear();
    // 实心云（三个圆 + 平底），按状态上色
    // 先画大一圈的深色当描边，再画云身
    const puff = (k: number): void => {
      g.fillCircle(-10, 2, 9 + k);
      g.fillCircle(2, -4, 12 + k);
      g.fillCircle(13, 3, 8 + k);
      g.fillRoundedRect(-19 - k, 2 - k, 40 + k * 2, 10 + k * 2, 5 + k);
    };
    g.fillStyle(COLOR.ink, 1);
    puff(2);
    g.fillStyle(look.color, 1);
    puff(0);
    this.drawMark(v.state);
    this.word.setText(look.word).setColor(css(look.color));
    this.spin?.stop();
    this.spin = null;
    this.mark.setAngle(0);
    if (v.state === 'syncing' && lively) this.spin = this.scene.tweens.add({ targets: this.mark, angle: 360, duration: 1000, repeat: -1 });
  }

  /** 云上的小记号，画在 (2, 3) 附近（旋转也绕这个点） */
  private drawMark(state: CloudState): void {
    const m = this.mark;
    const color = COLOR.white;
    m.clear();
    m.setPosition(2, 3);
    m.lineStyle(4, color, 1);
    switch (state) {
      case 'out': // 一把小锁
        m.fillStyle(color, 1);
        m.fillRoundedRect(-5, -1, 10, 7, 2);
        m.lineStyle(2, color, 1);
        m.beginPath();
        m.arc(0, -1, 3.5, Math.PI, 0);
        m.strokePath();
        break;
      case 'synced': // 对勾
        m.beginPath();
        m.moveTo(-6, 0);
        m.lineTo(-2, 4);
        m.lineTo(6, -4);
        m.strokePath();
        break;
      case 'syncing': // 转圈的弧
        m.beginPath();
        m.arc(0, 0, 6, 0, Math.PI * 1.4);
        m.strokePath();
        break;
      case 'pending': // 向上的箭头
        m.beginPath();
        m.moveTo(0, 6);
        m.lineTo(0, -5);
        m.moveTo(-5, 0);
        m.lineTo(0, -5);
        m.lineTo(5, 0);
        m.strokePath();
        break;
      case 'merged': // 两条线汇成一条
        m.beginPath();
        m.moveTo(-6, -5);
        m.lineTo(0, 1);
        m.lineTo(6, -5);
        m.moveTo(0, 1);
        m.lineTo(0, 6);
        m.strokePath();
        break;
    }
  }
}
