/**
 * 入口：开始菜单 → 守夜一局 → 结算（再来一局 / 换难度 / 大厅）。第一次打开只有一个大按钮，第一局带最多 3 条引导。
 * 画布按 CSS 尺寸 × 渲染倍数开，再用 CSS 缩回去：手机上不糊，省内存设备倍数封顶 2（viewport.ts）。
 * 调试参数：?seed=123 固定种子，?diff=easy|normal|hard，?play 跳过菜单直接开局，?auto 让机器人代打、?warp=9000 先快进到第 9000 拍、&choose 停在选卡、?give=mirror:8,gourd:8 开局换法器（这几个只在开发服务器里有，冒烟截图用），?sheet 看图集。
 */
import Phaser from 'phaser';
import { DAWN_TICK, DIFFICULTIES, type Difficulty } from './content/waves.ts';
import { PASSIVE_IDS, PASSIVES, WEAPONS, type WeaponId } from './content/weapons.ts';
import { createWorld, grantWeapon, step, type World } from './core/index.ts';
import { loadSave, recordRun, settings, writeSave } from './platform/save.ts';
import { buildAtlas, buildGround, type Atlas } from './view/art/atlas.ts';
import { music } from './view/audio/music.ts';
import { sfx } from './view/audio/sfx.ts';
import { GameScene } from './view/game/GameScene.ts';
import { Input } from './view/game/input.ts';
import { Banners } from './view/ui/banner.ts';
import { Cards } from './view/ui/cards.ts';
import { Hud } from './view/ui/hud.ts';
import { type BuildRow, Confirm, Menu, Pause, Result, Tips, type Toggle } from './view/ui/screens.ts';
import { LOW_MEMORY, TOUCH, fitViewport, renderScale, worldZoom } from './view/viewport.ts';

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

  // 层次（下 → 上）：画布、暗角、摇杆层、HUD、横幅、卡片、结算、暂停、菜单、确认框
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

  const save = loadSave();
  const toggles: Toggle[] = [
    { key: 'sfx', label: '音效', get: () => sfx.enabled, set: (on) => sfx.setEnabled(on) },
    { key: 'music', label: '音乐', get: () => music.enabled, set: (on) => music.setEnabled(on) },
    { key: 'shake', label: '震屏', get: () => settings.shake, set: (on) => (settings.shake = on) },
  ];
  if (TOUCH) toggles.push({ key: 'stick', label: '固定摇杆', get: () => settings.fixedStick, set: (on) => { settings.fixedStick = on; input.setFixed(on); } });
  input.setFixed(TOUCH && settings.fixedStick);
  const menu = new Menu(stage, toggles);
  const pause = new Pause(stage, toggles, (k) => icon(k));
  const result = new Result(stage, (k) => icon(k));
  const confirm = new Confirm(stage);
  const tips = new Tips(stage);
  menu.onClick = () => sfx.play('click');

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
  let world: World | null = null;
  let autopilot: ((w: World) => { dir: number; choice: number }) | undefined;
  let ended = false;
  /** 对局界面（HUD、摇杆）只在打的时候显示 */
  const showPlay = (on: boolean): void => {
    hud.root.style.display = on ? '' : 'none';
    stickLayer.style.display = on ? '' : 'none';
    vignette.style.display = on ? '' : 'none';
  };
  showPlay(false);

  const tipDone = (id: string): boolean => save.tipsOff || save.tips.includes(id);
  const markTip = (id: string): void => {
    if (!save.tips.includes(id)) save.tips.push(id);
    writeSave(save);
  };
  tips.onOff = () => {
    save.tipsOff = true;
    writeSave(save);
  };

  const buildRows = (w: World): BuildRow[] => [
    ...w.weapons.map((o) => {
      const def = WEAPONS[o.id];
      const evo = o.evolved && def.evolve;
      return { icon: evo ? def.evolve!.icon : def.icon, name: evo ? def.evolve!.name : def.name, level: o.evolved ? 9 : o.level, dmg: o.dmg, kills: o.kills };
    }),
    ...PASSIVE_IDS.filter((id) => w.passives[id] !== undefined).map((id) => ({ icon: PASSIVES[id].icon, name: PASSIVES[id].name, level: w.passives[id]!, dmg: -1, kills: 0 })),
  ];

  const setPaused = (on: boolean): void => {
    scene?.setPaused(on);
    input.enabled = !on;
    // 暂停时整个声音停下（音乐也停），继续时接着放
    const ctx = sfx.ctx;
    if (ctx) void (on ? ctx.suspend() : ctx.resume()).catch(() => undefined);
  };
  const openPause = (): void => {
    if (!world || ended || pause.open || confirm.open) return;
    setPaused(true);
    tips.hide();
    pause.show(buildRows(world), Math.max(0, (DAWN_TICK - world.tick) / 30));
  };
  pause.onResume = () => {
    pause.hide();
    setPaused(false);
  };
  const askHome = (): void => {
    if (!pause.open) setPaused(true);
    confirm.ask('这一局不会保存，确定回大厅吗？', '回大厅', '接着打', (ok) => {
      if (ok) location.href = '/';
      else if (!pause.open) setPaused(false);
    });
  };
  pause.onHome = askHome;
  pause.onQuit = () =>
    confirm.ask('认输就算这一局结束，确定吗？', '认输', '接着打', (ok) => {
      if (ok && world) {
        pause.hide();
        finish(world, true);
      }
    });
  hud.pauseBtn.addEventListener('click', openPause);
  hud.homeBtn.addEventListener('click', askHome);
  // 切到后台自动暂停（手机来电、切应用）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !autopilot) openPause();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p') {
      if (confirm.open) confirm.close(false);
      else if (pause.open) pause.onResume();
      else openPause();
    } else if (banners.skipReveal()) e.preventDefault();
  });
  stage.addEventListener('pointerdown', () => banners.skipReveal());

  const finish = (w: World, quit: boolean): void => {
    if (ended) return;
    ended = true;
    setPaused(true);
    music.stop();
    tips.hide();
    banners.clear();
    const seconds = Math.min(w.tick, DAWN_TICK) / 30;
    // 认输的局算一局，但不算纪录
    const record = recordRun(save, w.setup.difficulty, { ticks: w.won ? DAWN_TICK : w.tick, kills: w.kills, won: w.won }, !quit);
    showPlay(false);
    result.show({ won: w.won, quit, bossKilled: w.bossKilled, seconds, kills: w.kills, level: w.level, coins: w.coins, difficulty: w.setup.difficulty, record, build: buildRows(w) });
  };

  const startRun = async (difficulty: Difficulty): Promise<void> => {
    save.difficulty = difficulty;
    writeSave(save);
    menu.hide();
    result.hide();
    ended = false;
    if (scene) game.scene.remove('game');
    banners.clear();
    input.reset();
    const seed = q.has('seed') ? Number(q.get('seed')) >>> 0 : (Math.random() * 0x100000000) >>> 0;
    const w = createWorld({ seed, mode: 'vigil', difficulty });
    world = w;
    autopilot = undefined;
    if (import.meta.env.DEV && q.has('give')) {
      // ?give=mirror:8,gourd:8：开局换成这几件法器（看新法器的画面用）
      w.weapons.length = 0;
      w.wstats.length = 0;
      for (const part of q.get('give')!.split(',')) {
        const [id, lv] = part.split(':');
        if (id && id in WEAPONS) grantWeapon(w, id as WeaponId, Number(lv ?? 1));
      }
    }
    if (import.meta.env.DEV && (q.has('auto') || q.has('warp'))) {
      const { Bot } = await import('../tools/bots.ts');
      const bot = new Bot('normal', 'sword', seed);
      if (q.has('auto')) autopilot = (x) => bot.act(x);
      // ?warp=拍数：开局前让机器人在后台先打到这一拍（截中后期的画面）；不带 auto 就从那里交给玩家，
      // 再加 &choose 停在之后第一次升级的选卡上（截卡片）
      const warp = Number(q.get('warp') ?? 0);
      const stopAtCards = q.has('choose');
      while (w.phase !== 'over') {
        if (w.tick >= warp && (!stopAtCards || w.phase === 'choose')) break;
        const a = bot.act(w);
        step(w, a.dir, w.phase === 'choose' ? a.choice : -1);
      }
    }
    const firstRun = save.runs === 0;
    showPlay(true);
    setPaused(false);
    game.scene.add('game', GameScene, true, {
      world: w,
      atlas,
      hud,
      cards,
      banners,
      input,
      zoom: worldZoom(css().w, css().h) * r,
      icon: (k: string) => icon(k, 128),
      firstRun: firstRun && !tipDone('cards'),
      autopilot,
      shake: () => settings.shake,
      onChest: () => {
        // 引导第 3 条：第一次开宝箱讲进化
        if (tipDone('chest')) return;
        markTip('chest');
        tips.show('法器<b>满级</b> + 对应的<b>被动</b>，宝箱里会开出<b>进化</b>', 6000);
      },
      onEnd: (x: World) => finish(x, false),
    });
    scene = game.scene.getScene('game') as unknown as GameScene;
    // 引导第 1 条：开局"拖动走位"，一动就收起（0–10 秒）
    if (!tipDone('moved') && !autopilot) {
      input.moved = false;
      tips.show(TOUCH ? '<b>按住屏幕拖动</b>走位，法器会自己出手' : '<b>WASD</b> 或<b>方向键</b>走位，法器会自己出手', 10000);
      const watch = window.setInterval(() => {
        if (input.moved || ended) {
          window.clearInterval(watch);
          tips.hide();
          if (input.moved) markTip('moved');
        }
      }, 200);
    }
    (window as unknown as { __yx: unknown }).__yx = { game, world: w, lowmem: LOW_MEMORY, res, zoom, r, music, save };
  };
  cards.onShow = (first) => {
    // 引导第 2 条记在卡片自己的说明里，第一次升级以后就不再带
    if (first) markTip('cards');
  };

  menu.onStart = (d) => void startRun(d);
  result.onAgain = () => void startRun(world?.setup.difficulty ?? save.difficulty);
  result.onMenu = () => {
    result.hide();
    menu.show({ firstTime: false, difficulty: save.difficulty, best: save.best });
  };

  game.events.once(Phaser.Core.Events.READY, () => {
    game.textures.addCanvas('ground', ground);
    document.getElementById('boot')?.remove();
    (window as unknown as { __yx: unknown }).__yx = { game, world: null, lowmem: LOW_MEMORY, res, zoom, r, music, save };
    // 调试参数直接开局（冒烟截图、机器人代打）；?diff 指定难度
    const diffQ = q.get('diff');
    const qd = diffQ && diffQ in DIFFICULTIES ? (diffQ as Difficulty) : null;
    if (q.has('auto') || q.has('warp') || q.has('play') || q.has('give')) void startRun(qd ?? 'normal');
    else menu.show({ firstTime: save.runs === 0, difficulty: qd ?? save.difficulty, best: save.best });
  });
  fitViewport(() => {
    const s = css();
    game.scale.resize(s.w * r, s.h * r);
    game.scale.setZoom(1 / r);
    scene?.cameras.main.setZoom(worldZoom(s.w, s.h) * r);
  });
}

void boot();
