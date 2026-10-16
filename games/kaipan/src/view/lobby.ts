/**
 * 0.5.8 回大厅：平台首页 `/` 是平台的公开地址（游戏挂在 /games/kaipan/ 下，大厅永远在域名根）。
 * 走之前补传一次云存档；一局里的进度本来每一步都存在本机，离开不算放弃，回来点「继续」接着玩。
 * 0.8.0 单独部署（没有平台，见 platform/mode.ts）时没有大厅：按钮叫「首页」，回游戏自己的首页 `./`（开始菜单）。
 */
import { standalone } from '../platform/mode.ts';
import { flushBeforeLeave } from './cloudSync.ts';
import { boardBeforeLeave } from './dailyBoard.ts';
import { showBanner } from './segments.ts';

const LOBBY_URL = '/';
/** 单独部署时的"大厅"：游戏首页（页面在 /games/kaipan/ 下，./ 就是它自己） */
const HOME_URL = './';

/** 「大厅」按钮去哪儿 */
export function lobbyUrl(): string {
  return standalone() ? HOME_URL : LOBBY_URL;
}

/** 「大厅」按钮上的字 */
export function lobbyLabel(): string {
  return standalone() ? '首页' : '大厅';
}
/** 平台的钱包页（领补给）：0.6.5 钱包不够时给的去处（平台 15.10） */
export const WALLET_URL = '/wallet';

/** 回大厅时离开这一局的确认说明（游戏内和竖屏提示层共用） */
export const LOBBY_CONFIRM = { title: '回大厅？', body: '这一局会自动存在这台设备上，不算放弃。\n回来后点开始菜单的「继续」接着玩。', ok: '回大厅' } as const;
/** 单独部署时的说法 */
export const HOME_CONFIRM = { title: '回首页？', body: '这一局会自动存在这台设备上，不算放弃。\n回来后点开始菜单的「继续」接着玩。', ok: '回首页' } as const;

let closeLeaving: (() => void) | null = null;

/**
 * 结束页马上点「大厅」时交分可能还在问账号：先等它发出去（最多 1.5 秒），再补传云存档（扣掉交分占的 keepalive 额度）。
 * 连点两下不用拦：云存档补传过的槽不再补（cloud.ts），交分每局只交一次。
 */
export async function goLobby(url: string = lobbyUrl()): Promise<void> {
  // 点下去到大厅打开之间（等交分最多 1.5 秒，加上平台首页加载）给个回应，免得以为没点上又连点
  if (!closeLeaving) {
    closeLeaving = showBanner('正在离开……');
    // 从大厅按"后退"回来、页面是从缓存里恢复的：把提示收掉
    window.addEventListener(
      'pageshow',
      () => {
        closeLeaving?.();
        closeLeaving = null;
      },
      { once: true },
    );
  }
  await boardBeforeLeave();
  flushBeforeLeave();
  window.location.assign(url);
}
