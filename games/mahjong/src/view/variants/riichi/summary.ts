/**
 * 立直的结算（docs/riichi.md 第 4 节）：一局一张役种表——每个役一行写名字和番数，宝牌、赤宝牌、里宝牌分开写，再写符、番、点数；
 * 每家点数怎么动、本场和供托；流局写谁听牌、中途流局写原因。一场打完再列终局点数、顺位、马、头名奖、得分和筹码。只用公开信息。
 */
import { kindOf, byTile, type Tile } from '../../../core/tiles/index.ts';
import { isRed, RETURN_POINTS, START_POINTS, UMA, YAKU_NAME, SEATS, type HandScore, type RcView, type RcWin } from '../../../core/variants/riichi/index.ts';
import type { ShareCard } from 'arcade-kit/share';
import { el } from '../../dom.ts';
import { GAME_NAME, num, signed, TITLE_NAME } from '../../text.ts';
import { backUrl, tileName, tileUrl } from '../../tiles.ts';
import { ABORT_WHY, END_NAME, LIMIT_NAME, PAY_NAME, RC_WIND, roundName, scoreText, yakumanName } from './text.ts';

export interface YakuLine {
  name: string;
  /** "1 番"、"役满" */
  han: string;
  /** 宝牌这一类（赤、里宝也算），表里画得淡一点 */
  dora?: true;
}

/** 役种表的行：役在前，宝牌、赤宝牌、里宝牌分开写；役满只列役满的名字 */
export function yakuLines(sc: HandScore): YakuLine[] {
  const out: YakuLine[] = [];
  if (sc.yakuman && !sc.kazoe) {
    for (const y of sc.yaku) out.push({ name: YAKU_NAME[y.id], han: '役满' });
    return out;
  }
  for (const y of sc.yaku) out.push({ name: YAKU_NAME[y.id], han: `${y.han} 番` });
  if (sc.dora) out.push({ name: '宝牌', han: `${sc.dora} 番`, dora: true });
  if (sc.aka) out.push({ name: '赤宝牌', han: `${sc.aka} 番`, dora: true });
  if (sc.ura) out.push({ name: '里宝牌', han: `${sc.ura} 番`, dora: true });
  return out;
}

/** 符、番、封顶的叫法："30 符 4 番"、"满贯"、"役满"、"双倍役满" */
export function scoreHead(sc: HandScore): string {
  if (sc.yakuman && !sc.kazoe) return yakumanName(sc.yakuman);
  if (sc.kazoe) return `${sc.han} 番 · 累计役满`;
  const limit = LIMIT_NAME[sc.limit];
  return limit ? `${sc.han} 番 · ${limit}` : `${sc.fu} 符 ${sc.han} 番`;
}

/** 这一把本身值多少点（不含本场和供托）：从点数流水里加出来，包牌、双响都不用另算 */
export function handValue(ledger: RcView['ledger'], w: RcWin): number {
  return ledger.filter((p) => p.to === w.seat && (p.kind === 'ron' || p.kind === 'tsumo' || p.kind === 'pao')).reduce((a, p) => a + p.amount, 0);
}

/** 一个小牌（结算里的牌面），赤宝牌画红的 */
function mini(t: Tile, parent: HTMLElement, cls = 'mini'): HTMLElement {
  const e = el('span', cls, parent);
  const red = t >= 0 && isRed(t);
  e.style.backgroundImage = `url("${t < 0 ? backUrl() : tileUrl(kindOf(t), red)}")`;
  if (t >= 0) e.title = tileName(kindOf(t), red);
  return e;
}

/** 一手牌：副露在前，手牌排好，和的那张单放最后描金 */
function handLine(hand: readonly Tile[], melds: RcWin['melds'], won: Tile | null, parent: HTMLElement): void {
  const line = el('div', 'hand-line', parent);
  for (const m of melds) {
    const g = el('span', 'group', line);
    m.tiles.forEach((t, i) => mini(m.kan === 'concealed' && (i === 0 || i === 3) ? -1 : t, g));
  }
  const rest = hand.slice().sort(byTile);
  if (won !== null && rest.includes(won)) rest.splice(rest.indexOf(won), 1);
  const g = el('span', 'group', line);
  for (const t of rest) mini(t, g);
  if (won !== null) mini(won, line).classList.add('won');
}

/** 一排指示牌：宝牌指示牌、里宝指示牌 */
function indicators(label: string, tiles: readonly Tile[], parent: HTMLElement): void {
  const row = el('span', 'rc-ind', parent);
  el('span', 'rc-ind-label', row, label);
  const g = el('span', 'group', row);
  for (const t of tiles) mini(t, g);
}

export function roundSummary(v: RcView, names: string[]): HTMLElement {
  const box = el('div', 'summary rc-summary');
  const h = v.history.at(-1);
  if (!h) return box;
  const head = el('h2', '', box);
  head.append(`${roundName(h.wind, h.hand)} · ${END_NAME[h.end]}`);
  if (h.honba) el('small', '', head, ` ${h.honba} 本场`);
  const why = ABORT_WHY[h.end];
  if (why) el('p', 'fair', box, why);
  // 电脑不看牌对玩家是看不见的（DESIGN.md 5.4），和了、听牌的人把牌亮出来，自己对得上
  if (h.wins.length || h.tenpai) el('p', 'fair', box, '和了、听牌的人亮出手牌。电脑和你一样，看不到别人手里的牌和牌墙。');
  if (h.dora.length || h.ura.length) {
    const line = el('div', 'rc-inds', box);
    indicators('宝牌指示', h.dora, line);
    if (h.ura.length) indicators('里宝指示', h.ura, line);
  }
  for (const w of h.wins) winBlock(v, w, names, box);
  const rows = el('div', 'rows', box);
  for (let seat = 0; seat < SEATS; seat++) {
    const row = el('div', `row${seat === v.me?.seat ? ' me' : ''}`, rows);
    row.dataset.seat = `${seat}`;
    el('span', 'who', row, `${RC_WIND[(seat - h.dealer + SEATS) % SEATS]}家 ${names[seat]}`);
    const what = el('span', 'what', row);
    const win = h.wins.find((x) => x.seat === seat);
    if (win) what.textContent = win.from === null ? '自摸' : '荣和';
    else if (h.wins.some((x) => x.from === seat)) what.textContent = '放铳';
    else if (h.tenpai) what.textContent = h.tenpai[seat] ? '听牌' : '没听牌';
    else what.textContent = '—';
    const d = h.delta[seat]!;
    const net = el('span', `net ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`, row, signed(d));
    // 结算的动画（fx.ts 的 settleFx）从 0 数到这个数
    net.dataset.n = `${d}`;
    el('span', 'rc-pts', row, `${num(v.seats[seat]!.points)} 点`);
    if (h.tenpai?.[seat]) {
      const s = v.seats[seat]!;
      if (s.hand) handLine(s.hand, s.melds, null, row);
    }
  }
  // 点数从谁那儿飞到谁那儿（settleFx 用）：只要方向，桌上的供托不算
  box.dataset.moves = JSON.stringify([...new Set(v.ledger.filter((p) => p.from >= 0 && p.to >= 0).map((p) => `${p.from}>${p.to}`))]);
  // 点数怎么动的：本场、供托、不听罚符这些另写一行，免得和役种表里的点数对不上
  const flows = new Map<string, number>();
  for (const p of v.ledger) {
    if (p.kind === 'ron' || p.kind === 'tsumo') continue;
    const key = `${p.kind}|${p.from}|${p.to}`;
    flows.set(key, (flows.get(key) ?? 0) + p.amount);
  }
  if (flows.size) {
    const list = el('div', 'flows', box);
    for (const [key, amount] of flows) {
      const [kind, from, to] = key.split('|') as [string, string, string];
      const f = Number(from);
      const t = Number(to);
      el('div', 'flow', list, `${PAY_NAME[kind] ?? kind}：${f < 0 ? '桌上' : names[f]} → ${t < 0 ? '桌上' : names[t]} ${num(amount)} 点`);
    }
  }
  if (v.sticks && !v.final) el('div', 'rc-sticks', box, `桌上还有 ${v.sticks} 根立直棒，留给下一个和牌的人`);
  return box;
}

/** 一次和牌：谁、怎么和的、亮出的整手、役种表、符番点数 */
function winBlock(v: RcView, w: RcWin, names: string[], parent: HTMLElement): void {
  const sc = w.score;
  const win = el('div', 'rc-win', parent);
  const who = el('div', 'rc-who', win);
  el('b', '', who, names[w.seat]);
  who.append(w.from === null ? ' 自摸' : ` 荣和（${names[w.from]} 放铳）`);
  if (w.pao !== null) el('small', '', who, ` · ${names[w.pao]} 包牌`);
  handLine(w.hand, w.melds, w.tile, win);
  const table = el('div', 'rc-yaku', win);
  for (const l of yakuLines(sc)) {
    const r = el('div', `rc-yaku-row${l.dora ? ' dora' : ''}`, table);
    el('span', 'n', r, l.name);
    el('span', 'f', r, l.han);
  }
  const total = el('div', 'rc-total', win);
  el('span', 'rc-head', total, scoreHead(sc));
  el('span', 'rc-value', total, `${num(handValue(v.ledger, w))} 点`);
}

/** 一场的名次表：终局点数、顺位、马、头名奖、得分、筹码 */
export function matchSummary(v: RcView, names: string[], unit: string): HTMLElement {
  const box = el('div', 'summary final rc-summary');
  el('h2', '', box, `这一场打完了 · ${v.opts.length === 'hanchan' ? '半庄' : '东风战'}`);
  const f = v.final;
  const r = v.result;
  if (!f || !r) return box;
  const rows = el('div', 'rows', box);
  const oka = (RETURN_POINTS - START_POINTS) * SEATS;
  f.rank.forEach((seat, i) => {
    const x = r.seats[seat]!;
    const row = el('div', `row${seat === v.me?.seat ? ' me' : ''}`, rows);
    el('span', 'rank', row, `${i + 1}`);
    el('span', 'who', row, names[seat]!);
    const parts = [`终局 ${num(v.seats[seat]!.points)} 点`, `马 ${scoreText(UMA[i]! * 1000)}`];
    if (i === 0) parts.push(`头名奖 ${scoreText(oka)}`);
    el('span', 'what', row, parts.join(' · '));
    el('span', 'rc-score', row, `得分 ${scoreText(f.score[seat]!)}`);
    el('span', `net ${x.net > 0 ? 'up' : x.net < 0 ? 'down' : ''}`, row, `${signed(x.net)}${unit}`);
    const titles = el('div', 'titles', row);
    for (const t of x.stats.titles ?? []) el('span', 'title', titles, TITLE_NAME[t] ?? t);
  });
  return box;
}

/** 自己这一场的战绩图（分享用）：只放公开的、自己的数 */
export function cardOf(v: RcView, title: string, unit: string, name: string): ShareCard | null {
  const me = v.me?.seat;
  const r = me === undefined ? undefined : v.result?.seats[me];
  if (me === undefined || !r || !v.final) return null;
  const st = v.seats[me]!.stats;
  const titles = r.stats.titles ?? [];
  const badge = titles[0] === undefined ? undefined : TITLE_NAME[titles[0]];
  return {
    game: GAME_NAME,
    title,
    accent: '#0f5a41',
    big: { value: signed(r.net), label: unit },
    stats: [
      { label: '顺位', value: `第 ${v.final.rank.indexOf(me) + 1} 名` },
      { label: '得分', value: scoreText(v.final.score[me]!) },
      { label: '和了', value: `${st.wins} 局` },
    ],
    ...(badge ? { line: `这一场拿到「${badge}」` } : {}),
    player: { name, ...(badge ? { badge } : {}) },
  };
}
