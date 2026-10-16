import Phaser from 'phaser';
import { dailySetup, difficultyDef, difficultyView, formatMoney, personaById, personaView } from '../../core/index.ts';
import { isPersonaUnlocked, type Profile } from '../../platform/profile.ts';
import { dailyDate, dailyText, levelLabel } from '../labels.ts';
import { COLOR, TYPE } from '../theme.ts';
import { addGlyph } from '../ui/art.ts';
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
    // 右：人设（名字 + 本钱 · 短话）、难度（徽章 + 名字 + 短话）、今日最好；长说明都在悬停
    const R = 230;
    this.inner.add(addText(scene, R, 96, p.name, { size: TYPE.title + 4, bold: true }));
    this.inner.add(addText(scene, R, 132, `${wanShort(p.account)} · ${personaById(p.id).short ?? p.title}`, { size: TYPE.label + 2, color: COLOR.ink }));
    if (!isPersonaUnlocked(profile, p.id)) this.inner.add(addText(scene, R, 160, '试玩', { size: TYPE.label, bold: true, color: COLOR.accentDark }));
    const pHit = scene.add.rectangle(40, 70, W - 80, 110, 0xffffff, 0.001).setOrigin(0, 0);
    bindTooltip(pHit, () => ({ x: this.inner.x + 40, y: this.inner.y + 70, w: W - 80, h: 110 }), () => ({
      title: `${p.name}（${p.title}）`,
      body: `${p.desc}${isPersonaUnlocked(profile, p.id) ? '' : '\n还没解锁的人设，今天可以先试玩'}`,
    }));
    this.inner.add(addBadge(scene, R + 24, 222, lv.level, 48));
    this.inner.add(addText(scene, R + 58, 210, lv.name, { size: TYPE.title, bold: true }));
    this.inner.add(addText(scene, R + 58, 236, difficultyDef(lv.level).short ?? lv.desc, { size: TYPE.label, color: COLOR.muted }));
    const dHit = scene.add.rectangle(R, 192, W - R - 40, 60, 0xffffff, 0.001).setOrigin(0, 0);
    bindTooltip(dHit, () => ({ x: this.inner.x + R, y: this.inner.y + 192, w: W - R - 40, h: 60 }), () => ({ title: levelLabel(lv.level, lv.name), body: lv.detail ? `${lv.desc}\n${lv.detail}` : lv.desc }));
    // 今日最好：奖杯 + 数字
    const rec = profile.daily[date];
    this.inner.add(addGlyph(scene, R + 20, 292, 'trophy', 36));
    const best = !rec || rec.attempts === 0 ? '—' : rec.won ? formatMoney(rec.bestAccount) : `${rec.bestMonths}/12`;
    this.inner.add(addText(scene, R + 46, 292, best, { size: TYPE.title + 2, bold: true, num: true, originY: 0.5 }));
    const rHit = scene.add.rectangle(R, 268, 240, 48, 0xffffff, 0.001).setOrigin(0, 0);
    bindTooltip(rHit, () => ({ x: this.inner.x + R, y: this.inner.y + 268, w: 240, h: 48 }), () => ({
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
