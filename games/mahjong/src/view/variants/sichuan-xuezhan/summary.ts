/**
 * 结算（DESIGN.md 第 6 节）：一局打完列每家胡了什么番、钱怎么走的（点炮、自摸、杠钱、呼叫转移、退税、查花猪、查大叫）；
 * 一场打完再列总输赢和称号。只用公开信息。
 */
import { kindOf } from '../../../core/tiles/index.ts';
import type { XzView } from '../../../core/variants/sichuan-xuezhan/index.ts';
import { el } from '../../dom.ts';
import { backUrl, tileName, tileUrl } from '../../tiles.ts';
import type { Award } from '../../../game/awards.ts';
import type { Highlight } from '../../../game/banter.ts';
import { AWARD_NAME, awardLine, FAN_NAME, HIGHLIGHT_NAME, PAY_KIND, signed, TITLE_NAME } from '../../text.ts';

export function roundSummary(v: XzView, names: string[], unit: string): HTMLElement {
  const box = el('div', 'summary');
  const h = v.history.at(-1);
  if (!h) return box;
  el('h2', '', box, `第 ${h.round + 1} 局${h.end === 'wall' ? '：牌摸完了' : ''}`);
  // 电脑不看牌对玩家是看不见的（DESIGN.md 5.4），一局打完把所有人的牌摆出来，自己对得上
  el('p', 'fair', box, '一局打完所有人的牌都亮在这里。电脑和你一样，看不到别人手里的牌和牌墙。');
  const rows = el('div', 'rows', box);
  for (let seat = 0; seat < 4; seat++) {
    const row = el('div', `row${seat === v.me?.seat ? ' me' : ''}`, rows);
    row.dataset.seat = `${seat}`;
    el('span', 'who', row, names[seat]!);
    const w = h.wins.find((x) => x.seat === seat);
    const what = el('span', 'what', row);
    if (w) {
      const items = w.items.filter((x) => x.id !== 'ping' || w.items.length === 1);
      what.textContent = `${w.from === null ? '自摸' : `胡（${names[w.from]} 点炮）`} ${items.map((x) => FAN_NAME[x.id] + (x.n && x.n > 1 ? `×${x.n}` : '')).join(' · ')} ${w.fan} 番`;
    } else what.textContent = h.end === 'wall' ? '没胡' : '—';
    // 点炮给谁：输给谁一眼看得出来（血战里点过炮的人后面也可能胡）
    const fed = h.wins.filter((x) => x.from === seat).map((x) => names[x.seat]!);
    if (fed.length) what.textContent += ` · 点炮给 ${fed.join('、')}`;
    const n = h.net[seat]!;
    const net = el('span', `net ${n > 0 ? 'up' : n < 0 ? 'down' : ''}`, row, `${signed(n)}${unit}`);
    // 结算的动画（fx.ts 的 settleFx）从 0 数到这个数
    net.dataset.n = `${n}`;
    net.dataset.unit = unit;
    handLine(v, seat, row);
  }
  // 钱的流水：按种类合起来，一行一种
  const flows = new Map<string, number>();
  for (const p of v.ledger) {
    const key = `${p.kind}|${p.from}|${p.to}`;
    flows.set(key, (flows.get(key) ?? 0) + p.amount);
  }
  // 钱从谁那儿飞到谁那儿（settleFx 用）：只要方向，不分种类
  box.dataset.moves = JSON.stringify([...new Set([...flows.keys()].map((k) => k.split('|').slice(1).join('>')))]);
  if (flows.size) {
    const list = el('div', 'flows', box);
    for (const [key, amount] of flows) {
      const [kind, from, to] = key.split('|') as [string, string, string];
      el('div', 'flow', list, `${PAY_KIND[kind] ?? kind}：${names[Number(from)]} → ${names[Number(to)]} ${amount}${unit.replace(' ', '\u00a0')}`);
    }
  }
  return box;
}

/** 这一家最后的牌：碰杠在前，手牌按牌面排好，胡的那张单放在最后描金。视图在一局结束时本来就亮出所有人的手牌 */
function handLine(v: XzView, seat: number, row: HTMLElement): void {
  const s = v.seats[seat]!;
  if (!s.hand) return;
  const line = el('div', 'hand-line', row);
  const tile = (t: number, parent: HTMLElement): HTMLElement => {
    const e = el('span', 'mini', parent);
    e.style.backgroundImage = `url("${t < 0 ? backUrl() : tileUrl(kindOf(t))}")`;
    if (t >= 0) e.title = tileName(kindOf(t));
    return e;
  };
  for (const m of s.melds) {
    const g = el('span', 'group', line);
    for (const t of m.tiles) tile(t, g);
  }
  const hand = s.hand.slice().sort((a, b) => kindOf(a) - kindOf(b) || a - b);
  const won = s.won?.tile;
  if (won !== undefined && hand.includes(won)) hand.splice(hand.indexOf(won), 1);
  const g = el('span', 'group', line);
  for (const t of hand) tile(t, g);
  if (won !== undefined) {
    const w = tile(won, line);
    w.classList.add('won');
    w.title = `${tileName(kindOf(won))}：${s.won!.from === null ? '自摸' : '胡的这张'}`;
  }
}

export function matchSummary(v: XzView, names: string[], unit: string): HTMLElement {
  const box = el('div', 'summary final');
  el('h2', '', box, '这一场打完了');
  const r = v.result;
  if (!r) return box;
  const order = [0, 1, 2, 3].sort((a, b) => r.seats[b]!.net - r.seats[a]!.net);
  const rows = el('div', 'rows', box);
  order.forEach((seat, i) => {
    const x = r.seats[seat]!;
    const row = el('div', `row${seat === v.me?.seat ? ' me' : ''}`, rows);
    el('span', 'rank', row, `${i + 1}`);
    el('span', 'who', row, names[seat]!);
    const st = v.seats[seat]!.stats;
    el('span', 'what', row, `胡 ${st.wins} · 自摸 ${st.zimo} · 点炮 ${st.pao} · 杠 ${st.gangs}`);
    el('span', `net ${x.net > 0 ? 'up' : x.net < 0 ? 'down' : ''}`, row, `${signed(x.net)}${unit}`);
    const titles = el('div', 'titles', row);
    for (const t of x.stats.titles ?? []) el('span', 'title', titles, TITLE_NAME[t] ?? t);
  });
  return box;
}

/** 好友房一场结束的颁奖（game/awards.ts）：奖名、得奖的人大字，下面一句话 */
export function awardsSummary(list: readonly Award[], names: string[], unit: string): HTMLElement {
  const box = el('div', 'summary awards');
  el('h2', '', box, '颁奖');
  const row = el('div', 'award-row', box);
  for (const a of list) {
    const card = el('div', `award ${a.id}`, row);
    el('div', 'award-name', card, AWARD_NAME[a.id]);
    el('div', 'award-who', card, names[a.seat] ?? '');
    el('div', 'award-line', card, awardLine(a, names[a.seat] ?? '', unit));
  }
  return box;
}

/** 这一场的名场面（game/banter.ts 的 highlightsOf，从公开的胡牌里认出来的） */
export function fameSummary(list: readonly Highlight[], names: string[]): HTMLElement {
  const box = el('div', 'summary fame-list');
  el('h2', '', box, '名场面');
  for (const h of list.slice(-8)) el('div', 'flow', box, `第 ${h.round + 1} 局 · ${names[h.seat] ?? ''} ${HIGHLIGHT_NAME[h.id]}`);
  return box;
}
