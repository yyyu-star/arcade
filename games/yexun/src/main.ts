/**
 * 入口。第 2b 步：直接开一局守夜（菜单、结算、新手引导在 2c）。
 * 画布按 CSS 尺寸 × 渲染倍数开，再用 CSS 缩回去：手机上不糊，省内存设备倍数封顶 2（viewport.ts）。
 * 调试参数：?seed=123 固定种子，?diff=easy|normal|hard，?auto 让机器人代打、?auto&warp=9000 先快进到第 9000 拍（只在开发服务器里有，冒烟截图用），?sheet 看图集。
 */
import Phaser from 'phaser';
import { DIFFICULTIES } from './content/waves.ts';
import { createWorld, step, type World } from './core/index.ts';
import { buildAtlas, buildGround, type Atlas } from './view/art/atlas.ts';
import { music } from './view/audio/music.ts';
import { sfx } from './view/audio/sfx.ts';
import { GameScene } from './view/game/GameScene.ts';
import { Input } from './view/game/input.ts';
import { Banners } from './view/ui/banner.ts';
import { Cards } from './view/ui/cards.ts';
import { Hud } from './view/ui/hud.ts';
import { LOW_MEMORY, fitViewport, renderScale, worldZoom } from './view/viewport.ts';

const q = new URLSearchParams(location.search);

/** 图集里一帧画成 data URL（HUD 的头像、法器图标用）；同一张只画一次 */
function iconMaker(atlas: Atlas): (key: string, px?: number) => string {
  const cache = new Map<string, string>();
  return (key, px = 64) => {
    const id = `${key}@${px}`;
    let url = cache.get(id);
    if (url) return url;
    const f = atlas.frames.get(key) ?? atlas.frames.get('soul')!;
    const c = document.createElement('canvas');
    c.width = px;
    c.height = Math.round((px * f.h) / f.w);
    c.getContext('2d')!.drawImage(atlas.canvas, f.x, f.y, f.w, f.h, 0, 0, c.width, c.height);
    url = c.toDataURL();
    cache.set(id, url);
    return url;
  };
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
  const icon = iconMaker(atlas);

  // 层次（下 → 上）：画布、暗角、摇杆层、HUD、横幅、卡片
  const vignette = document.createElement('div');
  vignette.className = 'yx-vignette';
  stage.appendChild(vignette);
  const stickLayer = document.createElement('div');
  stickLayer.className = 'yx-touch';
  stage.appendChild(stickLayer);
  const input = new Input(stickLayer);
  const hud = new Hud(stage, (k) => icon(k), icon('face', 120));
  const banners = new Banners(stage);
  const cards = new Cards(stage, (k) => icon(k));

  // 声音要在用户手势里解锁（iOS）
  const unlock = (): void => sfx.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  const seed = q.has('seed') ? Number(q.get('seed')) >>> 0 : (Math.random() * 0x100000000) >>> 0;
  const diffQ = q.get('diff');
  const difficulty = diffQ && diffQ in DIFFICULTIES ? (diffQ as keyof typeof DIFFICULTIES) : 'normal';
  const world = createWorld({ seed, mode: 'vigil', difficulty });
  let autopilot: ((w: World) => { dir: number; choice: number }) | undefined;
  if (import.meta.env.DEV && (q.has('auto') || q.has('warp'))) {
    const { Bot } = await import('../tools/bots.ts');
    const bot = new Bot('normal', 'sword', seed);
    if (q.has('auto')) autopilot = (w) => bot.act(w);
    // ?warp=拍数：开局前让机器人在后台先打到这一拍（截中后期的画面）；不带 auto 就从那里交给玩家，
    // 再加 &choose 停在之后第一次升级的选卡上（截卡片）
    const warp = Number(q.get('warp') ?? 0);
    const stopAtCards = q.has('choose');
    while (world.phase !== 'over') {
      if (world.tick >= warp && (!stopAtCards || world.phase === 'choose')) break;
      const a = bot.act(world);
      step(world, a.dir, world.phase === 'choose' ? a.choice : -1);
    }
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
    fps: { smoothStep: false },
  });

  let scene: GameScene | null = null;
  const pause = makePause(stage, (on) => {
    scene?.setPaused(on);
    input.enabled = !on;
  });
  hud.pauseBtn.addEventListener('click', () => pause.show(false));
  hud.homeBtn.addEventListener('click', () => pause.show(true));
  // 切到后台自动暂停（手机来电、切应用）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && scene && world.phase !== 'over' && !autopilot) pause.show(false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p') pause.toggle();
    else if (banners.skipReveal()) e.preventDefault();
  });
  stage.addEventListener('pointerdown', () => banners.skipReveal());

  game.events.once(Phaser.Core.Events.READY, () => {
    game.textures.addCanvas('ground', ground);
    game.scene.add('game', GameScene, true, {
      world,
      atlas,
      hud,
      cards,
      banners,
      input,
      zoom: zoom * r,
      icon: (k: string) => icon(k, 128),
      firstRun: true,
      autopilot,
      onEnd: (w: World) => {
        // 结算界面在 2c；先给一行字，点一下再来一局
        banners.say(w.won ? '天亮了' : '倒下了', w.won ? 'gold' : 'warn', 1e9, `撑了 ${Math.floor(w.tick / 1800)} 分 · 斩 ${w.kills} · 点一下再来一局`);
        window.addEventListener('pointerdown', () => location.reload(), { once: true });
      },
    });
    scene = game.scene.getScene('game') as unknown as GameScene;
    document.getElementById('boot')?.remove();
    (window as unknown as { __yx: unknown }).__yx = { game, world, lowmem: LOW_MEMORY, res, zoom, r, music };
  });
  fitViewport(() => {
    const s = css();
    game.scale.resize(s.w * r, s.h * r);
    game.scale.setZoom(1 / r);
    scene?.cameras.main.setZoom(worldZoom(s.w, s.h) * r);
  });
}

/** 暂停层：继续 / 回大厅（对局中离开先确认一次）；完整的暂停界面（声音开关、本局构筑）在 2c */
function makePause(parent: HTMLElement, onChange: (on: boolean) => void): { show: (home: boolean) => void; toggle: () => void } {
  const root = document.createElement('div');
  root.className = 'yx-pause-layer';
  root.style.display = 'none';
  root.innerHTML =
    '<div class="yx-pause-box"><b class="yx-pause-title">暂停</b>' +
    '<button type="button" class="yx-big" data-a="go">继续</button>' +
    '<button type="button" class="yx-big ghost" data-a="home">回大厅</button>' +
    '<span class="yx-pause-note"></span></div>';
  parent.appendChild(root);
  const note = root.querySelector<HTMLSpanElement>('.yx-pause-note')!;
  let open = false;
  const set = (on: boolean): void => {
    open = on;
    root.style.display = on ? '' : 'none';
    onChange(on);
  };
  root.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a === 'go') set(false);
    else if (a === 'home') location.href = '/';
  });
  return {
    show: (home) => {
      note.textContent = home ? '这一局不会保存，确定回大厅吗？' : '';
      set(true);
    },
    toggle: () => set(!open),
  };
}

void boot();
