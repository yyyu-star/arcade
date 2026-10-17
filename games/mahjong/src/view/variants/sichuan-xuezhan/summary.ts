/**
 * 结算（DESIGN.md 第 6 节）：一局打完列每家胡了什么番、钱怎么走的（点炮、自摸、杠钱、呼叫转移、退税、查花猪、查大叫）；
 * 一场打完再列总输赢和称号。只用公开信息。
 */
import type { XzView } from '../../../core/variants/sichuan-xuezhan/index.ts';
import { el } from '../../dom.ts';
import type { Award } from '../../../game/awards.ts';
import type { Highlight } from '../../../game/banter.ts';
import { AWARD_NAME, awardLine, FAN_NAME, HIGHLIGHT_NAME, PAY_KIND, signed, TITLE_NAME } from '../../text.ts';

export function roundSummary(v: XzView, names: string[], unit: string): HTMLElement {
  const box = el('div', 'summary');
  const h = v.history.at(-1);
  if (!h) return box;
  el('h2', '', box, `第 ${h.round + 1} 局${h.end === 'wall' ? '：牌摸完了' : ''}`);
  const rows = el('div', 'rows', box);
  for (let seat = 0; seat < 4; seat++) {
    const row = el('div', `row${seat === v.me?.seat ? ' me' : ''}`, rows);
    el('span', 'who', row, names[seat]!);
    const w = h.wins.find((x) => x.seat === seat);
    const what = el('span', 'what', row);
    if (w) {
      const items = w.items.filter((x) => x.id !== 'ping' || w.items.length === 1);
      what.textContent = `${w.from === null ? '自摸' : `胡（${names[w.from]} 点炮）`} ${items.map((x) => FAN_NAME[x.id] + (x.n && x.n > 1 ? `×${x.n}` : '')).join(' · ')} ${w.fan} 番`;
    } else what.textContent = h.end === 'wall' ? '没胡' : '—';
    const n = h.net[seat]!;
    el('span', `net ${n > 0 ? 'up' : n < 0 ? 'down' : ''}`, row, `${signed(n)}${unit}`);
  }
  // 钱的流水：按种类合起来，一行一种
  const flows = new Map<string, number>();
  for (const p of v.ledger) {
    const key = `${p.kind}|${p.from}|${p.to}`;
    flows.set(key, (flows.get(key) ?? 0) + p.amount);
  }
  if (flows.size) {
    const list = el('div', 'flows', box);
    for (const [key, amount] of flows) {
      const [kind, from, to] = key.split('|') as [string, string, string];
      el('div', 'flow', list, `${PAY_KIND[kind] ?? kind}：${names[Number(from)]} → ${names[Number(to)]} ${amount}${unit}`);
    }
  }
  return box;
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
