import Phaser from 'phaser';
import { dailySetup, difficultyDef, difficultyView, formatMoney, personaById, personaView } from '../../core/index.ts';
import { isPersonaUnlocked, type Profile } from '../../platform/profile.ts';
import { dailyDate, dailyText, levelLabel } from '../labels.ts';
import { COLOR, TYPE } from '../theme.ts';
import { addGlyph, addPill } from '../ui/art.ts';
import { bindTooltip } from '../ui/tooltip.ts';
import { wanShort } from './bits.ts';
import { Button } from '../ui/button.ts';
import { Dialog } from '../ui/dialog.ts';
import { addText } from '../ui/text.ts';
import { addBadge, addPortrait } from './setupPanel.ts';
import { phoneLayout } from '../viewport.ts';

const W = 640;

/**
 * 今天的每日挑战（按北京日期）：人设、市场环境、种子、今日最好成绩，「开始挑战」；「排行榜」看今天的排行（0.5.10）。
 * onBoard 为 null（0.8.0 单独部署，没有平台）时不放「排行榜」。
 */
export class DailyPanel extends Dialog {
  constructor(
    scene: Phaser.Scene,
    profile: Profile,
    onStart: (seed: string, setup: ReturnType<typeof dailySetup>['setup']) => void,
    onBoard: ((date: string) => void) | null,
    date = dailyDate(),
  ) {
    // 手机横屏（444 高）放不下 440：内容本来只到 316，面板收到 400，按钮跟着上移
    const H = phoneLayout(scene) ? 400 : 440;
    super(scene, W, H, `每日挑战 · ${date}`);
    const d = dailySetup(date);
    const p = personaView(d.setup.persona);
    const lv = difficultyView(d.setup.difficulty);
    this.inner.add(addPortrait(scene, 120, 196, p, false, 160));
    // 右：三块整宽的小卡（0.16.0，以前三行字挤在左边、右半空着）：人设、难度、今日最好；长说明都在悬停
    const R = 230;
    const RW = W - 32 - R;
    const row = (y: number, h: number): Phaser.GameObjects.Rectangle =>
      scene.add.rectangle(R, y, RW, h, COLOR.paperHi, 0.9).setOrigin(0, 0).setRounded(12).setStrokeStyle(2, COLOR.edge, 1);
    const tip = (y: number, h: number, content: () => { title: string; body: string }): Phaser.GameObjects.Rectangle => {
      const hit = scene.add.rectangle(R, y, RW, h, 0xffffff, 0.001).setOrigin(0, 0);
      bindTooltip(hit, () => ({ x: this.inner.x + R, y: this.inner.y + y, w: RW, h }), content);
      return hit;
    };
    this.inner.add(row(72, 80));
    this.inner.add(addText(scene, R + 16, 84, p.name, { size: TYPE.title + 4, bold: true }));
    this.inner.add(addText(scene, R + 16, 118, `${wanShort(p.account)} · ${personaById(p.id).short ?? p.title}`, { size: TYPE.label + 2, color: COLOR.ink }));
    if (!isPersonaUnlocked(profile, p.id)) this.inner.add([addPill(scene, R + RW - 64, 84, 48, 22, COLOR.accent), addText(scene, R + RW - 40, 95, '试玩', { size: TYPE.label, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 })]);
    const pHit = tip(72, 80, () => ({ title: `${p.name}（${p.title}）`, body: `${p.desc}${isPersonaUnlocked(profile, p.id) ? '' : '\n还没解锁的人设，今天可以先试玩'}` }));
    this.inner.add(row(168, 72));
    this.inner.add(addBadge(scene, R + 36, 204, lv.level, 48));
    this.inner.add(addText(scene, R + 72, 184, lv.name, { size: TYPE.title, bold: true }));
    this.inner.add(addText(scene, R + 72, 210, difficultyDef(lv.level).short ?? lv.desc, { size: TYPE.label, color: COLOR.muted }));
    const dHit = tip(168, 72, () => ({ title: levelLabel(lv.level, lv.name), body: lv.detail ? `${lv.desc}\n${lv.detail}` : lv.desc }));
    // 今日最好：奖杯 + 数字；没打过写一句，不只是一道横线
    const rec = profile.daily[date];
    this.inner.add(row(256, 64));
    this.inner.add(addGlyph(scene, R + 36, 288, 'trophy', 36));
    const played = !!rec && rec.attempts > 0;
    this.inner.add(addText(scene, R + 72, 270, '今日最好', { size: TYPE.label - 2, bold: true, color: COLOR.muted }));
    const best = !rec || !played ? '今天还没打' : rec.won ? formatMoney(rec.bestAccount) : `撑到 ${rec.bestMonths}/12 月`;
    this.inner.add(addText(scene, R + 72, 286, best, { size: played ? TYPE.title + 2 : TYPE.title, bold: true, num: played, color: played ? COLOR.ink : COLOR.muted }));
    const rHit = tip(256, 64, () => ({
      title: '今日挑战',
      body: `${dailyText(rec)}\n今天所有人玩的都是同一局：同样的开局、人设和市场环境。\n每日挑战只记今天的成绩、成就和图鉴，不会解锁新难度。\n这一局的编号：${d.seed}`,
    }));
    this.inner.add([pHit, dHit, rHit]);
    const go = new Button(scene, W - 32 - 180, H - 66, { width: 180, height: 48, label: '开始', variant: 'primary', fontSize: 18, hotkey: '回车' });
    go.setHandler(() => {
      this.close();
      onStart(d.seed, d.setup);
    });
    const back = new Button(scene, 32, H - 62, { width: 110, height: 40, label: '返回', fontSize: 15, hotkey: 'Esc' });
    back.setHandler(() => this.close());
    this.inner.add([go, back]);
    this.named['daily:start'] = go;
    this.named['daily:back'] = back;
    if (onBoard) {
      const board = new Button(scene, 32 + 110 + 16, H - 62, { width: 120, height: 40, label: '排行榜', icon: 'trophy', fontSize: 15 });
      board.setHandler(() => {
        this.close();
        onBoard(date);
      });
      this.inner.add(board);
      this.named['daily:board'] = board;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') go.press();
    };
    scene.input.keyboard?.on('keydown', onKey);
    this.once(Phaser.GameObjects.Events.DESTROY, () => scene.input.keyboard?.off('keydown', onKey));
  }
}
