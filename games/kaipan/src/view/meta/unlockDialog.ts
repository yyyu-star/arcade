import Phaser from 'phaser';
import { achievementView, difficultyDef, difficultyView, personaById, personaView } from '../../core/index.ts';
import { sparkles } from '../fx/particles.ts';
import type { Animator } from '../fx/anim.ts';
import { TIER_NAME, levelLabel } from '../labels.ts';
import { sound } from '../sound.ts';
import { COLOR, TYPE } from '../theme.ts';
import { addGlyph } from '../ui/art.ts';
import { wanShort } from './bits.ts';
import { Button } from '../ui/button.ts';
import { Dialog, phonePanel } from '../ui/dialog.ts';
import { addText } from '../ui/text.ts';
import { bindTooltip, type TipContent } from '../ui/tooltip.ts';
import { achievementBadge } from './codexPanel.ts';
import { addBadge, addPortrait } from './setupPanel.ts';
import type { Unlock } from './unlocks.ts';
import { phoneLayout } from '../viewport.ts';


const W = 480;
const H = 360;
/** 成就多时一排放 6 个（宽一点），尽量两排放下，每个都能写一句说明。 */
const gridCols = (n: number): number => (n > 10 ? 6 : 5);
const gridW = (n: number): number => (n > 10 ? 1000 : 800);
/** 手机横屏：一排最多 8 个，按面板宽度（phonePanel）每格至少 108 算个数；一页两排（多了翻页） */
const PHONE_COLS = 8;
const PHONE_CELL = 108;
const PHONE_ROW_H = 118;

/** 一条达成 / 解锁的弹窗：成就（档位框 + 图标）、新人设（立绘）、新难度（徽记）。 */
class UnlockDialog extends Dialog {
  constructor(scene: Phaser.Scene, anim: Animator, u: Unlock, index: number, total: number, onClosed: () => void) {
    const title = u.kind === 'achievements' ? `达成 ${u.ids.length} 个成就` : u.kind === 'achievement' ? (u.secret ? '隐藏结局' : '达成成就') : u.kind === 'persona' ? '解锁新人设' : '解锁新难度';
    const grid = u.kind === 'achievements';
    const n = grid ? u.ids.length : 0;
    const phone = phoneLayout(scene);
    const pp = phone ? phonePanel(scene) : null;
    const GRID_COLS = pp ? Math.max(1, Math.min(PHONE_COLS, n, Math.floor((pp.w - 48) / PHONE_CELL))) : gridCols(n);
    const perPage = phone ? GRID_COLS * 2 : n;
    const rows = grid ? Math.ceil(Math.min(n, perPage) / GRID_COLS) : 0;
    const w = grid ? (pp ? Math.min(pp.w, Math.max(W, GRID_COLS * PHONE_CELL + 48)) : gridW(n)) : W;
    // 0.5：格子里只放徽章 + 名字（档位看框色），条件放悬停
    const rowH = phone ? PHONE_ROW_H : rows <= 2 ? 150 : 124;
    const h = grid ? (pp ? Math.min(pp.h, 150 + rows * rowH) : 160 + rows * rowH) : H;
    super(scene, w, h, `${title}${total > 1 ? `（${index + 1}/${total}）` : ''}`, onClosed);
    const cx = w / 2;
    let name = '';
    let body = '';
    let nameColor: number = COLOR.accentDark;
    let tip: TipContent | null = null;
    if (u.kind === 'achievements') {
      const cell = (w - 48) / GRID_COLS;
      const box = scene.add.container(0, 0);
      this.inner.add(box);
      const pages = Math.max(1, Math.ceil(n / perPage));
      const draw = (k: number): void => {
        box.removeAll(true);
        u.ids.slice(k * perPage, (k + 1) * perPage).forEach((id, i) => {
          const a = achievementView(id);
          const x = 24 + cell * (i % GRID_COLS) + cell / 2;
          const y = 76 + Math.floor(i / GRID_COLS) * rowH;
          const compact = rowH < 140;
          const badge = achievementBadge(scene, x, y + (phone ? 34 : compact ? 38 : 46), a.tier, a.icon, true, phone ? 64 : compact ? 68 : 84);
          box.add(badge);
          box.add(addText(scene, x, y + (phone ? 72 : compact ? 80 : 98), a.name, { size: TYPE.label + 1, bold: true, color: COLOR.ink, originX: 0.5, wrap: cell - 8, align: 'center' }));
          if (a.unlocks) box.add(addGlyph(scene, x + 34, y + 10, 'gift', 26));
          const hit = scene.add.rectangle(x - cell / 2, y, cell, rowH - 8, 0xffffff, 0.001).setOrigin(0, 0).setInteractive();
          bindTooltip(hit, () => ({ x: this.inner.x + x - cell / 2, y: this.inner.y + y, w: cell, h: rowH - 8 }), () => ({ title: `${a.name}（${TIER_NAME[a.tier]}）`, body: a.unlocks ? `${a.desc}\n同时解锁人设：${personaView(a.unlocks).name}` : a.desc }));
          box.add(hit);
        });
        if (pages <= 1) return;
        // 手机上一页放不下：标题行右边两个小按钮翻页（命名 unlock:prev / unlock:next）
        const prev = new Button(scene, w - 160, 16, { width: 44, height: 38, label: '‹', fontSize: 20, sound: 'select' });
        const next = new Button(scene, w - 110, 16, { width: 44, height: 38, label: '›', fontSize: 20, sound: 'select' });
        prev.setEnabled(k > 0);
        next.setEnabled(k < pages - 1);
        prev.setHandler(() => draw(k - 1));
        next.setHandler(() => draw(k + 1));
        box.add([prev, next]);
        this.named['unlock:prev'] = prev;
        this.named['unlock:next'] = next;
      };
      draw(0);
    } else if (u.kind === 'achievement') {
      const a = achievementView(u.id);
      this.inner.add(achievementBadge(scene, cx, 140, a.tier, a.icon, true, 112));
      name = a.name;
      nameColor = COLOR.ink;
      body = a.desc;
      if (a.unlocks) {
        const p = personaView(a.unlocks);
        this.inner.add(addGlyph(scene, cx + 54, 92, 'gift', 40));
        tip = { title: '同时解锁人设', body: p.name };
      }
    } else if (u.kind === 'persona') {
      const p = personaView(u.id);
      this.inner.add(addPortrait(scene, cx, 132, p, false, 104));
      name = p.name;
      body = `${wanShort(p.account)} · ${personaById(p.id).short ?? p.title}`;
      tip = { title: `${p.name}（${p.title}）`, body: p.desc };
    } else {
      const d = difficultyView(u.level);
      this.inner.add(addBadge(scene, cx, 140, d.level, 100));
      name = `${d.level} · ${d.name}`;
      body = difficultyDef(d.level).short ?? d.desc;
      tip = { title: levelLabel(d.level, d.name), body: d.detail ? `${d.desc}\n${d.detail}` : d.desc };
    }
    if (name) this.inner.add(addText(scene, cx, 214, name, { size: TYPE.big - 4, bold: true, color: nameColor, originX: 0.5 }));
    if (body) this.inner.add(addText(scene, cx, 252, body, { size: TYPE.label + 2, color: COLOR.ink, originX: 0.5, align: 'center', wrap: W - 64, lineSpacing: 3 }));
    if (tip) {
      const t = tip;
      const hit = scene.add.rectangle(cx - 150, 70, 300, 210, 0xffffff, 0.001).setOrigin(0, 0);
      bindTooltip(hit, () => ({ x: this.inner.x + cx - 150, y: this.inner.y + 70, w: 300, h: 210 }), () => t);
      this.inner.add(hit);
    }
    const ok = new Button(scene, cx - 80, h - 62, { width: 160, height: 44, label: index + 1 < total ? '下一个' : '好耶', variant: 'primary', fontSize: 16, hotkey: '空格' });
    ok.setHandler(() => this.close());
    this.inner.add(ok);
    this.named['unlock:ok'] = ok;
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Space' || e.code === 'Enter') ok.press();
    };
    scene.input.keyboard?.on('keydown', onKey);
    this.once(Phaser.GameObjects.Events.DESTROY, () => scene.input.keyboard?.off('keydown', onKey));
    sound.cue({ type: 'rewardShow' });
    sparkles(scene, anim, this.inner.x + cx, this.inner.y + (grid ? h / 2 : 140), 14);
  }
}

/** 依次弹出达成与解锁，全部关掉后回调。没有要弹的直接回调。 */
export function playUnlocks(scene: Phaser.Scene, anim: Animator, list: Unlock[], onOpen: (d: Dialog) => void, done: () => void): void {
  const next = (i: number): void => {
    const u = list[i];
    if (!u) return done();
    // 关掉一个的同一帧里不能马上开下一个（对话框标记下一帧才放开）
    const d = new UnlockDialog(scene, anim, u, i, list.length, () => scene.time.delayedCall(30, () => next(i + 1)));
    onOpen(d);
  };
  next(0);
}
