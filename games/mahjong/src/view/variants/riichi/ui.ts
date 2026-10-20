/**
 * 立直麻将挂到公共牌桌上的部分（docs/riichi.md 第 4 节）：中控盘（局名、本场、供托、剩几张、宝牌指示）、自风小签和点数、立直棒、
 * 立直宣告牌横放、操作条（吃碰杠立直荣和自摸过、九种九牌）、听牌和振听提示、动作大字和和牌亮牌。
 * 规则只读核心给的视图（prompt、事件）；这里不算役、不算点数。
 */
import { byTile, kindOf, type Tile } from '../../../core/tiles/index.ts';
import { isRed, type RcAction, type RcEvent } from '../../../core/variants/riichi/index.ts';
import { button, el } from '../../dom.ts';
import { play } from '../../sound.ts';
import { landAt, type BarCtx, type CommonAct, type Paint, type VariantUi } from '../../table.ts';
import { num } from '../../text.ts';
import { tileName, tileUrl } from '../../tiles.ts';
import { yakuLines, scoreHead } from './summary.ts';
import { END_NAME, FURITEN_WHY, RC_WIND, roundName } from './text.ts';
import { tingOf } from './ting.ts';
import { ended, type RcTable } from './view.ts';
import './riichi.css';

// ---------- 操作条的临时状态（只管画面：按了立直等着选牌、吃杠的选择弹窗开着没有） ----------

/** 按了"立直"，等着选打哪张（只亮打了还听牌的几张） */
let riichiMode = false;
/** 选择弹窗：吃有几种吃法、杠有几种杠时开 */
let pick: 'chi' | 'kan' | null = null;
/** 九种九牌点了一下，等再点确认（一点就流局太容易误触） */
let kyuuArmed = false;
/** 上一次画操作条时的局面签名：换了一手（新的声明窗口、新摸的牌）就把上面几个清掉 */
let sigOf = '';

/** 开新牌桌时清掉 */
export function resetRiichiUi(): void {
  riichiMode = false;
  pick = null;
  kyuuArmed = false;
  sigOf = '';
}

/** 牌桌发来的通用动作 → 日麻的动作：按了立直再打牌，就是立直宣告 */
export function toRcAction(a: CommonAct | RcAction): RcAction {
  if (a.t === 'discard') {
    const riichi = riichiMode;
    riichiMode = false;
    return riichi ? { t: 'discard', tile: a.tile, riichi: true } : { t: 'discard', tile: a.tile };
  }
  return a as RcAction;
}

/** 换了一手（新的声明窗口、新摸的牌）就把上面几个临时状态清掉；手牌和操作条每次重画前都先问一遍 */
function sync(v: RcTable): void {
  const p = v.prompt;
  const sig = p?.claim ? `c${p.claim.w}` : p?.discard ? `t${v.me!.hand.join(',')}` : '';
  if (sig === sigOf) return;
  sigOf = sig;
  riichiMode = false;
  pick = null;
  kyuuArmed = false;
}

// ---------- 中控盘 ----------

/** 宝牌指示一条：翻开的在前，没翻的画牌背占位（最多五张：开四杠） */
function doraStrip(tiles: readonly Tile[], total: number, parent: HTMLElement, paint: Paint, label: string): void {
  const row = el('div', 'rc-dora', parent);
  row.title = label;
  for (let i = 0; i < total; i++) paint.tile(tiles[i] ?? -1, 'xs', row);
}

function center(v: RcTable, mid: HTMLElement, paint: Paint): void {
  mid.classList.add('rc-mid');
  // 一局结束停着的时候，座位上的局数已经是下一局了：局名、宝牌都用刚打完的这一局的
  const last = ended(v) ? v.history.at(-1) : undefined;
  const name = last ? roundName(last.wind, last.hand) : roundName(v.wind, v.hand);
  const honba = last ? last.honba : v.honba;
  if (last) {
    el('div', 'rc-name', mid, name);
    doraStrip(last.dora, last.dora.length, mid, paint, '宝牌指示牌');
    if (last.ura.length) doraStrip(last.ura, last.ura.length, mid, paint, '里宝牌指示牌');
    else el('div', 'rc-end', mid, END_NAME[last.end]);
    return;
  }
  doraStrip(v.dora, 5, mid, paint, '宝牌指示牌（翻开的在前，开杠后多翻一张）');
  el('div', 'rc-name', mid, name);
  const wall = el('div', 'rc-wall', mid);
  wall.title = '牌墙还剩几张';
  el('span', 'wall', wall, `${v.wall}`);
  el('small', '', wall, '张');
  const sub = el('div', 'rc-sub', mid);
  const b = el('span', 'honba', sub, '本场');
  el('b', '', b, `${honba}`);
  const s = el('span', 'sticks', sub, '供托');
  el('b', '', s, `${v.sticks}`);
}

// ---------- 操作条 ----------

const CLAIM_ORDER = ['chi', 'pon', 'kan', 'ron'] as const;
const CLAIM_TEXT = { chi: '吃', pon: '碰', kan: '杠', ron: '和' } as const;

/** 吃的几种吃法：每种是三张牌（被吃的那张和手里的两张），按牌面从小到大摆 */
function chiCombos(v: RcTable, lows: readonly number[]): { low: number; tiles: Tile[] }[] {
  const claimed = v.claim!.tile;
  const hand = v.me!.hand;
  return lows.map((low) => {
    const tiles = [low, low + 1, low + 2].map((k) => (k === kindOf(claimed) ? claimed : hand.find((t) => kindOf(t) === k)!));
    return { low, tiles };
  });
}

function tingRow(v: RcTable, bar: HTMLElement, ctx: BarCtx<RcAction>, waits: { kind: number; left: number }[], lead: string, furiten: boolean): void {
  ctx.ting(bar, waits, lead);
  const me = v.me!;
  if (!furiten || !me.furiten) return;
  // 振听：这手牌能自摸，不能荣和；原因是哪一种。放在听牌那排上面的提示条里（和"再点一下打出"同一个位置），听牌那排不折行
  el('div', 'hint rc-fu', bar, `振听：只能自摸（${FURITEN_WHY[me.furiten]}）`);
}

function claimBar(v: RcTable, bar: HTMLElement, ctx: BarCtx<RcAction>): void {
  const c = v.prompt!.claim!;
  const me = v.me!;
  const tile = v.claim!.tile;
  ctx.tile(tile, 'md', el('div', 'claim-tile', bar));
  // 这张正是我听的牌，但我振听：不给"和"，说一句为什么
  if (!c.opts.includes('ron') && me.furiten && me.waits.includes(kindOf(tile))) el('div', 'hint rc-fu', bar, `振听：这张不能和（${FURITEN_WHY[me.furiten]}）`);
  for (const o of CLAIM_ORDER) {
    if (!c.opts.includes(o)) continue;
    const send = (): void => ctx.act(o === 'chi' ? { t: 'claim', w: c.w, c: 'chi', low: c.chi[0]! } : { t: 'claim', w: c.w, c: o });
    if (o === 'chi' && c.chi.length > 1) {
      button(`act chi${pick === 'chi' ? ' on' : ''}`, bar, '吃', () => {
        pick = pick === 'chi' ? null : 'chi';
        ctx.setSelected([]);
      });
    } else button(`act ${o}`, bar, CLAIM_TEXT[o], send);
  }
  button('act pass', bar, '过', () => ctx.act({ t: 'claim', w: c.w, c: 'pass' }));
  if (pick === 'chi' && c.chi.length > 1) {
    const panel = el('div', 'rc-pick', bar);
    el('div', 'rc-pick-title', panel, '吃哪一组？');
    for (const o of chiCombos(v, c.chi)) {
      const b = button('rc-opt', panel, '', () => ctx.act({ t: 'claim', w: c.w, c: 'chi', low: o.low }));
      for (const t of o.tiles) ctx.tile(t, 'md', b).classList.toggle('called', t === tile);
    }
  }
}

function turnBar(v: RcTable, bar: HTMLElement, ctx: BarCtx<RcAction>): void {
  const p = v.prompt!;
  const me = v.me!;
  if (p.tsumo) button('act ron', bar, '自摸', () => ctx.act({ t: 'tsumo' }));
  if (p.riichi) {
    button(`act riichi${riichiMode ? ' on' : ''}`, bar, riichiMode ? '取消立直' : '立直', () => {
      riichiMode = !riichiMode;
      ctx.setSelected([]);
    });
  }
  const kans = p.kan ?? [];
  if (kans.length === 1) {
    const t = kans[0]!;
    const b = button('act kan', bar, '杠', () => ctx.act({ t: 'kan', tile: t }));
    ctx.tile(t, 'xs', b);
  } else if (kans.length > 1) {
    button(`act kan${pick === 'kan' ? ' on' : ''}`, bar, '杠', () => {
      pick = pick === 'kan' ? null : 'kan';
      ctx.setSelected([]);
    });
  }
  if (p.kyuushu) {
    button(`act kyuu${kyuuArmed ? ' armed' : ''}`, bar, kyuuArmed ? '确定流局？' : '九种九牌', () => {
      if (kyuuArmed) return ctx.act({ t: 'kyuushu' });
      kyuuArmed = true;
      ctx.setSelected([]);
    });
  }
  const sel = ctx.selected[0];
  const after = sel === undefined ? null : tingOf(v, sel);
  if (after) tingRow(v, bar, ctx, after, riichiMode ? '立直听' : '打了听', false);
  else {
    const text = riichiMode ? (sel === undefined ? '选一张打出去，宣告立直' : '再点一下，立直') : sel === undefined ? (p.tsumo || p.kan || p.riichi ? '' : '点两下或往上拖打出') : '再点一下打出';
    if (text) el('div', 'hint', bar, text);
  }
  if (pick === 'kan' && kans.length > 1) {
    const panel = el('div', 'rc-pick', bar);
    el('div', 'rc-pick-title', panel, '杠哪一种？');
    const melds = v.seats[me.seat]!.melds;
    for (const t of kans) {
      const added = melds.some((m) => m.kind === 'pon' && kindOf(m.tiles[0]!) === kindOf(t));
      const b = button('rc-opt', panel, '', () => ctx.act({ t: 'kan', tile: t }));
      ctx.tile(t, 'md', b);
      el('small', '', b, added ? '加杠' : '暗杠');
    }
  }
}

function bar(v: RcTable, bar: HTMLElement, ctx: BarCtx<RcAction>): boolean {
  const me = v.me;
  if (!me) return true;
  sync(v);
  const p = v.prompt;
  if (p?.claim) {
    claimBar(v, bar, ctx);
    return true;
  }
  if (p?.discard) {
    turnBar(v, bar, ctx);
    return true;
  }
  const now = tingOf(v, null);
  if (now) tingRow(v, bar, ctx, now, '听', true);
  if (!p && v.claim && !v.claim.answered && v.claim.from !== me.seat) el('div', 'hint', bar, '等别人想一想…');
  return true;
}

// ---------- 动作大字、音效、和牌亮牌 ----------

/** 和牌亮牌摆多久：满贯以上多摆一会儿 */
const WIN_MS = 2_600;
const WIN_BIG_MS = 3_400;

type WinEvent = Extract<RcEvent, { e: 'win' }>;

/** 和牌高光：谁、怎么和的、亮出的整手（和的那张描金）、役一条条弹出来、符番和点数。只用公开的：和了的人手牌本来就亮给所有人 */
function winCard(v: RcTable, e: WinEvent, name: string, how: string): HTMLElement {
  const sc = e.score;
  const s = v.seats[e.seat]!;
  const card = el('div', `hu-card rc-card${sc.limit !== 'none' ? ' big' : ''}${sc.yakuman ? ' huge' : ''}`);
  const head = el('div', 'head', card);
  el('span', 'who', head, name);
  el('span', 'how', head, how.replace('！', ''));
  const row = el('div', 'tiles', card);
  const face = (t: Tile, parent: HTMLElement): HTMLElement => {
    const x = el('div', 'tile md', parent);
    const red = isRed(t);
    x.style.backgroundImage = `url("${tileUrl(kindOf(t), red)}")`;
    x.title = tileName(kindOf(t), red);
    return x;
  };
  for (const m of s.melds) {
    const g = el('div', 'meld', row);
    for (const t of m.tiles) face(t, g);
  }
  const hand = el('div', 'meld', row);
  for (const t of (s.hand ?? []).filter((t) => t !== e.tile).sort(byTile)) face(t, hand);
  face(e.tile, row).classList.add('win');
  const items = el('div', 'items', card);
  const lines = yakuLines(sc);
  lines.forEach((l, i) => {
    const f = el('span', 'fan', items, `${l.name} ${l.han}`);
    f.style.animationDelay = `${0.3 + i * 0.16}s`;
  });
  const total = el('span', 'total', items, scoreHead(sc));
  total.style.animationDelay = `${0.3 + lines.length * 0.16 + 0.1}s`;
  return card;
}

// ---------- 对外 ----------

export const riichiUi: VariantUi<RcTable, RcAction> = {
  seatTags(v, seat) {
    const w = v.seats[seat]!.wind;
    const t = el('span', `tag rc-wind w${w}`, null, RC_WIND[w]);
    t.title = `自风：${RC_WIND[w]}`;
    return t;
  },

  multi: () => 0,
  dim: () => false,
  ting: tingOf,
  red: isRed,
  bar,

  discardable(v) {
    sync(v);
    const p = v.prompt;
    if (!p?.discard) return undefined;
    return riichiMode && p.riichi ? p.riichi : p.discard;
  },

  score: (v, seat) => num(v.seats[seat]!.points),

  stamp: (_v, seat) => (_v.seats[seat]!.won!.from === null ? '自摸' : '荣和'),

  badge(v, seat, b) {
    const r = v.seats[seat]!.riichi;
    if (r) el('i', `rc-stick${r === 2 ? ' double' : ''}`, b).title = r === 2 ? '双立直' : '立直';
  },

  river(v, seat, i, e) {
    if (v.seats[seat]!.riichiAt === i) e.classList.add('rc-riichi');
  },

  center,

  effects(v, fx, names) {
    const wins = v.events.filter((e): e is WinEvent => e.e === 'win');
    let shown = 0;
    for (const e of v.events) {
      switch (e.e) {
        case 'deal':
          fx.deal();
          play('deal');
          break;
        case 'draw':
          if (e.seat === v.me?.seat) play('draw');
          break;
        case 'discard':
          play('discard');
          // 落到毡面那一刻再补一声闷响（和牌桌的飞行动画对上）
          window.setTimeout(() => play('land'), landAt(e.seat === v.me?.seat));
          break;
        case 'riichi':
          fx.banner(e.seat, e.double ? '双立直！' : '立直！', 'riichi');
          play('pon');
          break;
        case 'chi':
        case 'pon':
          fx.banner(e.seat, e.e === 'chi' ? '吃！' : '碰！', 'pon');
          play('pon');
          break;
        case 'kan':
          fx.celebrate(e.seat, '杠！', 'kan');
          play('kan');
          break;
        case 'win': {
          const multi = wins.length > 1 && e.from !== null;
          const text = e.from === null ? '自摸！' : e.rob ? '抢杠！' : multi ? (wins.length === 2 ? '一炮双响！' : '一炮三响！') : '荣和！';
          fx.celebrate(e.seat, text, e.from === null ? 'zimo' : 'hu');
          play(e.from === null ? 'zimo' : 'hu');
          // 喊完再亮牌；一炮多响一个接一个亮
          const big = e.score.limit !== 'none';
          const ms = big ? WIN_BIG_MS : WIN_MS;
          fx.overlay(winCard(v, e, names[e.seat] ?? '', text), ms, 600 + shown * (WIN_MS + 200));
          if (big) window.setTimeout(() => play('big'), 900 + shown * (WIN_MS + 200));
          shown++;
          break;
        }
        case 'end':
          // 荒牌和中途流局：和了的那几种有自己的大字，其余在牌桌中间写一句
          if (e.end !== 'ron' && e.end !== 'tsumo') fx.banner(v.me?.seat ?? 0, END_NAME[e.end], 'draw');
          break;
        default:
          break;
      }
    }
  },
};
