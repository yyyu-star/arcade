import { installErrorHandler } from './platform/errors.ts';
import { createRun, type GameEvent, type GameState } from './core/index.ts';
import { mountBridge } from './debug/bridge.ts';
import { mountOverlay } from './debug/overlay.ts';
import { parseParams } from './debug/params.ts';
import { detectPlatform, onPlatformMode } from './platform/mode.ts';
import { mountRotateHint, setRotateLobbyLabel } from './platform/orientation.ts';
import { fitViewport } from './platform/viewportFit.ts';
import { getSettings, onSettingsChange } from './platform/settings.ts';
import { loadProfile } from './platform/profile.ts';
import { startCloudSync } from './view/cloudSync.ts';
import { goLobby, lobbyLabel } from './view/lobby.ts';
import { live, lobbyConfirm, startLive } from './view/live.ts';
import { clearLegacyKeys, hasSave, loadSave, type SaveNotice } from './platform/storage.ts';
import { startGame } from './view/game.ts';
import { initInputMode, onInputModeChange } from './view/input.ts';
import { installFocus } from './view/ui/focus.ts';
import { applySettingsToOptions, type ViewOptions } from './view/options.ts';
import { Session, randomSeed } from './view/session.ts';
import { sound } from './view/sound.ts';
import { LOW_MEMORY, applyColorScheme } from './view/theme.ts';

// 最先安装全局错误兜底，之后的任何异常都不会留下白屏
installErrorHandler();
// 手机竖屏时提示横过来（提示层左上角也有「大厅」，一局进行中先问一次）；触屏设备不显示键盘提示
mountRotateHint({ inRun: () => session.sceneKey === 'trade', confirm: () => lobbyConfirm(session.state), go: () => goLobby() });
initInputMode();
installFocus();

// 旧版本留在本机的备份 key 一次性清掉（只清 LEGACY_KEYS，当前的存档、档案、设置不碰）
clearLegacyKeys();

const params = parseParams(window.location.search);
/** URL 指定了开局（调试/自动化）时跳过开始菜单，直接进入对应局面 */
const fromUrl = params.seed !== null || params.setup !== null;

/** 启动读档的提示（旧版本存档 / 存档损坏），交给开始菜单显示 */
let notice: SaveNotice = null;

/** 决定开局状态：URL 指定种子/设置 > 存档 > 随机新局（未存档，等玩家在菜单里选择）。 */
function initialRun(): { state: GameState; events: GameEvent[] } {
  if (fromUrl) {
    const seed = params.seed ?? randomSeed();
    try {
      return createRun(seed, params.setup, { ext: params.ext });
    } catch (err) {
      console.warn('URL 开局设置无效，已忽略：', err);
      return createRun(seed, null, { ext: params.ext });
    }
  }
  const saved = loadSave();
  notice = saved.notice;
  if (saved.state) return { state: saved.state, events: [] };
  return createRun(randomSeed(), null, { ext: true });
}

// 玩家设置 → 画面选项与配色；URL 的 anim/speed 优先
const settings = getSettings();
const view: ViewOptions = { anim: true, speed: 1, debug: params.debug, reduceMotion: false };
applySettingsToOptions(view, settings, params.anim);
applyColorScheme(settings.colorScheme);
onSettingsChange((s) => {
  applySettingsToOptions(view, s, params.anim);
  applyColorScheme(s.colorScheme);
});
sound.init();

const run = initialRun();
const session = new Session(run.state, run.events, view);
session.animLocked = params.anim.anim !== null || params.anim.speed !== null;
// 行情来源（调试）：?market=synthetic 用 0.3 的合成行情；?market=<段 id> 指定一段真实行情
session.market = new URLSearchParams(window.location.search).get('market') ?? 'real';
session.notice = notice;
// 调试与计分：?debug=1 的浮层会显示隐藏信息，这个会话里的局都不计入档案；URL 开局参数开的局也不计
session.debugSession = params.debug;
if (fromUrl) {
  session.markUnscored();
  // 正式构建：已有存档时，URL 开的这一局不写存档，免得把玩家进行中的局覆盖掉
  // 实盘没结完时开发构建也不写：盖掉的话，下次正常打开会把那局实盘当成没开成、原样退回
  if ((!import.meta.env.DEV && hasSave()) || live.record?.step === 'playing' || live.record?.step === 'settling') {
    session.persist = false;
    console.info('URL 开局参数：已有存档，这一局不写存档、不计入档案');
  }
}
// 实盘（0.6.0）：接上这局的账、重发没发成的结回。调试会话和 URL 开局都不碰（读到的不是玩家自己的存档）
if (!fromUrl && !params.debug) startLive(session.state);
// 档案读坏了会就地备份重建，开始菜单提示一次
session.profileNotice = loadProfile().notice === 'corrupt';
const game = startGame(session, 'app', { toTitle: !fromUrl });
// 手机平板上画布按看得见的区域铺（iOS Safari 的地址栏、标签栏不压画面），尺寸一变让 Phaser 重新量；别的走 CSS 的 100dvh
if (LOW_MEMORY) {
  fitViewport(() => {
    if (game.isBooted) game.scale.refresh();
  });
}
// 首次触摸后才确认是触屏：重建当前场景，去掉快捷键提示
onInputModeChange(() => session.redraw());
// 0.8.0 有没有平台（单独部署时没有，见 platform/mode.ts）：问出来"没有"时开始菜单重画（藏起实盘、云朵、大厅），
// 竖屏提示的按钮改叫「首页」。开发构建不问：vite 的开发服务器对任何路径都回 index.html，问了总是"没有"；
// 冒烟要平台时自己假一个 /api/me，要看单独部署的样子用 wrangler dev 跑构建产物
onPlatformMode(() => {
  setRotateLobbyLabel(lobbyLabel());
  if (session.sceneKey === 'title') session.redraw();
});
const platformKnown = import.meta.env.DEV ? Promise.resolve('unknown' as const) : detectPlatform();
// 云存档：调试会话（?debug=1，看得到隐藏信息、不计档案）不同步；单独部署没有平台，也不同步。
// 云端的进度写进本地后，开始菜单按新档案重画；别的画面不打断，下次回到开始菜单自然读到新档案
void platformKnown.then((m) => {
  if (!params.debug && m !== 'standalone') startCloudSync(() => session.sceneKey === 'title' && session.redraw());
});
if (import.meta.env.DEV || params.debug) mountBridge(session);
if (params.debug) mountOverlay(session);
