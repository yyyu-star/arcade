/**
 * 第一次玩的分步引导：认牌型 → 逢人配 → 出牌和提示 → 队友与目标。随时可跳过；设置里能重看。
 * 每步一屏，图多字少。
 */
import Phaser from 'phaser';
import { makeCard } from '../variants/guandan/core/index.ts';
import { levelName } from './labels.ts';
import { setTutorialDone } from './store.ts';
import { COLOR, TYPE } from './theme.ts';
import { Button, panel, text, worldH, worldW } from './ui/kit.ts';
import { PATTERNS, miniCards, patternTile } from './ui/patterns.ts';
import type { Button as Btn } from './ui/kit.ts';

export interface TutorialTargets {
  play: Btn;
  hint: Btn;
  pass: Btn;
  sort: Btn;
}

/** 当前是否在引导中（冒烟用） */
export const tutorialState = { step: -1, buttons: {} as Record<string, { x: number; y: number }> };

export function runTutorial(scene: Phaser.Scene, t: TutorialTargets, level: number): Promise<void> {
  return new Promise((resolve) => {
    const W = worldW(scene);
    const root = scene.add.container(0, 0).setDepth(6000);
    const dim = scene.add.graphics();
    root.add(dim);
    const blocker = scene.add.zone(0, 0, W, worldH).setOrigin(0, 0).setInteractive();
    root.add(blocker);
    const page = scene.add.container(0, 0);
    root.add(page);
    let step = 0;
    const steps = 4;

    const finish = (): void => {
      setTutorialDone(true);
      tutorialState.step = -1;
      scene.tweens.add({ targets: root, alpha: 0, duration: 160, onComplete: () => root.destroy() });
      resolve();
    };

    const nav = (y: number, last: boolean): void => {
      const dots = scene.add.container(W / 2, y - 52);
      for (let i = 0; i < steps; i++) dots.add(scene.add.circle((i - (steps - 1) / 2) * 22, 0, 6, i === step ? COLOR.red : 0xc9b48e));
      page.add(dots);
      tutorialState.buttons = { skip: { x: W / 2 - 130, y }, next: { x: W / 2 + 130, y } };
      page.add(new Button(scene, W / 2 - 130, y, 200, 58, '跳过', 'wood', finish));
      page.add(
        new Button(scene, W / 2 + 130, y, 200, 58, last ? '开打！' : '下一步', 'red', () => {
          if (last) finish();
          else {
            step++;
            show();
          }
        }),
      );
    };

    const fullDim = (): void => {
      dim.clear();
      dim.fillStyle(COLOR.overlay, 0.66).fillRect(0, 0, W, worldH);
    };

    const show = (): void => {
      tutorialState.step = step;
      page.removeAll(true);
      if (step === 0) {
        fullDim();
        const p = panel(scene, 1140, 560, '认牌型');
        p.setPosition(W / 2, 352);
        page.add(p);
        const pick = [0, 1, 3, 4, 5, 6, 7, 8, 9].map((i) => PATTERNS[i]!);
        pick.slice(0, 8).forEach((pt, i) => {
          page.add(patternTile(scene, W / 2 - 405 + (i % 4) * 270, 218 + Math.floor(i / 4) * 128, pt, 254));
        });
        page.add(text(scene, W / 2, 420, '红色的是炸弹：能压任何普通牌型', { size: TYPE.body, bold: true, color: COLOR.red }));
        nav(560, false);
      } else if (step === 1) {
        fullDim();
        const p = panel(scene, 860, 480, '逢人配');
        p.setPosition(W / 2, 330);
        page.add(p);
        const wild = makeCard(level, 1);
        const big = miniCards(scene, W / 2 - 230, 300, [wild], 150, 0, level);
        page.add(big);
        scene.tweens.add({ targets: big, angle: { from: -4, to: 4 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        page.add(text(scene, W / 2 + 90, 230, `红桃${levelName(level)}`, { size: TYPE.big, bold: true, color: COLOR.red, font: 'title' }));
        page.add(text(scene, W / 2 + 90, 290, '= 万能牌', { size: TYPE.big, bold: true, color: COLOR.goldDark, font: 'title' }));
        page.add(text(scene, W / 2 + 90, 346, '能当除王以外的任何牌\n凑顺子、凑炸弹都行', { size: TYPE.body, color: COLOR.ink }));
        page.add(text(scene, W / 2, 420, `本副打 ${levelName(level)}：所有 ${levelName(level)} 都是级牌，比 A 还大`, { size: TYPE.label, color: COLOR.muted }));
        nav(520, false);
      } else if (step === 2) {
        // 聚光：按钮区亮着，其余压暗
        dim.clear();
        dim.fillStyle(COLOR.overlay, 0.6);
        const top = t.play.y - 44;
        dim.fillRect(0, 0, W, top);
        dim.fillRect(0, top + 88, W, worldH - top - 88);
        dim.fillRect(0, top, t.sort.x - 80, 88);
        dim.fillRect(t.play.x + 92, top, W - t.play.x - 92, 88);
        const tip = (x: number, y: number, msg: string, color: number = COLOR.goldLight): void => {
          page.add(text(scene, x, y, msg, { size: TYPE.body, bold: true, color, stroke: 0x1a0e07, strokeWidth: 5 }));
        };
        tip(t.play.x, top - 34, '出牌 ↓');
        tip(t.hint.x, top - 34, '不会出？点提示 ↓');
        tip(t.pass.x, top - 74, '压不过就 不要 ↓');
        tip(t.sort.x, top - 34, '换个理牌方式 ↓');
        tip(W / 2, top + 150, '↓ 点牌选中，按住滑动能一次选好几张 ↓', 0xffffff);
        page.add(text(scene, W / 2, 130, '出牌和提示', { size: TYPE.big, bold: true, color: COLOR.goldLight, font: 'title', stroke: COLOR.redDark, strokeWidth: 6 }));
        nav(250, false);
      } else {
        fullDim();
        const p = panel(scene, 860, 460, '队友和目标');
        p.setPosition(W / 2, 330);
        page.add(p);
        const av = (x: number, id: string, name: string, color: number): void => {
          page.add(scene.add.image(x, 270, `avatar:${id}:happy`).setDisplaySize(110, 110));
          page.add(text(scene, x, 345, name, { size: TYPE.body, bold: true, color }));
        };
        av(W / 2 - 250, 'me', '你', COLOR.teamUs);
        page.add(text(scene, W / 2 - 165, 270, '+', { size: TYPE.big, bold: true, color: COLOR.teamUs }));
        av(W / 2 - 80, 'xiaomei', '小美（对家）', COLOR.teamUs);
        page.add(text(scene, W / 2 + 60, 270, 'VS', { size: TYPE.big, bold: true, color: COLOR.muted, font: 'num' }));
        av(W / 2 + 175, 'laozhang', '老张', COLOR.teamThem);
        av(W / 2 + 300, 'aqiang', '阿强', COLOR.teamThem);
        page.add(text(scene, W / 2, 410, '先出完的队升级，从 2 打到 A，过 A 就赢', { size: TYPE.body, bold: true, color: COLOR.ink }));
        nav(500, true);
      }
    };
    show();
  });
}
