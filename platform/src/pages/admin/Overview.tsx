/** 管理页·概览：顶上一排数字卡片，下面近 7 天趋势图、各游戏今天的情况、"管理筹码"入口、趋势明细表。 */
import { useEffect, useState } from 'react';
import { type AdminOverview, api, errorText, type WalletDayStats } from '../../api.ts';
import { FormError, Panel } from '../../ui.tsx';
import { WALLET_GAMES } from '../../games.ts';
import { AdminChipsButton } from './AdminChips.tsx';
import { gameName, num } from './common.ts';

const games = (d: WalletDayStats) => Object.entries(d.games);
const sum = (d: WalletDayStats, k: 'in' | 'out') => games(d).reduce((t, [, g]) => t + g[k], 0);
/** 0.10.7 以前的记录没有人数，写"—" */
const dash = (n: number | undefined) => (n === undefined ? '—' : num(n));
/** 卡片里放不下七八位数：十万以上写成"万"，悬停看准数 */
const big = (n: number) =>
  Math.abs(n) >= 100_000 ? `${(n / 10_000).toLocaleString('zh-CN', { maximumFractionDigits: Math.abs(n) >= 10_000_000 ? 0 : 1 })} 万` : num(n);

/** 今天现算，加前 6 天的趋势（0.10.7） */
export function Overview() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api.admin.overview().then(
      (r) => alive && setData(r),
      (e: unknown) => alive && setError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, []);
  if (error) return <FormError text={error} />;
  if (!data) return <p className="note">正在读取…</p>;
  const { today } = data;
  const days = [today, ...data.days];
  const tiles: [string, string, number?][] = [
    ['今天来过', num(today.visitors)],
    ['玩过筹码局', dash(today.active)],
    ['领补给（人）', dash(today.reliefCount)],
    ['新号送的', big(today.grant), today.grant],
    ['管理员调整', big(today.admin ?? 0), today.admin ?? 0],
    ['筹码总量', big(today.total), today.total],
  ];
  return (
    <>
      <dl className="tiles" data-testid="overview">
        {tiles.map(([label, value, exact]) => (
          <div key={label} className="tile">
            <dt>{label}</dt>
            <dd title={exact === undefined ? undefined : num(exact)}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="console__grid console__grid--2">
        <Panel icon="shield" title="近 7 天">
          <TrendChart days={week(today, data.days)} />
        </Panel>
        <Panel icon="coin" title="今天各游戏" action={<AdminChipsButton className="btn btn--primary btn--small" title="给人加减筹码（正数加、负数扣），有记录" />}>
          {games(today).length > 0 ? (
            <ul className="game-today">
              {games(today).map(([g, x]) => (
                <li key={g}>
                  <strong>{gameName(g)}</strong>
                  <span className="tnum">{dash(x.players)} 人</span>
                  <span>
                    <span className="nowrap">
                      带入 <b className="tnum">{num(x.in)}</b>
                    </span>{' '}
                    · <span className="nowrap">
                      结回 <b className="tnum">{num(x.out)}</b>
                    </span>
                  </span>
                  {x.capped ? <small>到顶没进 {num(x.capped)}</small> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">今天还没人带筹码玩。</p>
          )}
        </Panel>
      </div>
      <Panel icon="shield" title="每天明细">
        <table className="stats-table cards-on-phone" data-testid="trend">
          <thead>
            <tr>
              <th>日期</th>
              <th>玩过</th>
              {WALLET_GAMES.map((g) => (
                <th key={g.id}>{g.name}</th>
              ))}
              <th>带入</th>
              <th>结回</th>
              <th>补给</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <tr key={d.day}>
                <td data-label="日期">{i === 0 ? '今天' : d.day.slice(5)}</td>
                <td data-label="玩过">{dash(d.active)}</td>
                {WALLET_GAMES.map(({ id, name }) => (
                  <td key={id} data-label={name}>
                    {d.games[id] ? dash(d.games[id]!.players) : 0}
                  </td>
                ))}
                <td data-label="带入">{num(sum(d, 'in'))}</td>
                <td data-label="结回">{num(sum(d, 'out'))}</td>
                <td data-label="补给">{num(d.relief)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

type Day = { day: string; in: number; out: number; people: number };

/** 固定 7 天（旧的在前、今天在最后）：没记录的天画 0，x 轴不跳天 */
function week(today: WalletDayStats, past: WalletDayStats[]): Day[] {
  const byDay = new Map([today, ...past].map((d) => [d.day, d]));
  const end = Date.parse(`${today.day}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(end - (6 - i) * 86_400_000).toISOString().slice(0, 10);
    const d = byDay.get(day);
    return { day, in: d ? sum(d, 'in') : 0, out: d ? sum(d, 'out') : 0, people: d?.active ?? 0 };
  });
}

/** 刻度取 1、2、2.5、5 乘 10 的幂，三格正好盖住最大值 */
function niceStep(max: number): number {
  const raw = Math.max(1, max) / 3;
  const p = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= raw) ?? 10) * p;
}

/**
 * 近 7 天的带入、结回（并排的柱，左边刻度）和玩过筹码局的人数（柱顶的小数字）：手写 SVG，不加图表库。
 * 悬停一天，整列高亮，上面浮一张当天的数字。
 */
function TrendChart({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // 画布按面板的实际宽度（电脑上约 400–600）定，字不会被缩得太小
  const W = 460;
  const H = 210;
  const pad = { l: 52, r: 6, t: 22, b: 26 };
  const step = niceStep(Math.max(...days.map((d) => Math.max(d.in, d.out))));
  const top = step * 3;
  const slot = (W - pad.l - pad.r) / days.length;
  const bw = Math.min(26, slot * 0.32);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const cx = (i: number) => pad.l + slot * i + slot / 2;
  const label = (d: Day, i: number) => (i === days.length - 1 ? '今天' : d.day.slice(5));
  const h = hover === null ? null : days[hover]!;
  return (
    <figure className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`近 7 天带入、结回和玩过的人数：${days.map((d, i) => `${label(d, i)} 带入 ${num(d.in)} 结回 ${num(d.out)} ${d.people} 人`).join('；')}`}>
        {[1, 2, 3].map((k) => (
          <g key={k}>
            <line x1={pad.l} x2={W - pad.r} y1={y(step * k)} y2={y(step * k)} className="chart__grid" />
            <text x={pad.l - 6} y={y(step * k) + 4} textAnchor="end" className="chart__label">
              {big(step * k)}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="chart__axis" />
        {days.map((d, i) => (
          <g key={d.day} className={hover === i ? 'chart__day chart__day--on' : 'chart__day'} onMouseEnter={() => setHover(i)}>
            <rect x={pad.l + slot * i} y={pad.t - 18} width={slot} height={H - pad.t - pad.b + 18} className="chart__hit" />
            <rect x={cx(i) - bw - 1} y={y(d.in)} width={bw} height={H - pad.b - y(d.in)} rx="3" className="chart__in" />
            <rect x={cx(i) + 1} y={y(d.out)} width={bw} height={H - pad.b - y(d.out)} rx="3" className="chart__out" />
            {d.people > 0 && (
              <text x={cx(i)} y={Math.min(y(d.in), y(d.out)) - 6} textAnchor="middle" className="chart__people">
                {d.people}人
              </text>
            )}
            <text x={cx(i)} y={H - 8} textAnchor="middle" className="chart__label">
              {label(d, i)}
            </text>
          </g>
        ))}
      </svg>
      {h && hover !== null && (
        <div className="chart__tip" style={{ left: `${(cx(hover) / W) * 100}%` }} role="status">
          <strong>{label(h, hover)}</strong>
          <span>带入 {num(h.in)}</span>
          <span>结回 {num(h.out)}</span>
          <span>玩过 {h.people} 人</span>
        </div>
      )}
      <figcaption className="chart__legend">
        <span className="chart__key chart__key--in">带入</span>
        <span className="chart__key chart__key--out">结回</span>
        <span className="chart__key chart__key--people">柱顶数字：玩过筹码局的人</span>
      </figcaption>
    </figure>
  );
}
