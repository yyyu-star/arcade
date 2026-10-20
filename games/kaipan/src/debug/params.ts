import { MAX_DIFFICULTY, MIN_DIFFICULTY, THEME_IDS, dailySetup, isPersonaId, type RunSetup, type ThemeId } from '../core/index.ts';
import { dailyDate } from '../view/labels.ts';
import type { AnimOverride } from '../view/options.ts';

/**
 * URL 参数（调试与自动化用），开局部分映射到 core 的 RunSetup（docs/core-api.md 第 14 节）：
 * - seed：指定种子开新局（不读存档，跳过开始菜单）
 * - account（开局账户，元）、items=a,b（道具 id）、friends=a,b（额外群友）、themes=a,b,…（6 个登场题材）、
 *   holdings=a,b（开局持仓的股票 id）、difficulty（难度等级 1..8）、persona（人设 id）
 * - daily=1（今天）/ daily=YYYY-MM-DD：按 core 的 dailySetup 开那天的每日挑战（种子、人设、难度都用它的；
 *   再带 seed / persona / difficulty 会覆盖对应项，仅供调试，档案仍按那天的每日挑战记）
 * - anim=0 / anim=1：关闭 / 开启动画；speed=N：动画倍速（二者优先于玩家设置）；debug=1：调试浮层（显示隐藏信息）
 * - scale=N：强制渲染倍数（在 view/theme.ts 中读取）；soundboard=1：音频试听面板（在 view/audio 中读取）
 */
interface LaunchParams {
  seed: string | null;
  setup: RunSetup | null;
  /** URL 指定的动画参数（优先于设置） */
  anim: AnimOverride;
  debug: boolean;
  /** ext=1：URL 开的局也打开 0.4 C 的仓位、押跌、银行（缺省按 0.3 玩法开，旧的自动化脚本不受影响） */
  ext: boolean;
}

function num(v: string | null): number | undefined {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function list(v: string | null): string[] | undefined {
  if (!v) return undefined;
  const out = v.split(',').map((s) => s.trim()).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

export function parseParams(search: string): LaunchParams {
  const q = new URLSearchParams(search);
  const setup: RunSetup = {};
  const account = num(q.get('account'));
  if (account !== undefined) setup.account = account;
  const items = list(q.get('items'));
  if (items) setup.items = items;
  const friends = list(q.get('friends'));
  if (friends) setup.friends = friends;
  const themes = list(q.get('themes'))?.filter((t): t is ThemeId => (THEME_IDS as readonly string[]).includes(t));
  if (themes && themes.length > 0) setup.themes = themes;
  const holdings = list(q.get('holdings'));
  if (holdings) setup.holdings = holdings;
  const difficulty = num(q.get('difficulty'));
  if (difficulty !== undefined) setup.difficulty = Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, Math.trunc(difficulty)));
  const persona = q.get('persona');
  if (persona && isPersonaId(persona)) setup.persona = persona;
  let seed = q.get('seed') || null;
  const dailyArg = q.get('daily');
  if (dailyArg) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dailyArg) ? dailyArg : dailyDate();
    const d = dailySetup(date);
    seed ??= d.seed;
    setup.persona ??= d.setup.persona;
    setup.difficulty ??= d.setup.difficulty;
    setup.daily = d.setup.daily;
  }

  const speed = num(q.get('speed'));
  return {
    seed,
    setup: Object.keys(setup).length > 0 ? setup : null,
    anim: {
      anim: q.get('anim') === '0' ? false : q.get('anim') === '1' ? true : null,
      speed: speed !== undefined && speed > 0 ? speed : null,
    },
    debug: q.get('debug') === '1',
    ext: q.get('ext') === '1',
  };
}
