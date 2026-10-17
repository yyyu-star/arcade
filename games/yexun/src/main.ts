/**
 * 入口。第 1 步只有画风样图（StyleScene），第 2 步起换成开始菜单和真正的对局。
 * 画布按 CSS 尺寸 × 渲染倍数开，再用 CSS 缩回去：手机上不糊，省内存设备倍数封顶 2（viewport.ts）。
 */
import Phaser from 'phaser';
import { buildAtlas, buildGround, type Atlas } from './view/art/atlas.ts';
import { StyleScene } from './view/scenes/StyleScene.ts';
import { Hud } from './view/ui/hud.ts';
import { LOW_MEMORY, TOUCH, fitViewport, renderScale, worldZoom } from './view/viewport.ts';

const q = new URLSearchParams(location.search);

/** 图集里一帧画成 data URL（HUD 的头像、法器图标用） */
function frameUrl(atlas: Atlas, key: string, px: number): string {
  const f = atlas.frames.get(key)!;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round((px * f.h) / f.w);
  c.getContext('2d')!.drawImage(atlas.canvas, f.x, f.y, f.w, f.h, 0, 0, c.width, c.height);
  return c.toDataURL();
}

async function boot(): Promise<void> {
  const stage = document.getElementById('stage')!;
  const app = document.getElementById('app')!;
  const r = renderScale();
  const css = (): { w: number; h: number } => ({ w: app.clientWidth || window.innerWidth, h: app.clientHeight || window.innerHeight });
  const size = css();
  const zoom = worldZoom(size.w, size.h);
  // 图集的清晰度跟着屏幕：每世界单位的像素数 = 世界缩放 × 渲染倍数，取整到 2 或 3
  const res = Math.max(2, Math.min(3, Math.ceil(zoom * r)));
  // 毛笔字体先载好再出横幅（font-display: block 也挡不住第一帧用后备字体量尺寸）
  await document.fonts?.load('40px YxBrush').catch(() => undefined);
  const atlas = buildAtlas(res);
  const ground = buildGround(512);
  if (q.has('sheet')) {
    atlas.canvas.style.cssText = 'position:absolute;left:0;top:0;background:#9aa3b5';
    document.body.style.overflow = 'auto';
    document.body.appendChild(atlas.canvas);
    return;
  }
  const icons: Record<string, string> = {};
  for (const k of ['i_sword', 'i_talisman', 'i_coins', 'i_fly', 'i_thunder', 'i_bell']) icons[k] = frameUrl(atlas, k, 64);
  const vignette = document.createElement('div');
  vignette.className = 'yx-vignette';
  const hud = new Hud(stage, icons, frameUrl(atlas, 'face', 120), [
    { icon: 'i_sword', level: 8, cd: 1 },
    { icon: 'i_talisman', level: 6, cd: 1 },
    { icon: 'i_thunder', level: 4, cd: 1 },
    { icon: 'i_coins', level: 3, cd: 1 },
    { icon: 'i_bell', level: 2, cd: 1 },
  ]);
  stage.insertBefore(vignette, hud.root);
  // 手机截图里摆一个按着的摇杆（真正的摇杆第 2 步做）
  if (TOUCH || q.has('stick')) {
    const s = document.createElement('div');
    s.className = 'yx-stick';
    s.style.left = '16%';
    s.style.top = '70%';
    s.innerHTML = '<b style="transform:translate(22px,-14px)"></b>';
    hud.root.appendChild(s);
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: app,
    width: size.w * r,
    height: size.h * r,
    backgroundColor: '#e4e8f0',
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / r },
    render: { antialias: true, pixelArt: false, powerPreference: 'high-performance' },
    banner: false,
    audio: { noAudio: true },
  });
  game.events.once(Phaser.Core.Events.READY, () => {
    game.textures.addCanvas('ground', ground);
    game.scene.add('style', StyleScene, true, { atlas, hud, zoom: zoom * r });
    document.getElementById('boot')?.remove();
    (window as unknown as { __yx: unknown }).__yx = { game, lowmem: LOW_MEMORY, res, zoom, r };
  });
  fitViewport(() => {
    const s = css();
    game.scale.resize(s.w * r, s.h * r);
    game.scale.setZoom(1 / r);
    const sc = game.scene.getScene('style');
    sc?.cameras.main.setZoom(worldZoom(s.w, s.h) * r);
  });
}

void boot();
