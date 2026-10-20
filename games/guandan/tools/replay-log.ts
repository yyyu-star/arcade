/**
 * 试玩日志复盘：从试玩脚本记下的 log.jsonl（每副结束时的 dealEnd 带完整状态）还原每一手前的局面，
 * 用当前的电脑和提示重新决策，和日志里实际发生的对比。调电脑、调提示时用来确认"那一手"现在会怎么出。
 *
 *   node tools/replay-log.ts <log.jsonl>                    全部副，只列电脑（普通）出法有变化的手、以及提示首条是炸弹的手
 *   node tools/replay-log.ts <log.jsonl> --deal 2 --all     第 2 副逐手列出
 *   node tools/replay-log.ts <log.jsonl> --deal 2 --at 27   第 2 副第 27 手（1 起，含"不要"）四家手牌和决策，--json 输出局面
 */
import { readFileSync } from 'node:fs';
import { cardName, dispatch, isBomb, viewFor, type Card, type GameState, type PlayRecord } from '../src/variants/guandan/core/index.ts';
import { decide, hintList } from '../src/variants/guandan/ai/index.ts';
import { soloSeeds } from '../src/view/session.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const file = process.argv[2];
if (!file) throw new Error('用法：node tools/replay-log.ts <log.jsonl> [--deal N] [--at K] [--all] [--json]');
const onlyDeal = arg('deal') ? Number(arg('deal')) : null;
const at = arg('at') ? Number(arg('at')) : null;
const all = process.argv.includes('--all');
const asJson = process.argv.includes('--json');
const NAME = ['我', '老张', '小美', '阿强'];
const nm = (cs: readonly Card[]) => cs.map(cardName).join(' ');
const rec = (r: PlayRecord | null) => (r?.play ? nm(r.play.cards) : '不要');
/** 同点同花色的牌（两副牌里有两张）不算不同：按牌名排序后比较 */
const same = (a: string, b: string) => a.split(' ').sort().join(' ') === b.split(' ').sort().join(' ');

interface DealEnd {
  k: 'dealEnd';
  deal: number;
  state: GameState;
}
const ends = readFileSync(file, 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as { k: string })
  .filter((x): x is DealEnd => x.k === 'dealEnd');

/** 出牌开始时的局面：最后的手牌加回本副出过的牌，进贡已完成。 */
function dealStart(end: GameState): GameState {
  const hands = end.hands.map((h) => [...h]);
  for (const e of end.history) if (e.play) hands[e.seat]!.push(...e.play.cards);
  const first = end.history[0]!.seat;
  return {
    ...end,
    phase: 'play',
    hands,
    turn: first,
    trick: { leader: first, last: null, passed: [false, false, false, false] },
    finished: [],
    history: [],
    lastDeal: null,
    winner: -1,
    // 电脑的随机流按步数分流：还原成当时的步数，没改策略时决定应和日志一致
    step: end.step - end.history.length,
  } as GameState;
}

for (const d of ends) {
  if (onlyDeal !== null && d.deal !== onlyDeal) continue;
  const H = d.state.history;
  let s = dealStart(d.state);
  console.log(`\n=== 第 ${d.deal} 副 级牌点数 ${d.state.level}，共 ${H.length} 手`);
  for (let i = 0; i < H.length; i++) {
    const e = H[i]!;
    const v = viewFor(s, e.seat);
    const n = i + 1;
    const table = v.trick.last ? `${NAME[v.trick.last.seat]} ${nm(v.trick.last.play.cards)}` : '领出';
    if (at === n) {
      for (let k = 0; k < 4; k++) console.log(`  ${NAME[k]}(${s.hands[k]!.length}) ${nm([...s.hands[k]!].sort((a, b) => (a % 54) - (b % 54)))}`);
      if (asJson) console.log(JSON.stringify({ seat: e.seat, state: s }));
    }
    let line = '';
    if (e.seat === 0) {
      // 和游戏里一样，电脑、提示拿的是按用途派生的数，不是牌局种子（session.ts 的 soloSeeds）
      const list = hintList(v, soloSeeds(s.seed).hint);
      const first = list[0];
      const bombHint = first != null && isBomb(first);
      const shown = first === undefined ? '要不起' : first === null ? '建议不要' : nm(first.cards);
      if (all || at === n || bombHint) line = `提示首条 ${shown}${bombHint ? ' 【提示炸弹】' : ''}｜实际 ${rec(e)}`;
    } else {
      const act = decide(v, { seed: soloSeeds(s.seed).ai, difficulty: 'normal' });
      const now = act?.type === 'play' ? nm(act.cards) : '不要';
      const changed = !same(now, rec(e));
      if (all || at === n || changed) line = `现在 ${now}｜当时 ${rec(e)}${changed ? ' *' : ''}`;
    }
    if (line) console.log(`#${n} ${NAME[e.seat]}(${s.hands[e.seat]!.length}) 桌上 ${table}：${line}`);
    // 日志里的实际动作推进局面（电脑出法变了也照实际走，后面的局面才对得上）
    const r = dispatch(s, e.play ? { type: 'play', seat: e.seat, cards: e.play.cards, as: { type: e.play.type, rank: e.play.rank, extra: e.play.extra } } : { type: 'pass', seat: e.seat });
    if (r.error) throw new Error(`第 ${d.deal} 副第 ${n} 手还原失败：${r.error}`);
    s = r.state;
  }
}
