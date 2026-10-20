/** 加载场景：把所有 SVG 烘焙成纹理（带进度条），然后进标题页或直接进牌桌（URL 开局）。 */
import Phaser from 'phaser';
import { app } from '../app.ts';
import { loadTitleFont } from '../fonts.ts';
import { bakeAll, ensureBackdrops } from '../textures.ts';
import { COLOR } from '../theme.ts';
import { worldH, worldW } from '../ui/kit.ts';
import { showErrorPanel } from '../errors.ts';
import { detectOnce } from '../platform.ts';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    this.cameras.main.setOrigin(0, 0).setZoom(this.scale.gameSize.height / worldH);
    const W = worldW(this);
    const g = this.add.graphics();
    const bar = (p: number): void => {
      g.clear();
      g.fillStyle(0x000000, 0.4).fillRoundedRect(W / 2 - 200, worldH / 2 + 40, 400, 14, 7);
      g.fillStyle(COLOR.gold, 1).fillRoundedRect(W / 2 - 200, worldH / 2 + 40, Math.max(14, 400 * p), 14, 7);
    };
    bar(0);
    const t0 = performance.now();
    void (async () => {
      try {
        // 标题字体和纹理烘焙并行；字体要在第一个场景建文字之前就绪
        const font = loadTitleFont();
        await bakeAll(this, (p) => bar(p * 0.85));
        await font;
        await ensureBackdrops(this, W, worldH);
        // 标题页按有没有平台摆按钮（实盘、云存档、"大厅"）：main.ts 启动时就问了，通常早就有结果
        await detectOnce();
        bar(1);
        document.getElementById('boot')?.remove();
        app.bootMs = Math.round(performance.now() - t0);
        app.ready = true;
        // 邀请链接、刷新时房间可能在载入过程中就接上了（app.net 已设好），载完直接进牌桌
        this.scene.start(app.net || app.session ? 'table' : app.ddz ? 'ddz' : 'title');
      } catch (err) {
        showErrorPanel(err);
      }
    })();
  }
}
