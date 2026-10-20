/** 一张牌的显示对象：牌面（或牌背）+ 级牌/逢人配标识 + 选中高光。原点在牌中心。 */
import Phaser from 'phaser';
import { isWild, rankOf, type Card } from '../../variants/guandan/core/index.ts';
import { getSettings } from '../store.ts';
import { CARD_H, CARD_W, cardKey } from '../textures.ts';

export const HAND_W = 92;
export const HAND_H = Math.round((HAND_W * CARD_H) / CARD_W);

export class CardView extends Phaser.GameObjects.Container {
  readonly card: Card;
  private face: Phaser.GameObjects.Image;
  private mark: Phaser.GameObjects.Image | null = null;
  private glow: Phaser.GameObjects.Graphics | null = null;
  private shade: Phaser.GameObjects.Graphics | null = null;
  private faceUp: boolean;
  readonly cw: number;
  readonly ch: number;

  constructor(scene: Phaser.Scene, x: number, y: number, card: Card, level: number, width = HAND_W, faceUp = true) {
    super(scene, x, y);
    this.card = card;
    this.cw = width;
    this.ch = Math.round((width * CARD_H) / CARD_W);
    this.faceUp = faceUp;
    const shadow = scene.add.graphics();
    shadow.fillStyle(0x000000, 0.28).fillRoundedRect(-this.cw / 2 + 1, -this.ch / 2 + 3, this.cw, this.ch, this.cw * 0.07);
    this.add(shadow);
    this.face = scene.add.image(0, 0, faceUp ? cardKey(card) : `back:${getSettings().back}`).setDisplaySize(this.cw, this.ch);
    this.add(this.face);
    if (faceUp && level > 0) this.setLevel(level);
    this.setSize(this.cw, this.ch);
    scene.add.existing(this);
  }

  /** 按本副级数加标识：逢人配（红桃级牌）更醒目，其余级牌金色角标。 */
  setLevel(level: number): void {
    this.mark?.destroy();
    this.mark = null;
    if (!this.faceUp) return;
    const key = isWild(this.card, level) ? 'mark:wild' : rankOf(this.card) === level ? 'mark:level' : null;
    if (key) {
      this.mark = this.scene.add.image(0, 0, key).setDisplaySize(this.cw, this.ch);
      this.add(this.mark);
    }
  }

  flip(up: boolean, level: number): void {
    this.faceUp = up;
    this.face.setTexture(up ? cardKey(this.card) : `back:${getSettings().back}`).setDisplaySize(this.cw, this.ch);
    this.setLevel(level);
  }

  /** 选中：金色描边高光。 */
  setSelected(on: boolean): void {
    if (on && !this.glow) {
      const g = this.scene.add.graphics();
      g.lineStyle(4, 0xffd25a, 1).strokeRoundedRect(-this.cw / 2 - 1, -this.ch / 2 - 1, this.cw + 2, this.ch + 2, this.cw * 0.08);
      g.fillStyle(0xffe08a, 0.16).fillRoundedRect(-this.cw / 2, -this.ch / 2, this.cw, this.ch, this.cw * 0.07);
      this.add(g);
      this.glow = g;
    } else if (!on && this.glow) {
      this.glow.destroy();
      this.glow = null;
    }
  }

  /** 不能点（进贡时不允许交的牌）：压暗。 */
  setDim(on: boolean): void {
    if (on && !this.shade) {
      const g = this.scene.add.graphics();
      g.fillStyle(0x1a120c, 0.5).fillRoundedRect(-this.cw / 2, -this.ch / 2, this.cw, this.ch, this.cw * 0.07);
      this.add(g);
      this.shade = g;
    } else if (!on && this.shade) {
      this.shade.destroy();
      this.shade = null;
    }
  }
}
