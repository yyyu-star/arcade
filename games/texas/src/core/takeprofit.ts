/**
 * 止盈（0.22.0，所有者 10-19）：赢够了自动起身。纯函数：页面在一手打完时问一次，到了就离桌（单机结回钱包、好友房离座结回、娱乐只是离桌）。
 * 目标按这次带上桌的算（坐下加补码）；只做止盈，不做止损（所有者没要）。设置存 texas.settings 的 takeProfit
 */
export type TakeProfit = { kind: 'off' } | { kind: 'pct'; pct: number } | { kind: 'amount'; amount: number };

export const TP_OFF: TakeProfit = { kind: 'off' };
/** 面板上的几档（赢带入的百分之几） */
export const TP_PCTS = [50, 100, 200] as const;

/** 存档里的样子转回来；不认得的当关 */
export function parseTakeProfit(raw: unknown): TakeProfit {
  if (!raw || typeof raw !== 'object') return TP_OFF;
  const o = raw as Record<string, unknown>;
  if (o.kind === 'pct' && typeof o.pct === 'number' && Number.isInteger(o.pct) && o.pct > 0 && o.pct <= 10_000) return { kind: 'pct', pct: o.pct };
  if (o.kind === 'amount' && typeof o.amount === 'number' && Number.isSafeInteger(o.amount) && o.amount > 0) return { kind: 'amount', amount: o.amount };
  return TP_OFF;
}

/** 要赢多少才走（带入 buyIn 时）；关着、带入是 0 时 null */
export function profitTarget(tp: TakeProfit, buyIn: number): number | null {
  if (tp.kind === 'off' || buyIn <= 0) return null;
  // 整数运算：百分比按带入算，向上取整到 1（赢 50% 的 2,001 要赢 1,001 才算到）
  return tp.kind === 'pct' ? Math.ceil((buyIn * tp.pct) / 100) : tp.amount;
}

/** 一手打完时问：净赢（现在的 - 带入的）够了没有 */
export function reached(tp: TakeProfit, buyIn: number, now: number): boolean {
  const t = profitTarget(tp, buyIn);
  return t !== null && now - buyIn >= t;
}

/** 按钮上的字 */
export function takeProfitLabel(tp: TakeProfit, chips: (n: number) => string): string {
  return tp.kind === 'off' ? '止盈：关' : tp.kind === 'pct' ? `止盈：赢 ${tp.pct}%` : `止盈：赢 ${chips(tp.amount)}`;
}
