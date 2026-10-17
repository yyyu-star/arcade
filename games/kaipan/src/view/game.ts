import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.ts';
import { EndScene } from './scenes/EndScene.ts';
import { TitleScene } from './scenes/TitleScene.ts';
import { TradeScene } from './scenes/TradeScene.ts';
import { showBanner } from './segments.ts';
import type { Session } from './session.ts';
import { COLOR, RENDER_SCALE, VIEW, css } from './theme.ts';

/**
 * 创建 Phaser 游戏：先进入加载场景预加载素材，再由 Session 进入开始菜单或指定局面。
 * 画布按 RENDER_SCALE 倍的实际像素绘制（各场景相机同倍数 zoom）。
 */
export function startGame(session: Session, parent: string, opts: { toTitle: boolean }): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: VIEW.w * RENDER_SCALE,
    height: VIEW.h * RENDER_SCALE,
    backgroundColor: css(COLOR.bg),
    banner: false,
    roundPixels: true,
    // Phaser 默认在启动和切回标签页后有 120 帧「冷却」，期间每帧时间被压到 16.7ms；
    // 低帧率设备上这会让开头十几秒的动画慢好几倍，所以缩短到 12 帧（超长帧仍按 200ms 截断）
    fps: { panicMax: 12 },
    // 0.14.0 EXPAND：窗口不是 16:9 时画布跟着变长，不再留空条；世界的摆法见 viewport.ts 的 cameraFor
    scale: { mode: Phaser.Scale.EXPAND, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [new BootScene(session, opts.toTitle), new TitleScene(session), new TradeScene(session), new EndScene(session)],
  });
  // 0.5.9：拿不到 WebGL 时 Phaser.AUTO 自己退回 Canvas；WebGL 用着用着丢了（显存吃紧时 iOS 会收回），Phaser 会等它恢复。
  // 3 秒还没恢复才提示刷新，恢复了就收起；同一时间只有一条
  game.events.once(Phaser.Core.Events.READY, () => {
    let wait: ReturnType<typeof setTimeout> | null = null;
    let close: (() => void) | null = null;
    game.canvas.addEventListener('webglcontextlost', () => {
      console.warn('WebGL 上下文丢了（多半是显存不够），等它恢复');
      if (wait || close) return;
      wait = setTimeout(() => {
        wait = null;
        close = showBanner('画面出了点问题，刷新一下页面就好（进度都存着）');
      }, 3000);
    });
    game.canvas.addEventListener('webglcontextrestored', () => {
      if (wait) clearTimeout(wait);
      wait = null;
      close?.();
      close = null;
    });
  });
  return game;
}
