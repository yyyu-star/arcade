/**
 * 川麻·血战到底挂到通用牌桌上的部分（DESIGN.md 第 7 节）：缺门标记、换三张、定缺、碰杠胡的动作字、刮风下雨、结算。
 */
import { chooseQue, chooseSwap } from '../../../ai/xuezhan.ts';
import { byTile, kindOf, suitOf, type Suit, type Tile } from '../../../core/tiles/index.ts';
import type { XzAction, XzEvent, XzView } from '../../../core/variants/sichuan-xuezhan/index.ts';
import { button, el } from '../../dom.ts';
import { play } from '../../sound.ts';
import type { VariantUi } from '../../table.ts';
import { FAN_NAME, SUIT_NAME, SWAP_DIR } from '../../text.ts';
import { backUrl, tileName, tileUrl } from '../../tiles.ts';
import { tingOf } from './ting.ts';

const SUIT_CLS = ['wan', 'tong', 'tiao'] as const;

function queChip(q: Suit): HTMLElement {
  const e = el('span', `tag que ${SUIT_CLS[q]}`, null, `缺${SUIT_NAME[q]}`);
  return e;
}

export const xuezhanUi: VariantUi<XzView, XzAction> = {
  seatTags(v, seat) {
    const s = v.seats[seat]!;
    if (v.phase === 'swap') return s.ready ? el('span', 'tag ok', null, '选好了') : el('span', 'tag wait', null, '换牌中');
    if (v.phase === 'que' && s.que < 0) return s.ready ? el('span', 'tag ok', null, '定好了') : el('span', 'tag wait', null, '定缺中');
    return s.que >= 0 ? queChip(s.que as Suit) : null;
  },

  multi(v) {
    return v.phase === 'swap' && v.prompt?.swap ? 3 : 0;
  },

  ting: tingOf,

  dim(v, t) {
    const q = v.me ? v.seats[v.me.seat]!.que : -1;
    return q >= 0 && suitOf(kindOf(t)) === q;
  },

  bar(v, bar, ctx) {
    const me = v.me;
    if (v.phase === 'swap') {
      if (!me || !v.prompt?.swap) {
        el('div', 'hint', bar, me ? '等别人选好换的牌…' : '大家在换三张');
        return true;
      }
      const sel = ctx.selected;
      const ok = sel.length === 3 && sel.every((t) => suitOf(kindOf(t)) === suitOf(kindOf(sel[0]!)));
      el('div', 'hint', bar, sel.length < 3 ? `选 3 张同一门的牌换出去（${sel.length}/3）` : ok ? '换出这三张？' : '三张要同一门');
      button('act soft', bar, '帮我选', () => ctx.setSelected(chooseSwap(me.hand)));
      const go = button('act go', bar, '换出', () => ok && ctx.act({ t: 'swap', tiles: sel }));
      go.disabled = !ok;
      return true;
    }
    if (v.phase === 'que') {
      if (!me || !v.prompt?.que) {
        el('div', 'hint', bar, me ? '等别人定缺…' : '大家在定缺');
        return true;
      }
      if (v.swapDir !== null && me) el('div', 'hint', bar, `${SWAP_DIR[v.swapDir]}，定一门不要的：`);
      const best = chooseQue(me.hand);
      for (const s of [0, 1, 2] as Suit[]) {
        const n = me.hand.filter((t) => suitOf(kindOf(t)) === s).length;
        const b = button(`act que ${SUIT_CLS[s]}${s === best ? ' best' : ''}`, bar, `缺${SUIT_NAME[s]}`, () => ctx.act({ t: 'que', suit: s }));
        el('small', '', b, `${n} 张`);
      }
      return true;
    }
    return false;
  },

  effects(v, fx, names) {
    const hus = v.events.filter((e) => e.e === 'hu');
    let shown = 0;
    for (const e of v.events) {
      switch (e.e) {
        case 'deal':
          play('deal');
          break;
        case 'swapped':
          fx.banner(v.me?.seat ?? 0, SWAP_DIR[e.dir]!, 'center');
          play('swap');
          break;
        case 'que':
          play('que');
          break;
        case 'draw':
          if (e.seat === v.me?.seat) play('draw');
          break;
        case 'discard':
          play('discard');
          break;
        case 'pon':
          fx.banner(e.seat, '碰！', 'pon');
          play('pon');
          break;
        case 'kan':
          fx.banner(e.seat, '杠！', 'kan');
          // 暗杠下雨，直杠、补杠刮风
          fx.weather(e.kan === 'concealed' ? 'rain' : 'wind');
          play('kan');
          window.setTimeout(() => play(e.kan === 'concealed' ? 'rain' : 'wind'), 200);
          break;
        case 'hu': {
          const multi = hus.length > 1 && e.from !== null;
          const text = e.from === null ? '自摸！' : e.rob ? '抢杠！' : multi ? (hus.length === 2 ? '一炮双响！' : '一炮三响！') : '胡！';
          fx.banner(e.seat, text, 'hu');
          play(e.from === null ? 'zimo' : 'hu');
          // 喊完"胡！"再亮牌；一炮多响一个接一个亮
          const ms = e.fan >= 2 ? HU_BIG_MS : HU_MS;
          fx.overlay(huCard(v, e, names[e.seat] ?? '', text), ms, 600 + shown * (HU_MS + 200));
          if (e.fan >= 2) window.setTimeout(() => play('big'), 900 + shown * (HU_MS + 200));
          shown++;
          break;
        }
        default:
          break;
      }
    }
  },
};

/** 胡牌亮牌摆多久：2 番以上的大牌多摆一会儿 */
const HU_MS = 2_200;
const HU_BIG_MS = 3_000;

/**
 * 胡牌高光：谁、怎么胡的、亮出的整手（副露 + 手牌 + 胡的那张描金）、番型一条条弹出来、合计几番。
 * 只用公开的：胡了的人手牌本来就亮给所有人（视图里有），番型在 hu 事件里。2 番以上描金扫光，3 番以上（或封顶）背后再转一圈光。
 */
function huCard(v: XzView, e: Extract<XzEvent, { e: 'hu' }>, name: string, how: string): HTMLElement {
  const s = v.seats[e.seat]!;
  const card = el('div', `hu-card${e.fan >= 2 ? ' big' : ''}${e.fan >= 3 ? ' huge' : ''}`);
  const head = el('div', 'head', card);
  el('span', 'who', head, name);
  el('span', 'how', head, how.replace('！', ''));
  const row = el('div', 'tiles', card);
  for (const m of s.melds) {
    const g = el('div', 'meld', row);
    for (const t of m.tiles) tileEl(t, g);
  }
  const hand = el('div', 'meld', row);
  for (const t of (s.hand ?? []).filter((t) => t !== e.tile).sort(byTile)) tileEl(t, hand);
  tileEl(e.tile, row).classList.add('win');
  const items = el('div', 'items', card);
  const list = e.items.filter((x) => x.id !== 'ping' || e.items.length === 1);
  list.forEach((x, i) => {
    const f = el('span', 'fan', items, FAN_NAME[x.id] + (x.n && x.n > 1 ? ` ×${x.n}` : ''));
    f.style.animationDelay = `${0.3 + i * 0.18}s`;
  });
  const total = el('span', 'total', items, `${e.fan} 番`);
  total.style.animationDelay = `${0.3 + list.length * 0.18 + 0.1}s`;
  return card;
}

function tileEl(t: Tile, parent: HTMLElement): HTMLElement {
  const e = el('div', 'tile md', parent);
  e.style.backgroundImage = `url("${t < 0 ? backUrl() : tileUrl(kindOf(t))}")`;
  if (t >= 0) e.title = tileName(kindOf(t));
  return e;
}
