/**
 * 斗地主单机第一次进牌桌的分步引导：叫分 → 地主先出 → 出牌 / 提示 / 不要 → 怎么算分。随时可跳过；设置里的"重看引导"会一起清掉标记。
 * 外壳（遮罩、点阵、跳过 / 下一步）和掼蛋的引导共用（tutorial.ts 的 runTutorialSteps），看过记在 guandan.ddz.tutorial（只在本机）。
 */
import Phaser from 'phaser';
import { makeCard } from '../variants/guandan/core/index.ts';
import { setDdzTutorialDone } from './store.ts';
import { runTutorialSteps } from './tutorial.ts';
import { COLOR, TYPE } from './theme.ts';
import { Button, panel, text } from './ui/kit.ts';
import { miniCards } from './ui/patterns.ts';

export function runDdzTutorial(scene: Phaser.Scene): Promise<void> {
  return runTutorialSteps(scene, 4, () => setDdzTutorialDone(true), (step, { W, page, fullDim, nav }) => {
    fullDim();
    const note = (y: number, msg: string, opts: { bold?: boolean; color?: number } = {}): void => {
      page.add(text(scene, W / 2, y, msg, { size: TYPE.body, bold: opts.bold ?? false, color: opts.color ?? COLOR.ink }));
    };
    if (step === 0) {
      const p = panel(scene, 860, 460, '先叫分');
      p.setPosition(W / 2, 330);
      page.add(p);
      const chips: [string, 'wood' | 'gold' | 'red'][] = [['不叫', 'wood'], ['1 分', 'gold'], ['2 分', 'gold'], ['3 分', 'red']];
      chips.forEach(([label, kind], i) => page.add(new Button(scene, W / 2 - 285 + i * 190, 250, 160, 60, label, kind, () => undefined)));
      note(340, '轮到你就叫一个分，只能比前面的高', { bold: true });
      note(390, '叫分最高的人当地主；都不叫就重新发牌');
      nav(520, false);
    } else if (step === 1) {
      const p = panel(scene, 860, 460, '地主先出');
      p.setPosition(W / 2, 330);
      page.add(p);
      page.add(miniCards(scene, W / 2 - 100, 255, [makeCard(14, 0), makeCard(14, 1), makeCard(5, 2)], 90, 100));
      note(340, '地主拿走 3 张底牌，先出牌', { bold: true, color: COLOR.red });
      note(390, '另外两位是农民，联手对付地主');
      nav(520, false);
    } else if (step === 2) {
      const p = panel(scene, 860, 460, '出牌');
      p.setPosition(W / 2, 330);
      page.add(p);
      page.add(new Button(scene, W / 2 - 200, 250, 168, 60, '不要', 'wood', () => undefined));
      page.add(new Button(scene, W / 2, 250, 168, 60, '提示', 'gold', () => undefined));
      page.add(new Button(scene, W / 2 + 200, 250, 168, 60, '出牌', 'red', () => undefined));
      note(335, '点牌选中，按住滑动能一次选好几张', { bold: true });
      note(380, '不会出就点 提示；压不过就 不要');
      note(420, '炸弹压一切，王炸最大', { color: COLOR.red });
      nav(520, false);
    } else {
      const p = panel(scene, 860, 460, '分怎么来');
      p.setPosition(W / 2, 330);
      page.add(p);
      note(240, '每副的分 = 叫分 × 倍数', { bold: true, color: COLOR.red });
      note(290, '炸弹、王炸、春天，各翻一倍');
      note(350, '地主赢：比如这副 3 分，地主赢 6 分，农民各输 3 分');
      note(395, '农民赢：反过来。三家加起来总是 0');
      nav(520, true);
    }
  });
}
