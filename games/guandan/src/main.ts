/**
 * 入口：错误兜底 → 竖屏提示 → 读设置和 URL 参数 → 准备会话 → 起 Phaser。
 */
import Phaser from 'phaser';
import { mountBridge } from './debug/bridge.ts';
import { jumpToAce, jumpToTribute } from './debug/jump.ts';
import { parseParams } from './debug/params.ts';
import { createGame } from './core/index.ts';
import { anim } from './view/anim.ts';
import { app } from './view/app.ts';
import { audio } from './view/audio.ts';
import { CloudSync } from './view/cloud.ts';
import { LOW_MEMORY, appBox, fitAppToViewport, isIOS, markForeground, markRenderLost, webglUsable } from './view/device.ts';
import { hideErrorPanel, installErrorHandler, showErrorPanel } from './view/errors.ts';
import { installIdleLimiter } from './view/idle.ts';
import { goLobby, inOnlineGame, leaveText, savedGameInProgress } from './view/lobby.ts';
import { autoJoin, forgetRoom, lobbySession, openOnline } from './view/online.ts';
import { mountRotateHint, setRotateLobbyLabel } from './view/orientation.ts';
import { detectOnce, lobbyName, standalone } from './view/platform.ts';
import { mountSocialOnce } from './view/social.ts';
import { BootScene } from './view/scenes/BootScene.ts';
import { TableScene } from './view/scenes/TableScene.ts';
import { TitleScene } from './view/scenes/TitleScene.ts';
import { Session, randomSeed } from './view/session.ts';
import { EMPTY_STATS, KEYS, backupKey, SYNC_SLOTS, getSettings, getStats, loadSave, onSyncedChange, rawStore, tutorialDone, type SyncSlot } from './view/store.ts';
import { GAME_HEIGHT, RENDER_SCALE, worldWidthFor } from './view/theme.ts';
import { dropBackdrops, ensureBackdrops } from './view/textures.ts';
import { worldW } from './view/ui/kit.ts';
import { applyAudio } from './view/ui/panels.ts';

installErrorHandler();
// 有没有平台（单独部署时没有）：开场景、进房、云存档都等它（kit 默认最多等 2.5 秒）
const platform = detectOnce();
// 竖屏提示层里的"大厅"：牌桌被盖住，有打到一半的存档（或好友房正在打）时用浏览器自带的确认框
mountRotateHint(() => {
  if ((app.net ? inOnlineGame() : savedGameInProgress()) && !window.confirm(leaveText())) return;
  goLobby();
});

const params = parseParams(window.location.search);
app.params = params;
if (params.anim === false) anim.instant = true;
if (params.speed) anim.forcedSpeed = params.speed;

// URL 指定了开局（调试 / 自动化）：直接进牌桌。已有存档时这一局不写存档，免得覆盖玩家进度。
if (params.seed !== null || params.jump !== null) {
  const seed = params.seed ?? randomSeed();
  const rules = getSettings().rules;
  const start = params.jump === 'tribute' ? jumpToTribute(seed, rules) : params.jump === 'ace' ? jumpToAce(seed, rules) : createGame(seed, rules);
  const ses = new Session(start.state, start.events, params.difficulty ?? getSettings().difficulty);
  ses.scored = false;
  ses.persist = !loadSave();
  ses.autoplay = params.autoplay;
  ses.save();
  app.session = ses;
}

// 云存档：战绩和教程标记（登录了才发请求）
const cloud = new CloudSync({
  fetch: (url, init) => window.fetch(url, init),
  hasLoginHint: () => /(?:^|;\s*)__Host-arcade_li=/.test(document.cookie),
  read: (slot: SyncSlot) => (slot === 'stats' ? getStats() : { v: 1, done: tutorialDone() }),
  write: (slot, data) => rawStore.write(SYNC_SLOTS[slot], data),
  // 写完读回核对：存储满了 setItem 会失败（rawStore 吞掉了异常），换号时靠这个判断能不能清空本地
  backup: (slot, tag, data) => {
    rawStore.write(backupKey(slot, tag), data);
    return JSON.stringify(rawStore.read(backupKey(slot, tag))) === JSON.stringify(data);
  },
  readBackup: (slot, tag) => rawStore.read(backupKey(slot, tag)),
  dropBackup: (slot, tag) => rawStore.remove(backupKey(slot, tag)),
  empty: (slot) => (slot === 'stats' ? { ...EMPTY_STATS } : { v: 1, done: false }),
  loadMeta: () => rawStore.read(KEYS.cloud),
  saveMeta: (m) => rawStore.write(KEYS.cloud, m),
  forgetRoom,
});
app.cloud = cloud;
onSyncedChange((slot) => cloud.markDirty(slot));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') cloud.flushOnHide();
  else void cloud.resume();
});
// 两个窗口并排时切回来不一定有 visibilitychange：拿到焦点也确认一次身份（resume 自己限 1 分钟一次）
window.addEventListener('focus', () => void cloud.resume());
// 同时开了几个标签页：别的页传完或换了账号，这边跟着更新元数据
window.addEventListener('storage', (e) => {
  if (e.key === KEYS.cloud) cloud.onExternalMeta();
});
// 有的浏览器关页、刷新时不发 visibilitychange；两边都触发也只会传一次（同一个槽在途时不重发）
window.addEventListener('pagehide', () => cloud.flushOnHide());
// 单独部署没有账号，云存档不启动（没有登录提示 cookie 时它本来也一个请求都不发，这里说清楚）
void platform.then(() => {
  if (standalone()) setRotateLobbyLabel(lobbyName());
  else {
    void cloud.start();
    // 报位置、收好友邀请（0.13.0）：没登录 mountSocialOnce 自己不挂
    void mountSocialOnce(() => app.net ?? lobbySession());
  }
});

applyAudio();
const unlock = (): void => audio.unlock();
window.addEventListener('pointerdown', unlock, true);
window.addEventListener('keydown', unlock, true);
document.addEventListener('visibilitychange', () => audio.setPaused(document.hidden));

// iOS 防崩溃标记：前台时记着，切后台或正常离开就清（device.ts）
document.addEventListener('visibilitychange', () => markForeground(document.visibilityState === 'visible'));
window.addEventListener('pagehide', () => markForeground(false));
window.addEventListener('pageshow', () => markForeground(true));

// 画面容器钉在实际可见区域（扣掉安全区），世界宽度也按它算
const host = document.getElementById('app')!;
fitAppToViewport(host);
const box0 = appBox();
app.width = worldWidthFor(box0.w, box0.h);
/** 现在的世界宽度是按横屏还是竖屏排的（触屏设备只在转屏时重排） */
let laidLandscape = box0.w >= box0.h;

const config: Phaser.Types.Core.GameConfig = {
  type: webglUsable() ? Phaser.WEBGL : Phaser.CANVAS,
  parent: host,
  width: app.width * RENDER_SCALE,
  height: GAME_HEIGHT * RENDER_SCALE,
  backgroundColor: '#123a2b',
  banner: false,
  fps: { panicMax: 12 },
  // 自动化浏览器（冒烟、截图，无头 Chrome 用 SwiftShader 软件渲染）只用一个纹理单元：SwiftShader 下多纹理合批会让
  // 一些精灵整块取错纹理、显示成透明的方块（主页的人物复现过，GL 只上传过一次，画布本身是完整的）。真机不受影响，照常合批
  // 多重采样的缓冲按画布像素 ×4 份算；iOS 2 倍渲染时边缘锯齿本来就看不出，省下这块内存
  render: { maxTextures: navigator.webdriver ? 1 : -1, antialiasGL: LOW_MEMORY === 0 && !(isIOS() && RENDER_SCALE >= 2) },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, TitleScene, TableScene],
};
let game: Phaser.Game;
try {
  game = new Phaser.Game(config);
} catch (err) {
  // 预检拿到了 WebGL，Phaser 自己建上下文却失败：清掉半截画布，换 Canvas 渲染再来一次
  console.warn('WebGL 启动失败，改用 Canvas 渲染', err);
  host.replaceChildren();
  game = new Phaser.Game({ ...config, type: Phaser.CANVAS });
}
app.game = game;
installIdleLimiter(game);

// WebGL 上下文被系统收回（iOS 内存紧张时会这样）：Phaser 会等它恢复。2 秒还没恢复先提示重新载入；
// 恢复了就收起提示、不降档。只有一直没恢复（20 秒，或者没恢复就重新载入）才记一次降档，下次打开换省内存的画法；
// 短暂丢失又恢复的不算，免得来回几次就一路降到 Canvas。
const contextLost = (): boolean => !!(game.renderer as { contextLost?: boolean }).contextLost;
let lossTimers: number[] = [];
let lossPanel = false;
let lossMarked = false;
const markLossOnce = (): void => {
  if (lossMarked) return;
  lossMarked = true;
  markRenderLost();
};
game.canvas.addEventListener('webglcontextlost', () => {
  lossTimers.forEach((t) => window.clearTimeout(t));
  lossTimers = [
    window.setTimeout(() => {
      if (!contextLost()) return;
      lossPanel = true;
      showErrorPanel(new Error('画面被系统收回了（多半是内存不够），点"重新载入"，会换一种更省内存的画法'));
    }, 2000),
    window.setTimeout(() => {
      if (contextLost()) markLossOnce();
    }, 20_000),
  ];
});
game.canvas.addEventListener('webglcontextrestored', () => {
  lossTimers.forEach((t) => window.clearTimeout(t));
  lossTimers = [];
  if (lossPanel) hideErrorPanel();
  lossPanel = false;
});
window.addEventListener('pagehide', () => {
  if (contextLost()) markLossOnce();
});

// 可见区域变了（转屏、Safari 地址栏收放、调整窗口）：先把容器贴回可见区域，真变了才让 Phaser 重新缩放（FIT 留边）；
// 需要时再换世界宽度、重建当前画面（画面全部由状态重建，不丢进度），换完删掉旧宽度的背景大图。
// 重建会丢掉选着的牌、动画、弹层，所以：触屏设备只在转屏时重建（地址栏一收一放只是比例小变，留边就够）；
// 电脑上窗口宽度差 40 以上才重建；牌桌在播动画、有弹层或选着牌时推迟到空闲再做。
let resizeTimer = 0;
const relayout = (): void => {
  if (!fitAppToViewport(host)) return;
  app.fits++;
  game.scale.refresh();
};
const onViewport = (): void => {
  relayout();
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(settle, 250);
};
const coarse = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
const settle = (): void => {
  relayout();
  const b = appBox();
  const w = worldWidthFor(b.w, b.h);
  const landscape = b.w >= b.h;
  // 宽度刚好没变也记下转到了哪个方向，不然竖过去再横回来会被当成没转屏
  if (w === app.width) {
    laidLandscape = landscape;
    return;
  }
  if (coarse() ? landscape === laidLandscape : Math.abs(w - app.width) < 40) return;
  // 还在加载（iOS 工具栏常在这时收放）或者牌桌正忙：等进了标题页或牌桌、空下来再换，不然宽度一直停在旧值
  const active = game.scene.getScenes(true)[0] as (Phaser.Scene & { canRebuild?: () => boolean }) | undefined;
  if (!app.ready || !active || active.scene.key === 'boot' || active.canRebuild?.() === false) {
    resizeTimer = window.setTimeout(settle, 500);
    return;
  }
  app.width = w;
  laidLandscape = landscape;
  game.scale.setGameSize(w * RENDER_SCALE, GAME_HEIGHT * RENDER_SCALE);
  void ensureBackdrops(active, w, GAME_HEIGHT).then(() => {
    active.events.once(Phaser.Scenes.Events.CREATE, () => dropBackdrops(active, worldW(active)));
    active.scene.restart();
  });
};
window.addEventListener('resize', onViewport);
window.addEventListener('orientationchange', onViewport);
window.visualViewport?.addEventListener('resize', onViewport);
window.visualViewport?.addEventListener('scroll', onViewport);

if (import.meta.env.DEV || params.debug) mountBridge(game);

// 邀请链接 ?online=1&room=xxxxxx（或只带 room=）：启动后直接进房间；只带 ?online=1（平台大厅的好友房入口）：直接打开好友房面板。
// 大厅画在 DOM 层，不等 Phaser
void platform.then(() => {
  if (params.room) void autoJoin(params.room);
  else if (params.online) openOnline();
});
