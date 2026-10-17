import Phaser from 'phaser';
import { itemView, stockCard, themeBoard, type Feel, type GameState, type ThemeCard, type ThemeId, type ThemeMove } from '../../core/index.ts';
import { glyphKey, hasArt, stageIconKey, type Glyph } from '../assets.ts';
import { FEEL_CYCLE, FEEL_TERM, FEEL_WORD, ROLE_WORD, STAGE_WORD, term } from '../glossary.ts';
import type { Animator } from '../fx/anim.ts';
import { flameBurst, iceBurst } from '../fx/particles.ts';
import type { Rect } from '../rect.ts';
import { COLOR, FEEL_COLOR, PHONE, THEME_COLOR, TYPE, arrowOf, signColor, textOn } from '../theme.ts';
import { addGlyph, addImage, addPaper, addPill, addWood, setArt } from '../ui/art.ts';
import { addSpark, type Spark } from '../ui/spark.ts';
import { openThemeDetail } from './detail.ts';
import { preCount, themeHeat } from './tape.ts';
import { MIN_TEXT_SIZE, addText, setColor } from '../ui/text.ts';
import { bindTooltip } from '../ui/tooltip.ts';
import { BOARD } from './layout.ts';

/**
 * 一行里各部件相对行顶的位置。电脑上每行 98 高；手机横屏（0.5.5）看板在右边的标签页里，6 行挤进 348 高，
 * 每行两排：名字 + 小脸 + 状态签；热度条 + 5 天折线（有备注时换成备注）+ 昨天变化 + 大号热度。
 */
const G = PHONE
  ? { y0: 3, h: 56, barX: 50, barW: 104, barH: 12, right: 10, badge: { y: 28, s: 32 }, nameY: 3, nameSize: 15, faceY: 13, pillY: 3, pillH: 22, feelY: 14,
      barY: 36, heatY: 40, heatSize: 21, flameY: 46, noteY: 31, calY: -1, sparkX: 112, sparkY: 30, sparkW: 64, sparkH: 18, deltaX: 44, deltaY: 40, deltaSize: 13 }
  : { y0: 50, h: 98, barX: 52, barW: 128, barH: 14, right: 14, badge: { y: 26, s: 38 }, nameY: 6, nameSize: 16, faceY: 16, pillY: 6, pillH: 22, feelY: 17,
      barY: 48, heatY: 55, heatSize: 24, flameY: 61, noteY: 30, calY: 79, sparkX: 36, sparkY: 70, sparkW: 96, sparkH: 18, deltaX: 0, deltaY: 80, deltaSize: 14 };
const ROW_Y0 = BOARD.y + G.y0;
const ROW_H = G.h;
const BAR_X = BOARD.x + G.barX;
const BAR_W = G.barW;
const BAR_H = G.barH;
const RIGHT = BOARD.x + BOARD.w - G.right;
/** 迷你走势（最近 5 天的热度折线，6 个点） */
const SPARK_X = BAR_X + G.sparkX;
const SPARK_W = G.sparkW;
const SPARK_H = G.sparkH;
/** 热度变化达到这个值时显示火苗 / 冰晶 */
const HOT_DELTA = 4;
/** 流光：亮带宽度、扫一遍的时间 */
const SHINE_W = 14;
const SHINE_MS = 2600;

/** 状态签上的两个字：0.5.3 起和全局的 FEEL_WORD 是同一套叫法（说明书、教程、提示都这么叫）。 */
const FEEL_SHORT: Record<Feel, string> = FEEL_WORD;

/** 每行的情绪小脸：正火 / 太火冒汗，要火开心，降温难过，冷清的分「平平」和「没人理」。 */
function feelFace(feel: Feel, heat: number): Glyph {
  if (feel === 'hot' || feel === 'overheated') return 'face_hot';
  if (feel === 'warming') return 'face_happy';
  if (feel === 'cooling') return 'face_sad';
  return heat >= 15 ? 'face_calm' : 'face_cold';
}

interface Row {
  id: ThemeId;
  y: number;
  fill: Phaser.GameObjects.Rectangle;
  shine: Phaser.GameObjects.Rectangle;
  heat: Phaser.GameObjects.Text;
  feelPill: Phaser.GameObjects.Rectangle;
  feel: Phaser.GameObjects.Text;
  feelIcon: Phaser.GameObjects.Image;
  face: Phaser.GameObjects.Image;
  faceTw: Phaser.Tweens.Tween | null;
  faceKey: string;
  note: Phaser.GameObjects.Text;
  spark: Spark;
  sparkKey: string;
  delta: Phaser.GameObjects.Text;
  flame: Phaser.GameObjects.Image;
  ice: Phaser.GameObjects.Image;
  badge: Phaser.GameObjects.Image;
  shown: number;
  roll: Phaser.Tweens.Tween | null;
  flicker: Phaser.Tweens.Tween | null;
}

/**
 * 左栏风口看板：6 个风口，各有徽记、情绪小脸、状态签（图标 + 两个字）、大号热度数字、
 * 带流光的热度条（升温冒火、降温结冰）、最近 5 天热度折线；悬停看说明和成分股，点一行打开风口详情。
 * 情绪指标 / 熬夜复盘在手时多一行真实状态，大V带热时写明还剩几天、每天加多少。
 */
export class ThemeBoardView {
  private readonly scene: Phaser.Scene;
  private readonly rows = new Map<ThemeId, Row>();
  private state: GameState;
  private readonly calm: boolean;
  private first = true;

  constructor(scene: Phaser.Scene, s: GameState, calm: boolean) {
    this.scene = scene;
    this.state = s;
    this.calm = calm;
    this.root = scene.add.container(0, 0);
    // 手机上看板和群聊共用右边一块（标签页切换）：所有部件收进 root，切走时整块藏起来
    const before = scene.children.list.length;
    // 0.18.0 木材质（art-v3：不会变的框架）：电脑上看板外面一圈木框；手机上看板在标签页里，不加
    if (!PHONE) addWood(scene, BOARD.x - 6, BOARD.y - 6, BOARD.w + 12, BOARD.h + 12);
    addPaper(scene, BOARD.x, BOARD.y, BOARD.w, BOARD.h);
    // 手机上标题和那句提醒在标签页上（标签「风口」，长按看说明），这里不重复
    if (!PHONE) addText(scene, BOARD.x + 18, BOARD.y + 16, '风口', { size: TYPE.title, bold: true });
    // 0.5.1：防误解的那句话回到标题旁（小字），细节仍在悬停提示里
    if (!PHONE) addText(scene, RIGHT, BOARD.y + 31, '状态看走向，不看高低', { size: 11, color: COLOR.muted, originX: 1, originY: 0.5 });
    const headHit = scene.add.rectangle(BOARD.x + 8, BOARD.y + 8, BOARD.w - 16, 36, 0xffffff, 0.001).setOrigin(0, 0).setVisible(!PHONE);
    bindTooltip(headHit, () => ({ x: BOARD.x, y: BOARD.y, w: BOARD.w, h: 44 }), () => ({
      title: '风口看板',
      body: `每个风口一行：情绪小脸、状态、热度条（0–100，右边大数字）、最近 5 天的热度走势和昨天的变化。\n状态看最近几天往哪走，不看热度高低：热度 5 也可能「${FEEL_WORD.warming}」，热度 80 也可能「${FEEL_WORD.cooling}」。\n状态轮回：${FEEL_CYCLE}。\n点一行看这个风口的详情。`,
    }));
    themeBoard(s).forEach((c, i) => this.buildRow(c, ROW_Y0 + i * ROW_H, i));
    if (PHONE) this.root.add(scene.children.list.slice(before).filter((o) => o !== this.root));
    if (!calm) this.startShine();
    this.render(s);
  }

  private buildRow(c: ThemeCard, y: number, i: number): void {
    const s = this.scene;
    if (i > 0) s.add.rectangle(BOARD.x + 14, y - 2, BOARD.w - 28, 2, COLOR.edge).setOrigin(0, 0);
    const badge = addImage(s, BOARD.x + 30 - (PHONE ? 4 : 0), y + G.badge.y, `theme:${c.id}`, G.badge.s);
    const name = addText(s, BAR_X, y + G.nameY, c.name, { size: G.nameSize, bold: true });
    const face = addGlyph(s, name.x + name.width + 14, y + G.faceY, feelFace(c.feel, c.heat), 22);
    const feelPill = addPill(s, 0, y + G.pillY, 48, G.pillH, FEEL_COLOR[c.feel]);
    const feel = addText(s, 0, y + G.feelY, '', { size: 12, bold: true, originX: 0.5, originY: 0.5 });
    // 状态小图标（美术交付后才有；没有时只显示两个字）
    const feelIcon = addImage(s, 0, y + G.feelY, stageIconKey(c.feel), 16);
    const note = addText(s, PHONE ? SPARK_X : BAR_X, y + G.noteY, '', { size: 11, color: 0x7a3fa0 });
    // 热度条：底槽 + 风口色填充 + 一条慢慢扫过的亮带
    s.add.rectangle(BAR_X, y + G.barY, BAR_W, BAR_H, 0xeadcc8).setOrigin(0, 0).setRounded(BAR_H / 2).setStrokeStyle(2, COLOR.ink, 1);
    const fill = s.add.rectangle(BAR_X + 2, y + G.barY + 2, 1, BAR_H - 4, THEME_COLOR[c.id]).setOrigin(0, 0).setRounded((BAR_H - 4) / 2);
    const shine = s.add.rectangle(BAR_X + 2, y + G.barY + 2, SHINE_W, BAR_H - 4, 0xffffff, 0.5).setOrigin(0, 0).setVisible(false);
    const heat = addText(s, RIGHT, y + G.heatY, '', { size: G.heatSize, bold: true, num: true, color: THEME_COLOR[c.id], stroke: COLOR.ink, strokeWidth: 3, originX: 1, originY: 0.5 });
    const flame = addImage(s, 0, y + G.flameY, 'fx:flame_small', 14, 19).setOrigin(0.5, 1).setVisible(false);
    const ice = addImage(s, 0, y + G.heatY, 'fx:ice', 16).setVisible(false);
    // 「最近 5 天」：日历小图标 + 「5天」，后面是热度折线（手机上没地方写「5天」，说明在悬停里）
    const cal = addGlyph(s, BAR_X + 7, y + G.calY, 'calendar', 14).setVisible(!PHONE);
    const days = addText(s, BAR_X + 16, y + G.calY, '5天', { size: 10, color: COLOR.muted, originY: 0.5 }).setVisible(!PHONE);
    const spark = addSpark(s, SPARK_X, y + G.sparkY, SPARK_W, SPARK_H, c.trend, { kind: 'line', color: THEME_COLOR[c.id], area: true, dot: true, width: 2 });
    const delta = addText(s, RIGHT - G.deltaX, y + G.deltaY, '', { size: G.deltaSize, bold: true, num: true, originX: 1, originY: 0.5 });
    for (const o of [cal, days]) {
      o.setInteractive();
      bindTooltip(o, () => ({ x: BAR_X, y: y + 68, w: 34, h: 22 }), () => ({ title: '最近 5 天', body: '折线是这个风口最近 5 天的热度：左边是 5 天前，最右边的圆点是现在。最右边的数字是昨天一天的变化。' }));
    }
    const hit = s.add.rectangle(BOARD.x + 6, y, BOARD.w - 12, ROW_H - 4, 0xffffff, 0.001).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    bindTooltip(hit, () => ({ x: BOARD.x, y, w: BOARD.w, h: ROW_H }), () => this.tip(c.id));
    hit.on(Phaser.Input.Events.POINTER_UP, (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      openThemeDetail(this.scene, this.state, c.id);
    });
    this.rows.set(c.id, { id: c.id, y, fill, shine, heat, feelPill, feel, feelIcon, face, faceTw: null, faceKey: '', note, spark, sparkKey: '', delta, flame, ice, badge, shown: c.heat, roll: null, flicker: null });
  }

  /** 流光：一个循环计数器带动 6 条亮带，各行错开相位；只扫在已填充的部分上。 */
  private startShine(): void {
    const tw = this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: SHINE_MS,
      repeat: -1,
      onUpdate: (t) => {
        const v = t.getValue() ?? 0;
        let i = 0;
        for (const r of this.rows.values()) {
          const fw = r.fill.width;
          const p = (v + i * 0.17) % 1;
          i += 1;
          // 亮带从填充左边外面滑进来，到右头滑出去（多走 SHINE_W，首尾看起来是渐入渐出）
          const x0 = -SHINE_W + p * (fw + SHINE_W * 2);
          const l = Math.max(0, x0);
          const rr = Math.min(fw, x0 + SHINE_W);
          if (fw < 12 || rr - l < 1) {
            r.shine.setVisible(false);
            continue;
          }
          r.shine.setVisible(true).setPosition(BAR_X + 2 + l, r.fill.y).setSize(rr - l, BAR_H - 4);
        }
      },
    });
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => tw.remove());
  }

  private tip(id: ThemeId): { title: string; body: string; color: number; side: 'right' } | null {
    const c = themeBoard(this.state).find((x) => x.id === id);
    if (!c) return null;
    const stocks = c.stocks.map((sid) => {
      const st = stockCard(this.state, sid);
      return `${st.name}（${ROLE_WORD[st.role]}）`;
    });
    const real = c.stage ? STAGE_WORD[c.stage] : null;
    const stage = real ? (c.reviewed ? `\n${itemView('night_review').name}：昨天收盘时它其实是「${real}」（只管到今天开盘前）` : `\n${itemView('mood_meter').name}：昨天收盘时它其实是「${real}」`) : '';
    const boost = c.boost ? `\n有人在带这个风口：还有 ${c.boost.days} 天，每天热度 +${c.boost.dH}` : '';
    return {
      title: `${c.name} · ${FEEL_WORD[c.feel]} · 热度 ${c.heat}`,
      body: `${c.desc}\n这个风口的股票：${stocks.join('、')}${stage}${boost}\n\n${term(FEEL_TERM[c.feel]).explain}\n看板上的状态是按热度和走势算的，只是参考；接下来怎么走，谁也说不准。\n点一下看详情。`,
      color: THEME_COLOR[c.id],
      side: 'right',
    };
  }

  render(s: GameState): void {
    this.state = s;
    for (const c of themeBoard(s)) {
      const r = this.rows.get(c.id);
      if (!r) continue;
      // 热度变了：数字和热度条滚过去（第一次画、减少动态时直接跳到位）
      r.roll?.stop();
      r.roll = null;
      if (!this.first && !this.calm && Math.abs(c.heat - r.shown) >= 1) {
        const from = r.shown;
        r.roll = this.scene.tweens.addCounter({ from: 0, to: 1, duration: 450, ease: 'Sine.easeOut', onUpdate: (t) => this.setHeat(r, from + (c.heat - from) * (t.getValue() ?? 1)), onComplete: () => this.setHeat(r, c.heat) });
      } else this.setHeat(r, c.heat);
      this.setFeel(r, c);
      const vals = themeHeat(s, c.id, 6);
      const key = vals.join(',');
      if (key !== r.sparkKey) {
        r.spark.setPre(preCount(s, vals.length)).set(vals);
        if (!this.first) r.spark.play(500, this.calm);
        r.sparkKey = key;
      }
      r.delta.setText(c.lastDelta === 0 ? '0' : `${arrowOf(c.lastDelta)}${Math.abs(c.lastDelta)}`);
      setColor(r.delta, signColor(c.lastDelta));
      this.setNote(r, c);
      this.setMarks(r, c.lastDelta);
    }
    this.first = false;
  }

  /** 行内备注：道具给的真实状态（看板按走势猜，会慢一拍）、大V带热（每天 +几，还剩几天）。放不下时逐步缩写。 */
  private setNote(r: Row, c: ThemeCard): void {
    const room = PHONE ? RIGHT - G.deltaX - 34 - SPARK_X : RIGHT - BAR_X;
    const real = c.stage ? STAGE_WORD[c.stage] : null;
    const tries: string[][] = [
      [real ? `实际：${real}（看板慢一拍）` : '', c.boost ? `大V带热 +${c.boost.dH}×${c.boost.days}天` : ''],
      [real ? `实际：${real}` : '', c.boost ? `大V带热 +${c.boost.dH}×${c.boost.days}天` : ''],
      [real ? `实际：${real}` : '', c.boost ? `带热+${c.boost.dH}×${c.boost.days}天` : ''],
    ];
    r.note.setFontSize(Math.max(MIN_TEXT_SIZE, 11));
    // 手机上备注和 5 天折线共用一块：有备注时折线让位（折线在悬停 / 详情里还有）
    if (PHONE) {
      const tries2 = [...tries, [real ? real : '', c.boost ? `+${c.boost.dH}×${c.boost.days}` : '']];
      for (const t of tries2) {
        r.note.setText(t.filter(Boolean).join(' · '));
        if (r.note.width <= room) break;
      }
      r.spark.g.setVisible(r.note.text === '');
      return;
    }
    for (const t of tries) {
      r.note.setText(t.filter(Boolean).join(' · '));
      if (r.note.width <= room) return;
    }
    r.note.setFontSize(10);
  }

  private setHeat(r: Row, heat: number): void {
    r.shown = heat;
    const w = Math.max(1, ((BAR_W - 4) * Math.max(0, Math.min(100, heat))) / 100);
    r.fill.setSize(w, BAR_H - 4);
    r.heat.setText(`${Math.round(heat)}`);
    r.flame.setX(BAR_X + 2 + w);
    r.ice.setX(BAR_X + 2 + w);
  }

  /** 状态签「图标 + 两个字」，名字旁边的情绪小脸跟着换（动画开着时轻轻晃，太火的晃得快）。 */
  private setFeel(r: Row, c: Pick<ThemeCard, 'feel' | 'heat'>): void {
    const icon = setArt(r.feelIcon, stageIconKey(c.feel));
    r.feel.setText(FEEL_SHORT[c.feel]);
    r.feelIcon.setVisible(icon);
    const iw = icon ? 18 : 0;
    const w = r.feel.width + 14 + iw;
    r.feelPill.setPosition(RIGHT - w, r.y + G.pillY).setSize(w, G.pillH).setFillStyle(FEEL_COLOR[c.feel]);
    r.feelIcon.setX(RIGHT - w + 6 + 8);
    r.feel.setX(RIGHT - w + 7 + iw + r.feel.width / 2);
    setColor(r.feel, textOn(FEEL_COLOR[c.feel]));
    const g = feelFace(c.feel, c.heat);
    const key = `${g}:${c.feel}`;
    if (key === r.faceKey) return;
    r.faceKey = key;
    setArt(r.face, glyphKey(g));
    r.face.setDisplaySize(22, 22).setAngle(0);
    r.faceTw?.remove();
    r.faceTw = null;
    if (!this.calm) {
      const fast = c.feel === 'overheated';
      r.faceTw = this.scene.tweens.add({ targets: r.face, angle: { from: -7, to: 7 }, duration: fast ? 260 : 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }
  /** 火苗（升温）/ 冰晶（降温）标记；火苗轻轻跳动。 */
  private setMarks(r: Row, d: number): void {
    const hot = d >= HOT_DELTA;
    r.flame.setVisible(hot);
    r.ice.setVisible(d <= -HOT_DELTA);
    if (hot && !r.flicker && !this.calm) {
      r.flicker = this.scene.tweens.add({ targets: r.flame, scaleY: { from: r.flame.scaleY, to: r.flame.scaleY * 1.18 }, duration: 260, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    } else if (!hot && r.flicker) {
      r.flicker.remove();
      r.flicker = null;
    }
  }

  /** ① 热度变化：6 根热度条同时动，升温冒火、退潮结冰（大幅退潮时潮水漫过）。 */
  async animate(anim: Animator, moves: ThemeMove[], ms: number): Promise<void> {
    const from = new Map(moves.map((m) => [m.id, m.heatBefore]));
    for (const m of moves) {
      const r = this.rows.get(m.id);
      if (!r) continue;
      const x = BAR_X + 2 + ((BAR_W - 4) * m.heat) / 100;
      if (m.dH >= HOT_DELTA) flameBurst(this.scene, anim, x, r.y + G.barY + 2, Math.min(8, 2 + Math.round(m.dH / 3)));
      if (m.dH <= -HOT_DELTA) iceBurst(this.scene, anim, x, r.y + G.heatY, Math.min(8, 2 + Math.round(-m.dH / 3)));
      if (m.dH <= -10) this.tide(anim, r);
      this.setFeel(r, { feel: m.feel, heat: m.heat });
    }
    await anim.drive(ms, (t) => {
      const e = 1 - (1 - t) * (1 - t);
      for (const m of moves) {
        const r = this.rows.get(m.id);
        if (r) this.setHeat(r, (from.get(m.id) ?? m.heat) + (m.heat - (from.get(m.id) ?? m.heat)) * e);
      }
    });
    for (const m of moves) {
      const r = this.rows.get(m.id);
      if (r) this.setMarks(r, m.dH);
    }
  }

  private tide(anim: Animator, r: Row): void {
    if (anim.calm || !hasArt(this.scene.textures, 'fx:tide')) return;
    const img = addImage(this.scene, BOARD.x + 8, r.y + G.barY + 8, 'fx:tide', BOARD.w - 16, 30).setOrigin(0, 0.5).setAlpha(0);
    anim.fx({ targets: img, alpha: { from: 0.9, to: 0 }, x: BOARD.x + 30, duration: 900, ease: 'Sine.easeOut' }, () => img.destroy());
  }

  /** 题材徽记的世界坐标（龙头不在持仓时，连线从这里出发）。 */
  badgeCenter(id: ThemeId): { x: number; y: number } | null {
    const r = this.rows.get(id);
    return r ? { x: r.badge.x, y: r.badge.y } : null;
  }

  rect(): Rect {
    return { ...BOARD };
  }

  /** 手机上整块装在这里，切标签页时显隐 */
  private readonly root: Phaser.GameObjects.Container;

  /** 手机标签页：显示 / 藏起整块看板（电脑上一直显示）。 */
  setShown(on: boolean): void {
    if (!PHONE) return;
    this.root.setVisible(on);
    this.glow?.setVisible(on);
  }

  get shown(): boolean {
    return !PHONE || this.root.visible;
  }

  private glow: Phaser.GameObjects.Graphics | null = null;

  /** 高亮几行：primary（猫提到的风口）描粗边，others（今天推荐里的风口）描细边；都为空时清掉。 */
  setHighlight(primary: readonly string[], others: readonly string[]): void {
    this.glow ??= this.scene.add.graphics().setDepth(1);
    const g = this.glow;
    g.clear();
    for (const [id, r] of this.rows) {
      const main = primary.includes(id);
      if (!main && !others.includes(id)) continue;
      g.lineStyle(main ? 3 : 2, main ? COLOR.accent : 0xf3c27a, main ? 1 : 0.9);
      g.strokeRoundedRect(BOARD.x + 6, r.y - 2, BOARD.w - 12, ROW_H - 6, 10);
      if (main) g.fillStyle(COLOR.accent, 0.08).fillRoundedRect(BOARD.x + 6, r.y - 2, BOARD.w - 12, ROW_H - 6, 10);
    }
    // 手机上看板不在当前页时，高亮框也不能画在群聊上面
    g.setVisible(this.shown);
  }
}
