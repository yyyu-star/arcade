/** 牌型图示：规则页和新手引导共用。用真实牌面小图拼出例子。 */
import Phaser from 'phaser';
import { makeCard, type Card } from '../../core/index.ts';
import { COLOR, TYPE } from '../theme.ts';
import { CardView } from '../table/card.ts';
import { fitWidth, text } from './kit.ts';

const C = (spec: string): Card[] => {
  // 简写："S3 H7 SJ BJ"（S 黑桃 H 红桃 C 梅花 D 方块，SJ 小王 BJ 大王）
  const used = new Set<Card>();
  return spec.split(' ').map((t) => {
    let c: Card;
    if (t === 'SJ') c = makeCard(16, 0);
    else if (t === 'BJ') c = makeCard(17, 0);
    else {
      const suit = 'SHCD'.indexOf(t[0]!);
      const r = t.slice(1);
      const rank = r === 'J' ? 11 : r === 'Q' ? 12 : r === 'K' ? 13 : r === 'A' ? 14 : Number(r);
      c = makeCard(rank, suit);
    }
    if (used.has(c)) c += 54;
    used.add(c);
    return c;
  });
};

export interface PatternDemo {
  name: string;
  note: string;
  cards: Card[];
  bomb?: boolean;
}

export const PATTERNS: PatternDemo[] = [
  { name: '单张', note: '一张', cards: C('SA') },
  { name: '对子', note: '两张同点', cards: C('H8 C8') },
  { name: '三张', note: '三张同点', cards: C('D9 S9 C9') },
  { name: '三带二', note: '三张 + 一对', cards: C('S7 H7 D7 C5 S5') },
  { name: '顺子', note: '5 张连着', cards: C('S3 H4 C5 D6 S7') },
  { name: '三连对', note: '3 个连着的对子', cards: C('S3 H3 C4 D4 S5 H5') },
  { name: '钢板', note: '2 个连着的三张', cards: C('S7 H7 D7 C8 S8 H8') },
  { name: '炸弹', note: '4~10 张同点', cards: C('S9 H9 C9 D9'), bomb: true },
  { name: '同花顺', note: '同花色 5 张连着', cards: C('H5 H6 H7 H8 H9'), bomb: true },
  { name: '天王炸', note: '4 个王，最大', cards: C('SJ SJ BJ BJ'), bomb: true },
];

/** 一排小牌（叠放），原点在第一张牌中心。 */
export function miniCards(scene: Phaser.Scene, x: number, y: number, cards: readonly Card[], w = 44, step = 20, level = 0): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  cards.forEach((card, i) => c.add(new CardView(scene, i * step, 0, card, level, w)));
  return c;
}

/** 牌型卡片：名字 + 小牌 + 一句说明。宽约 w。 */
export function patternTile(scene: Phaser.Scene, x: number, y: number, p: PatternDemo, w = 250): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  g.fillStyle(p.bomb ? 0xfbe3d8 : 0xf3e6c9, 1).fillRoundedRect(-w / 2, -58, w, 116, 12);
  g.lineStyle(2, p.bomb ? COLOR.red : 0xc9b48e, 1).strokeRoundedRect(-w / 2, -58, w, 116, 12);
  c.add(g);
  const name = text(scene, -w / 2 + 14, -38, p.name, { size: TYPE.body, bold: true, color: p.bomb ? COLOR.red : COLOR.ink, ox: 0 });
  c.add(name);
  // 手机上字托底到 12 像素，"三连对 3 个连着的对子"这种一行放不下：说明从尾巴删字，剩不到三个字就不写（示例牌本身就说明了）
  const room = w - 26 - name.width - 10;
  const note = fitWidth(text(scene, w / 2 - 12, -38, p.note, { size: TYPE.small, color: COLOR.muted, ox: 1 }), room);
  if (Array.from(note.text).length >= 4) c.add(note);
  else note.destroy();
  // 示例牌放大到 54 宽（art-v3，手机上 44 宽的牌看不清点数）；6 张时总宽 184，格子 254 放得下
  const step = p.cards.length > 5 ? 26 : 32;
  const span = (p.cards.length - 1) * step;
  c.add(miniCards(scene, -span / 2, 17, p.cards, 54, step));
  return c;
}
