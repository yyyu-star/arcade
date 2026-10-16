import Phaser from 'phaser';
import { stockCard, themeBoard, type GameState, type Mood } from '../../core/index.ts';
import type { Glyph } from '../assets.ts';
import { pctArrow } from '../labels.ts';
import { COLOR, PHONE, THEME_COLOR, signColor } from '../theme.ts';
import { addGlyph, addImage } from '../ui/art.ts';
import { addSpark, type Spark } from '../ui/spark.ts';
import { addText, setColor } from '../ui/text.ts';
import { bindTooltip } from '../ui/tooltip.ts';
import { MONITOR } from './layout.ts';
import { marketMoves, preCount, sumMoves, toLevels } from './tape.ts';

/** 0.5.1 中央显示器「今日大盘屏」的位置（压在背景显示器上） */
/** 手机横屏（0.5.5）：开盘键上面一块小屏，只写天气、大环境涨跌和一个大数字；走势、风口榜、跑马灯在「风口」页和详情里 */
const SCREEN = PHONE ? { x: MONITOR.x, y: MONITOR.y, w: MONITOR.w, h: MONITOR.h } : ({ x: 480, y: 458, w: 348, h: 118 } as const);

const MOOD_GLYPH: Record<Mood, Glyph> = { bull: 'sun', flat: 'cloud', bear: 'storm' };
const MOOD_NAME: Record<Mood, string> = { bull: '晴', flat: '阴', bear: '雷雨' };

/**
 * 今日大盘屏：左上天气 + 大盘昨天涨跌，右上昨天账户盈亏（大字），中间大盘近 20 天走势（画出来）+ 风口热度榜前三，
 * 下沿行情跑马灯（风口图标 + 箭头数字、连板个股），每 2 秒滑一格。
 */
export class MarketScreen {
  private readonly scene: Phaser.Scene;
  /** 右上大字（昨天的钱 / 开盘！/ 收盘） */
  readonly big: Phaser.GameObjects.Text;
  /** 屏幕下方桌面上的一行提示（还能买几只 · 空格开盘） */
  readonly sub: Phaser.GameObjects.Text;
  private readonly subBg: Phaser.GameObjects.Rectangle;
  private weather: Phaser.GameObjects.Image;
  private readonly mkt: Phaser.GameObjects.Text;
  private readonly spark: Spark;
  private readonly sparkLabel: Phaser.GameObjects.Text;
  private readonly board: Phaser.GameObjects.Container;
  private readonly tape: Phaser.GameObjects.Container;
  private tapeItems: Phaser.GameObjects.Container[] = [];
  private tapeQueue: { icon: string | null; text: string; color: number }[] = [];
  private tapeNext = 0;
  private readonly idle: boolean;
  private state: GameState | null = null;
  private sig = '';

  constructor(scene: Phaser.Scene, idle: boolean) {
    this.scene = scene;
    this.idle = idle;
    const { x, y, w, h } = SCREEN;
    scene.add.rectangle(x, y, w, h, COLOR.screen, 0.94).setOrigin(0, 0).setRounded(10).setStrokeStyle(2, 0x2c3e55, 1);
    // 扫描线质感：几条极淡的横线
    const lines = scene.add.graphics();
    lines.fillStyle(0xffffff, 0.035);
    for (let k = 4; k < h; k += 6) lines.fillRect(x + 4, y + k, w - 8, 1);
    this.weather = addGlyph(scene, x + 18, y + 16, 'sun', 24);
    this.mkt = addText(scene, x + 34, y + 16, '', { size: 13, bold: true, color: COLOR.screenText, originY: 0.5 });
    this.big = PHONE
      ? addText(scene, x + w / 2, y + 41, '', { size: 17, bold: true, num: true, color: COLOR.screenText, originX: 0.5, originY: 0.5 })
      : addText(scene, x + w - 10, y + 16, '', { size: 17, bold: true, num: true, color: COLOR.screenText, originX: 1, originY: 0.5 });
    // 走势
    scene.add.rectangle(x + 8, y + 32, 176, 54, 0x000000, 0.18).setOrigin(0, 0).setRounded(6).setVisible(!PHONE);
    this.spark = addSpark(scene, x + 14, y + 38, 164, 36, [], { kind: 'line', area: true, dot: true, width: 2, preLabel: !PHONE });
    this.sparkLabel = addText(scene, x + 178, y + 76, '', { size: 9, color: 0x8fa6bd, originX: 1, originY: 0.5 }).setVisible(!PHONE);
    if (PHONE) for (const n of this.spark.nodes()) (n as unknown as Phaser.GameObjects.Components.Visible).setVisible(false);
    const wHit = scene.add.rectangle(x + 4, y + 4, 120, 24, 0xffffff, 0.001).setOrigin(0, 0).setInteractive();
    bindTooltip(wHit, () => ({ x: x + 4, y: y + 4, w: 120, h: 24 }), () => ({ title: '大环境', body: '天气图标是昨天的大环境：晴是好行情、阴是一般、雷雨是坏行情；后面是大环境昨天的涨跌。' }));
    const hit = scene.add.rectangle(x + 8, y + 32, 176, 54, 0xffffff, 0.001).setOrigin(0, 0).setInteractive().setVisible(!PHONE);
    bindTooltip(hit, () => ({ x: x + 8, y: y + 32, w: 176, h: 54 }), () => ({ title: '大环境走势', body: '大环境最近几十个交易日的走势（只看已经收盘的日子）。窗外的天气跟着它变：晴是好行情、雷雨是坏行情。' }));
    this.board = scene.add.container(0, 0).setVisible(!PHONE);
    // 跑马灯
    scene.add.rectangle(x + 4, y + h - 28, w - 8, 24, 0x000000, 0.28).setOrigin(0, 0).setRounded(6).setVisible(!PHONE);
    this.tape = scene.add.container(0, 0).setVisible(!PHONE);
    // 桌面上那行提示：手机上没有桌面，开盘键和持仓的现金块上已经写了还能买几只，不另外放
    this.subBg = scene.add.rectangle(x + w / 2, y + h + 15, 10, 22, 0x1d2a3a, 0.82).setRounded(11).setVisible(!PHONE);
    this.sub = addText(scene, x + w / 2, y + h + 15, '', { size: 12, bold: true, color: 0xe8f1fb, originX: 0.5, originY: 0.5 }).setVisible(!PHONE);
    if (idle && !PHONE) scene.time.addEvent({ delay: 2000, loop: true, callback: () => this.step() });
  }

  /** 按状态刷新（同一天重复调用不重画走势动画）。 */
  render(s: GameState): void {
    this.state = s;
    const moves = marketMoves(s, 20);
    const last = s.lastDay;
    const mood = last ? last.market.mood : s.mood;
    const sig = `${s.seed}:${last?.day ?? -1}:${moves.length}`;
    // 天气 + 大盘
    // 0.9.1 交易场景一天里 render 好几次（买卖、展开收起都调）：天气图标和前三名没变就不重建（每次重建都要重新栅格化几段文字）
    if (mood !== this.weatherMood) {
      this.weatherMood = mood;
      this.weather.destroy();
      this.weather = addGlyph(this.scene, SCREEN.x + 18, SCREEN.y + 16, MOOD_GLYPH[mood], 24);
    }
    const mret = last ? last.market.ret : (moves[moves.length - 1] ?? 0);
    this.mkt.setText(`${MOOD_NAME[mood]} ${moves.length ? pctArrow(mret) : ''}`);
    setColor(this.mkt, moves.length ? mixLight(signColor(mret)) : COLOR.screenText);
    // 走势
    const levels = toLevels(moves);
    const pre = preCount(s, moves.length);
    this.spark.setPre(pre > 0 ? pre + 1 : 0).set(levels);
    if (sig !== this.sig) this.spark.play(700, !this.idle);
    this.sparkLabel.setText(moves.length ? `近${moves.length}天 ${pctArrow(sumMoves(moves))}` : '还没开盘');
    this.sig = sig;
    // 风口热度榜前三（按昨天热度变化）
    const cards = themeBoard(s);
    const top = [...cards].sort((a, b) => b.lastDelta - a.lastDelta).slice(0, 3);
    const bsig = top.map((c) => `${c.id}:${Math.round(c.lastDelta)}`).join('|');
    const bx = SCREEN.x + 194;
    if (bsig !== this.boardSig) this.board.removeAll(true);
    (bsig === this.boardSig ? [] : top).forEach((c, i) => {
      const yy = SCREEN.y + 40 + i * 17;
      const medal = this.scene.add.circle(bx + 6, yy, 6, [0xffd23f, 0xd8dde6, 0xd99a5a][i] ?? 0xffffff).setStrokeStyle(1, 0x000000, 0.4);
      const n = addText(this.scene, bx + 6, yy, `${i + 1}`, { size: 9, bold: true, color: COLOR.ink, originX: 0.5, originY: 0.5 });
      const ic = addImage(this.scene, bx + 24, yy, `theme:${c.id}`, 16);
      const nm = addText(this.scene, bx + 36, yy, c.name, { size: 12, bold: true, color: 0xe8f1fb, originY: 0.5 });
      const d = Math.round(c.lastDelta);
      const dv = addText(this.scene, SCREEN.x + SCREEN.w - 10, yy, d === 0 ? '→0' : `${d > 0 ? '↑' : '↓'}${Math.abs(d)}`, { size: 13, bold: true, num: true, color: d === 0 ? 0x8fa6bd : mixLight(signColor(d)), originX: 1, originY: 0.5 });
      this.board.add([medal, n, ic, nm, dv]);
    });
    this.boardSig = bsig;
    // 跑马灯内容：风口热度变化、连板个股、大盘
    const q: { icon: string | null; text: string; color: number }[] = [];
    for (const c of cards) {
      const d = Math.round(c.lastDelta);
      q.push({ icon: `theme:${c.id}`, text: `${c.name} ${Math.round(c.heat)}${d === 0 ? '' : d > 0 ? ` ↑${d}` : ` ↓${-d}`}`, color: d === 0 ? 0xc7d6e6 : mixLight(signColor(d)) });
    }
    for (const id of Object.keys(s.stocks)) {
      const st = s.stocks[id];
      if (!st || st.delisted || st.boards < 1) continue;
      const sc = stockCard(s, id);
      q.push({ icon: `theme:${sc.theme}`, text: `${sc.name} 涨停${st.boards > 1 ? `×${st.boards}` : ''}`, color: mixLight(COLOR.up) });
    }
    if (moves.length) q.push({ icon: null, text: `大环境 ${pctArrow(mret)}`, color: mixLight(signColor(mret)) });
    const qsig = q.map((x) => x.text).join('|');
    if (qsig !== this.tapeSig) {
      this.tapeSig = qsig;
      this.tapeQueue = q;
      this.tapeNext = 0;
      this.fillTape();
    }
  }

  private tapeSig = '';
  private boardSig = '';
  private weatherMood: string | null = null;

  private makeItem(it: { icon: string | null; text: string; color: number }, x: number): Phaser.GameObjects.Container {
    const yy = SCREEN.y + SCREEN.h - 16;
    const parts: Phaser.GameObjects.GameObject[] = [];
    let dx = 0;
    if (it.icon) {
      parts.push(addImage(this.scene, 8, 0, it.icon, 15));
      dx = 18;
    }
    const t = addText(this.scene, dx, 0, it.text, { size: 12, bold: true, num: true, color: it.color, originY: 0.5 });
    parts.push(t);
    const c = this.scene.add.container(x, yy, parts);
    c.setData('w', dx + t.width + 16);
    return c;
  }

  /** 从头摆满一条（只摆放得下的）。 */
  private fillTape(): void {
    for (const c of this.tapeItems) c.destroy();
    this.tapeItems = [];
    let x = SCREEN.x + 10;
    const right = SCREEN.x + SCREEN.w - 8;
    for (let k = 0; k < this.tapeQueue.length; k++) {
      const it = this.tapeQueue[(this.tapeNext + k) % this.tapeQueue.length];
      if (!it) break;
      const c = this.makeItem(it, x);
      const w = c.getData('w') as number;
      if (x + w - 16 > right) {
        c.destroy();
        break;
      }
      this.tape.add(c);
      this.tapeItems.push(c);
      x += w;
    }
    this.tapeNext = (this.tapeNext + this.tapeItems.length) % Math.max(1, this.tapeQueue.length);
  }

  /** 跑马灯滑一格：最左边一条淡出，其余左移，末尾补一条。 */
  private step(): void {
    if (!this.scene.sys.isActive() || this.tapeItems.length === 0 || this.tapeQueue.length <= this.tapeItems.length) return;
    const first = this.tapeItems.shift();
    if (!first) return;
    const w = first.getData('w') as number;
    this.scene.tweens.add({ targets: first, alpha: 0, duration: 260, onComplete: () => first.destroy() });
    for (const c of this.tapeItems) this.scene.tweens.add({ targets: c, x: c.x - w, duration: 420, ease: 'Sine.easeInOut' });
    const lastC = this.tapeItems[this.tapeItems.length - 1];
    const endX = lastC ? lastC.x - w + (lastC.getData('w') as number) : SCREEN.x + 10;
    const it = this.tapeQueue[this.tapeNext % this.tapeQueue.length];
    if (!it) return;
    const c = this.makeItem(it, endX);
    if (endX + (c.getData('w') as number) - 16 > SCREEN.x + SCREEN.w - 8) {
      c.destroy();
      return;
    }
    this.tapeNext = (this.tapeNext + 1) % this.tapeQueue.length;
    c.setAlpha(0);
    this.scene.tweens.add({ targets: c, alpha: 1, duration: 420, delay: 200 });
    this.tape.add(c);
    this.tapeItems.push(c);
  }

  /** 桌面上那行提示（空串时藏起来）。 */
  setSub(text: string): void {
    this.sub.setText(text);
    if (PHONE) return;
    this.subBg.setSize(this.sub.width + 22, 22).setVisible(text !== '');
    this.subBg.setDisplayOrigin((this.sub.width + 22) / 2, 11);
  }
}

/** 屏幕是深色底：涨跌色提亮一点 */
function mixLight(c: number): number {
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  const m = (v: number): number => Math.round(v + (255 - v) * 0.35);
  return (m(r) << 16) | (m(g) << 8) | m(b);
}
