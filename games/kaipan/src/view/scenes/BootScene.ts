import Phaser from 'phaser';
import { APP_VERSION } from '../../platform/version.ts';
import { ensureAtlas, finishBoot, loadOptionalArt, prepareArt, queueBoot, stocksForThemes, warmLazy, type AtlasMode } from '../assets.ts';
import { loadNumFont } from '../numFont.ts';
import type { Session } from '../session.ts';
import { COLOR, PHONE, VIEW } from '../theme.ts';
import { addText } from '../ui/text.ts';
import { setupCamera } from './BaseScene.ts';

const BAR_W = 420;

/** URL 参数 atlas=0 / atlas=1：强制不用 / 用图集（对比清晰度、统计请求数用）。 */
function atlasMode(): AtlasMode {
  const v = new URLSearchParams(window.location.search).get('atlas');
  return v === '0' ? 'off' : v === '1' ? 'on' : 'auto';
}

/**
 * 启动加载：先读图集入口（有图集就从图集取帧），再加载图集页、其余固定素材、当前这局登场题材的股票合成图
 * （其余题材进交易场景时按需补加载），最后取可选素材（道具图标、眨眼、标题主视觉，缺了就算了）。
 * 显示进度与版本号，完成后交给 Session。
 */
export class BootScene extends Phaser.Scene {
  private readonly session: Session;
  private readonly toTitle: boolean;
  private fill!: Phaser.GameObjects.Rectangle;
  private label!: Phaser.GameObjects.Text;

  constructor(session: Session, toTitle: boolean) {
    super('boot');
    this.session = session;
    this.toTitle = toTitle;
  }

  create(): void {
    // 手机横屏直接按 960×444 布局（VIEW 在电脑上就是 1280×720）
    setupCamera(this, PHONE);
    const cx = VIEW.w / 2;
    const cy = VIEW.h / 2;
    this.add.rectangle(0, 0, VIEW.w, VIEW.h, COLOR.bg).setOrigin(0, 0);
    addText(this, cx, cy - 70, '开盘', { size: 44, bold: true, color: COLOR.accentDark, originX: 0.5, originY: 0.5 });
    this.label = addText(this, cx, cy + 30, '正在载入…', { size: 15, color: COLOR.muted, originX: 0.5 });
    this.add.rectangle(cx - BAR_W / 2, cy, BAR_W, 12, COLOR.paper).setOrigin(0, 0.5).setRounded(6).setStrokeStyle(2, COLOR.ink, 1);
    this.fill = this.add.rectangle(cx - BAR_W / 2 + 2, cy, 1, 8, COLOR.accent).setOrigin(0, 0.5).setRounded(4);
    addText(this, VIEW.w - 20, VIEW.h - 16, `版本 ${APP_VERSION}`, { size: 13, color: COLOR.muted, originX: 1, originY: 1 });
    document.getElementById('boot')?.remove();
    void this.run();
  }

  private progress(p: number): void {
    this.session.bootProgress = p;
    this.fill.setSize(Math.max(1, (BAR_W - 4) * p), 8);
    this.label.setText(`正在载入… ${Math.round(p * 100)}%`);
  }

  private async run(): Promise<void> {
    await Promise.all([prepareArt(atlasMode()), loadNumFont()]);
    const stocks = stocksForThemes(this.session.state.themeIds);
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => this.progress(p * 0.95));
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      // 缺素材时界面退回到纯色图形，不阻断启动
      console.warn('素材加载失败：', file.key, file.url);
    });
    const pass = (): Promise<void> =>
      new Promise<void>((resolve) => {
        this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
        queueBoot(this.load, this.textures, stocks);
        this.load.start();
      });
    await pass();
    // 图集没加载成功：改用单独的 SVG 再加载一遍
    if (!finishBoot(this.textures)) await pass();
    // 可选素材：道具图标、本局股票的眨眼图、标题主视觉
    await loadOptionalArt(this.textures, { items: true, stocks, keyart: true, friendly: true });
    this.progress(1);
    this.session.boot(this.game, this.toTitle);
    // 首屏可操作之后在后台预取：雷雨天图层、meta 图集（人设 / 难度 / 成就 / 图鉴界面用，用到时会再 ensureAtlas）
    if (this.toTitle) {
      warmLazy(this.textures);
      void ensureAtlas(this.textures, 'meta');
    }
  }
}
