import type Phaser from 'phaser';
import { difficultyView, personaView } from '../../core/index.ts';
import type { ChallengeView } from '../../platform/challenge.ts';
import { versionDiffers } from '../challenge.ts';
import { boardScoreText } from '../labels.ts';
import { COLOR, SPACE, TYPE } from '../theme.ts';
import { addGlyph } from '../ui/art.ts';
import { Button } from '../ui/button.ts';
import { Dialog } from '../ui/dialog.ts';
import { addText, fitWidth } from '../ui/text.ts';
import { phoneLayout } from '../viewport.ts';
import { addBadge, addPortrait } from './setupPanel.ts';

/** 电脑、手机横屏各一套（和每日排行面板同一个尺寸）：面板宽高、每页几行、行高、第一行的 y、"我"那一行和翻页键的 y */
const DESK = { w: 600, h: 540, per: 10, rowH: 32, top: 84, meY: 418, pagerY: 540 - 66 } as const;
const PHONE_UI = { w: 620, h: 424, per: 7, rowH: 30, top: 70, meY: 290, pagerY: 424 - 56 } as const;

/**
 * 0.13.0 好友挑战的成绩表：平台给的前 50 名（每页 10 行，手机 7 行），下面单独一行"我"。
 * 样子跟每日排行面板走；只显示昵称、成绩和这局的称号（平台不给用户名），我那一行标亮。
 */
export class ChallengePanel extends Dialog {
  private readonly G: typeof DESK | typeof PHONE_UI;
  private page = 0;
  private rows: Phaser.GameObjects.Container;
  private readonly view: ChallengeView;

  constructor(scene: Phaser.Scene, view: ChallengeView, onClosed?: () => void) {
    const G = phoneLayout(scene) ? PHONE_UI : DESK;
    super(scene, G.w, G.h, `${view.owner} 发起的挑战`, onClosed);
    this.G = G;
    this.view = view;
    this.rows = scene.add.container(0, 0);
    this.inner.add(this.rows);
    this.draw();
  }

  private draw(): void {
    const s = this.scene;
    const G = this.G;
    const v = this.view;
    this.rows.destroy();
    this.rows = s.add.container(0, 0);
    this.inner.add(this.rows);
    delete this.named['challenge:prev'];
    delete this.named['challenge:next'];
    const pages = Math.max(1, Math.ceil(v.results.length / G.per));
    this.page = Math.max(0, Math.min(pages - 1, this.page));
    v.results.slice(this.page * G.per, (this.page + 1) * G.per).forEach((e, i) => {
      const y = G.top + i * G.rowH;
      if (e.isMe) this.rows.add(s.add.rectangle(28, y, G.w - 56, G.rowH - 2, COLOR.accent, 0.18).setOrigin(0, 0).setRounded(8));
      const cy = y + (G.rowH - 2) / 2;
      const medal = e.rank <= 3 ? [0xe8b33a, 0xa9b4c0, 0xc58a5a][e.rank - 1]! : null;
      if (medal !== null) this.rows.add(s.add.circle(66, cy, 13, medal));
      this.rows.add(addText(s, 66, cy, `${e.rank}`, { size: TYPE.label + 1, bold: true, num: true, color: medal !== null ? COLOR.paper : COLOR.ink, originX: 0.5, originY: 0.5 }));
      const score = addText(s, G.w - 44, cy, boardScoreText(e.score), { size: TYPE.label + 1, bold: true, num: true, color: COLOR.ink, originX: 1, originY: 0.5 });
      const name = addText(s, 98, cy, `${e.displayName}${e.isMe ? '（我）' : ''}${e.stats ? ` · ${e.stats.title}` : ''}`, { size: TYPE.label + 1, bold: e.isMe, color: COLOR.ink, originY: 0.5 });
      // 昵称加称号可能很长：截到分数左边留一格，不压住分数
      fitWidth(name, score.x - score.width - SPACE.md - 98);
      this.rows.add([name, score]);
    });
    const me = v.me ? `我：第 ${v.me.rank ?? '—'} 名 · ${boardScoreText(v.me.score)}` : '我：还没交过成绩';
    this.rows.add(s.add.rectangle(28, G.meY - 4, G.w - 56, 2, COLOR.edge, 0.6).setOrigin(0, 0));
    this.rows.add(addText(s, 44, G.meY + 18, `${me}（共 ${v.count} 人）`, { size: TYPE.label + 1, bold: true, color: COLOR.ink, originY: 0.5 }));
    if (pages > 1) {
      const prev = new Button(s, G.w - 44 - 84 * 2 - 60, G.pagerY, { width: 84, height: 40, label: '上一页', fontSize: 14, sound: 'select' });
      const label = addText(s, G.w - 44 - 84 - 30, G.pagerY + 20, `${this.page + 1}/${pages}`, { size: 14, bold: true, num: true, color: COLOR.muted, originX: 0.5, originY: 0.5 });
      const next = new Button(s, G.w - 44 - 84, G.pagerY, { width: 84, height: 40, label: '下一页', fontSize: 14, sound: 'select' });
      prev.setEnabled(this.page > 0).setHandler(() => this.turn(-1));
      next.setEnabled(this.page < pages - 1).setHandler(() => this.turn(1));
      this.rows.add([prev, label, next]);
      this.named['challenge:prev'] = prev;
      this.named['challenge:next'] = next;
    }
    const foot = versionDiffers(v.payload.v) ? '每人只算第一次 · 发起时的版本和你的不同，结果可能对不上' : '每人只算第一次，30 天内有效';
    this.rows.add(addText(s, 44, G.pagerY + 20, foot, { size: 13, color: COLOR.dim, originY: 0.5 }));
  }

  private turn(d: number): void {
    this.page += d;
    this.draw();
  }
}

/**
 * 发起后的链接框：复制链接、发给朋友（有系统分享时）。点按钮是新的一下点击，iOS 的系统分享调得起来
 * （发起要等平台回话，等完再分享就过了点击的那一下）。
 */
export class ChallengeLinkDialog extends Dialog {
  constructor(scene: Phaser.Scene, url: string, text: string) {
    super(scene, 520, 280, '挑战建好了');
    this.inner.add(
      addText(scene, 32, 76, '好友打开链接就是这一局的同一个开局，你的成绩已经记在第一条。每人只算第一次，30 天内有效。', { size: TYPE.label + 2, color: COLOR.ink, wrap: 520 - 64, lineSpacing: 6 }),
    );
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    const { primary } = this.actions(
      {
        label: '复制链接',
        name: 'challenge:copy',
        onClick: () => {
          void navigator.clipboard?.writeText(url).then(
            () => primary?.setLabel('已复制'),
            () => primary?.setLabel('复制不了'),
          );
        },
      },
      typeof nav.share === 'function'
        ? {
            label: '发给朋友',
            name: 'challenge:share',
            // 点击里直接调（前面不能有 await），iOS 才认是人点的
            onClick: () => void nav.share!({ text, url }).catch(() => undefined),
          }
        : null,
    );
  }
}

/**
 * 0.18.0 打开好友挑战链接、还没打过时的卡：左边这局的人设立绘，右边发起人（头像圈写名字头一个字，平台不给头像）、
 * 难度徽记和他的成绩。以前是普通对话框里三行字，看不出是谁、玩哪个人设。
 */
export class ChallengeInviteDialog extends Dialog {
  constructor(scene: Phaser.Scene, v: ChallengeView, onAccept: () => void) {
    const W = 600;
    const H = 320;
    super(scene, W, H, '好友挑战');
    const p = v.payload.setup;
    const pv = personaView(p.persona);
    const lv = difficultyView(p.difficulty);
    this.inner.add(addPortrait(scene, 112, 178, pv, false, 136));
    const R = 216;
    const head = Array.from(v.owner)[0] ?? '?';
    this.inner.add([
      scene.add.circle(R + 22, 98, 22, COLOR.accent).setStrokeStyle(3, COLOR.ink, 1),
      addText(scene, R + 22, 98, head, { size: 20, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 }),
    ]);
    const who = addText(scene, R + 56, 98, `${v.owner} 挑战你`, { size: TYPE.title, bold: true, color: COLOR.ink, originY: 0.5 });
    fitWidth(who, W - 32 - R - 56);
    this.inner.add(who);
    const len = p.short ? `短局 ${p.short.months} 个月` : '完整一年';
    this.inner.add(addBadge(scene, R + 22, 152, lv.level, 40));
    this.inner.add(addText(scene, R + 56, 152, `${pv.name} · ${lv.name} · ${len}`, { size: TYPE.label + 2, bold: true, color: COLOR.ink, originY: 0.5 }));
    if (v.ownerScore !== null) {
      this.inner.add(addGlyph(scene, R + 22, 196, 'trophy', 30));
      this.inner.add(addText(scene, R + 56, 196, boardScoreText(v.ownerScore), { size: TYPE.title, bold: true, num: true, color: COLOR.ink, originY: 0.5 }));
    }
    const foot = versionDiffers(v.payload.v) ? '发起时的版本和你的不同，结果可能对不上。每人只算第一次。' : '同一个开局、同一段行情，每人只算第一次。';
    this.inner.add(addText(scene, R, 226, foot, { size: TYPE.label, color: COLOR.muted, wrap: W - 32 - R }));
    const go = (fn: () => void) => (): void => {
      this.close();
      fn();
    };
    this.actions({ label: '接受挑战', name: 'challenge:accept', onClick: go(onAccept) }, { label: '先不了', name: 'challenge:no', onClick: go(() => undefined) });
  }
}
