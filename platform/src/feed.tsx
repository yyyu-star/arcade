/**
 * 好友动态（0.17.0，docs/platform-backend.md 15.17）：好友页顶上一栏（全部，能赞、扔道具），大厅一条小条（最新 3 条 + "看全部"，有新的带红点）。
 * 接口只给编号和数字，文字在这里拼：
 * - 实盘结回的：平台的模板"老王在掼蛋小档赢了 1.6 份，称号：双下王"，称号名读游戏的 titles.json（读不到写"神秘称号"）；
 * - 游戏报的名场面：模板在游戏的 /games/<id>/moments.json（{"<编号>": {"text": "…"}}），只认 {name} {n} {n2} {n3} 四个占位符，
 *   别的花括号、超过 40 字、缺数字的模板一律当不合格，那条不显示。拼出来的是纯文本，React 按文字渲染，不当 HTML。
 * "看过"记在本机 localStorage 的 arcade.feedSeen（最新看过的那条的时间）：大厅红点只是提醒，换设备不同步没关系。
 */
import { useEffect, useState } from 'react';
import { api, type FeedItem } from './api.ts';
import { gameName, num } from './format.ts';
import { loadGameFile } from './gamefile.ts';
import { Link } from './router.tsx';
import { loadTitles } from './titles.ts';

const TIERS: Record<string, string> = { small: '小档', mid: '中档', big: '大档', lux: '豪华档' };
/** 赞和 table-fun 的道具，按钮上的字 */
export const REACTIONS: readonly (readonly [string, string])[] = [
  ['like', '赞'],
  ['rose', '玫瑰'],
  ['cheers', '干杯'],
  ['tomato', '番茄'],
  ['egg', '鸡蛋'],
  ['stinkyEgg', '臭鸡蛋'],
  ['slipper', '拖鞋'],
  ['bomb', '炸弹'],
];
const REACTION_NAME = new Map(REACTIONS);
const SEEN_KEY = 'arcade.feedSeen';
const TEMPLATE_RE = /^(?:[^{}]|\{(?:name|n|n2|n3)\})*$/;

/** 游戏的名场面模板：合格的才留 */
async function loadMoments(game: string): Promise<Record<string, string>> {
  const raw = (await loadGameFile(game, 'moments.json')) ?? {};
  const out: Record<string, string> = {};
  for (const [id, v] of Object.entries(raw)) {
    const text = (v as { text?: unknown } | null)?.text;
    if (typeof text === 'string' && text && [...text].length <= 40 && TEMPLATE_RE.test(text)) out[id] = text;
  }
  return out;
}

/** 一条拼成的字；不合格（模板没有、缺数字）回 null，那条不显示 */
function textOf(item: FeedItem, moments: Record<string, string>, titles: Record<string, { name: string }>): string | null {
  const who = item.user.displayName;
  const game = gameName(item.game);
  if (item.kind === 'settle') {
    const { tier = '', units = 0, titles: got = [] } = item.data;
    const names = got.map((t) => titles[t]?.name ?? '神秘称号');
    const where = `${game}${TIERS[tier] ?? ''}`;
    const win = units >= 5 ? `${who}在${where}赢了 ${(units / 10).toFixed(1).replace(/\.0$/, '')} 份` : `${who}在${where}`;
    if (!names.length) return win;
    return units >= 5 ? `${win}，称号：${names.join('、')}` : `${win}拿到称号：${names.join('、')}`;
  }
  const tpl = item.data.m ? moments[item.data.m] : undefined;
  if (!tpl) return null;
  const n = item.data.n ?? [];
  let missing = false;
  const text = tpl.replace(/\{(name|n|n2|n3)\}/g, (_, k: string) => {
    if (k === 'name') return who;
    const v = n[k === 'n' ? 0 : Number(k.slice(1)) - 1];
    if (v === undefined) missing = true;
    return v === undefined ? '' : num(v);
  });
  return missing ? null : text;
}

/** 读动态，顺带把要用的模板和称号名读齐；拼不出来的那条去掉 */
function useFeed(): { items: (FeedItem & { text: string })[] | null; reload: () => void } {
  const [items, setItems] = useState<(FeedItem & { text: string })[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { items: raw } = await api.feed();
      const games = [...new Set(raw.map((i) => i.game))];
      const [moments, titles] = await Promise.all([
        Promise.all(games.map((g) => loadMoments(g))),
        Promise.all(games.map((g) => loadTitles(g))),
      ]);
      const out = raw.flatMap((i) => {
        const k = games.indexOf(i.game);
        const text = textOf(i, moments[k]!, titles[k]!);
        return text ? [{ ...i, text }] : [];
      });
      if (alive) setItems(out);
    })().catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [tick]);
  return { items, reload: () => setTick((t) => t + 1) };
}

function ago(at: number): string {
  const m = Math.floor((Date.now() - at) / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} 小时前` : `${Math.floor(h / 24)} 天前`;
}

function summary(r: Record<string, number>): string {
  return REACTIONS.filter(([k]) => r[k]).map(([k, name]) => `${name} ${r[k]}`).join(' · ');
}

function Row({ item, me, onReacted }: { item: FeedItem & { text: string }; me: string; onReacted?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const send = async (kind: string) => {
    setBusy(true);
    setPicking(false);
    try {
      await api.react(item.id, kind);
      onReacted?.();
    } catch {
      // 过期了、对方删了好友：刷新一下列表就好，不另外提示
      onReacted?.();
    } finally {
      setBusy(false);
    }
  };
  const mine = item.user.userId === me;
  const counts = summary(item.reactions);
  return (
    <li className="feed__item" data-testid="feed-item">
      <span className="feed__text">{item.text}</span>
      <span className="feed__meta">
        {ago(item.at)}
        {counts && ` · ${counts}`}
      </span>
      {onReacted && !mine && (
        <span className="row feed__actions">
          {item.mine ? (
            <span className="note">你{item.mine === 'like' ? '赞了' : `扔了${REACTION_NAME.get(item.mine) ?? ''}`}</span>
          ) : (
            <>
              <button className="btn btn--small" type="button" disabled={busy} onClick={() => void send('like')}>
                赞
              </button>
              <button className="btn btn--small" type="button" disabled={busy} aria-expanded={picking} onClick={() => setPicking(!picking)}>
                扔个道具
              </button>
              {picking &&
                REACTIONS.filter(([k]) => k !== 'like').map(([k, name]) => (
                  <button key={k} className="btn btn--small" type="button" disabled={busy} onClick={() => void send(k)}>
                    {name}
                  </button>
                ))}
            </>
          )}
        </span>
      )}
    </li>
  );
}

/** 好友页顶上的一栏：全部，能赞、扔道具；打开就算看过 */
export function FeedPanel({ me }: { me: string }) {
  const { items, reload } = useFeed();
  useEffect(() => {
    if (items?.[0]) localStorage.setItem(SEEN_KEY, String(items[0].at));
  }, [items]);
  if (!items) return <p className="note">正在读取…</p>;
  if (!items.length) return <p className="note">最近 7 天你和好友还没有动态。实盘赢了、拿到新称号，或者在游戏里打出名场面，好友就能看到。</p>;
  return (
    <ul className="feed" data-testid="feed">
      {items.map((i) => (
        <Row key={i.id} item={i} me={me} onReacted={reload} />
      ))}
    </ul>
  );
}

/** 大厅的小条：最新 3 条 + "看全部"；有好友的新动态时带红点。没有动态就不占地方 */
export function FeedStrip({ me }: { me: string }) {
  const { items } = useFeed();
  if (!items?.length) return null;
  const seen = Number(localStorage.getItem(SEEN_KEY) ?? 0);
  const fresh = items.some((i) => i.at > seen && i.user.userId !== me);
  return (
    <section className="banner feed-strip" data-testid="feed-strip">
      <ul className="feed feed--compact">
        {items.slice(0, 3).map((i) => (
          <Row key={i.id} item={i} me={me} />
        ))}
      </ul>
      <Link className="inline-link" href="/friends">
        看全部
        {fresh && <span className="dot dot--inline" role="img" aria-label="有新动态" data-testid="feed-dot" />}
      </Link>
    </section>
  );
}
