/**
 * 0.6.0 实盘模式（docs/design-live.md）：档位、开局设置、资产和结回倍数。
 * 规则上的不同（只打几个月、账单打折）写在这局的开局设置 `RunSetup.live` 里，由 engine 读；这里只有纯函数。
 * 钱包、筹码的进出不在规则核心里（画面层和 Worker 管）。
 */
import { BALANCE } from './balance.ts';
import { personaAccount } from './content/index.ts';
import { debtOf } from './engine.ts';
import { LIVE_MAX_BP, LIVE_TIERS, liveReturn, liveTierById, type LiveTier, type LiveTierDef } from './liveTiers.ts';
import type { GameState, PersonaId, RunSetup } from './types.ts';

export { LIVE_MAX_BP, LIVE_TIERS, isLiveTier, liveReturn, liveTierById, type LiveTier, type LiveTierDef } from './liveTiers.ts';

/** 实盘开局设置：难度由档位定，规则从 BALANCE.live 抄进这局（以后改默认值不影响已经开了的局）。 */
export function liveSetup(tier: LiveTier, persona: PersonaId = 'newbie'): RunSetup {
  const { billMult, lev } = BALANCE.live.tiers[tier];
  return { persona, difficulty: liveTierById(tier).difficulty, live: { months: BALANCE.live.months, billMult, lev, tier } };
}

/** 0.10.0 以前一档一个难度，那时开的局没记档位，按难度认 */
const LEGACY_TIER: Record<number, LiveTier> = { 1: 'small', 2: 'mid', 3: 'big', 4: 'lux' };

/** 这局是不是实盘 */
export function isLive(s: Readonly<GameState>): boolean {
  return !!s.setup?.live;
}

/** 这局的档位（开局设置里记着；更早的局按难度认）；不是实盘或认不出为 null */
export function liveTierOf(s: Readonly<GameState>): LiveTierDef | null {
  const live = s.setup?.live;
  if (!live) return null;
  const id = live.tier ?? LEGACY_TIER[s.difficulty];
  return id ? liveTierById(id) : null;
}

/**
 * 正常从界面开的实盘局（只有人设、难度、实盘规则）：图鉴照记，别的都不记（docs/design-live.md 第 7 节）。
 * 带了调试字段的不算，和 isRankedSetup 一个道理。
 */
export function isCleanLiveSetup(setup: Readonly<RunSetup> | null): boolean {
  return !!setup?.live && Object.keys(setup).every((k) => k === 'persona' || k === 'difficulty' || k === 'live');
}

/** 开局资产：开局账户（人设定的；调试设置可以改） */
export function liveStart(s: Readonly<GameState>): number {
  return s.setup?.account ?? personaAccount(s.persona);
}

/** 当前资产：账户（持仓、押跌都已按最近一次收盘算在里面）减去没还的借款；可能是负数 */
export function liveAssets(s: Readonly<GameState>): number {
  return Math.round((s.account - debtOf(s)) * 100) / 100;
}

/**
 * 结回倍数（万分之几的整数，0..cap × 10000）：1 + 涨跌倍数 ×（当前资产 ÷ 开局资产 − 1），向下取整到万分之一；破产为 0。
 * 涨跌倍数是 1 的老局照原来的算式算，免得浮点多绕一步差出 1。
 * 用整数传给 Worker，结回 = ⌊一份 × 倍数 ÷ 10000⌋ 全是整数运算，不会因为小数误差少给 1 筹码。
 */
export function liveMultipleBp(s: Readonly<GameState>): number {
  if (s.phase === 'lost') return 0;
  const start = liveStart(s);
  if (!(start > 0)) return 0;
  const lev = s.setup?.live?.lev ?? 1;
  const r = liveAssets(s) / start;
  const bp = Math.floor((lev === 1 ? r : 1 + lev * (r - 1)) * 10_000);
  return Math.max(0, Math.min(LIVE_MAX_BP, bp));
}

/** 按现在的资产，这局能结回多少筹码（顶栏小牌子、提前收手的确认框用）；不是实盘为 null */
export function liveValue(s: Readonly<GameState>): number | null {
  const t = liveTierOf(s);
  return t ? liveReturn(t.stake, liveMultipleBp(s)) : null;
}
