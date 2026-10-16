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
      <div className="console__grid">
        <Panel icon="shield" title="近 7 天">
          <TrendChart days={[...days].reverse()} />
        </Panel>
        <Panel icon="coin" title="今天各游戏">
          {games(today).length > 0 ? (
            <ul className="game-today">
              {games(today).map(([g, x]) => (
                <li key={g}>
                  <strong>{gameName(g)}</strong>
                  <span>{dash(x.players)} 人</span>
                  <span>
                    带入 <b className="tnum">{num(x.in)}</b> · 结回 <b className="tnum">{num(x.out)}</b>
                    {x.capped ? ` · 到顶没进 ${num(x.capped)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">今天还没人带筹码玩。</p>
          )}
          <div className="admin-entry">
            <AdminChipsButton className="btn btn--primary" />
            <span className="note">给人加减筹码（正数加、负数扣），有记录。</span>
          </div>
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

/**
 * 近 7 天的带入、结回（并排的柱）和玩过筹码局的人数（折线）：手写 SVG，不加图表库。
 * 柱和线各用自己的刻度（筹码和人数差几个数量级），右上角写各自的最大值。
 */
function TrendChart({ days }: { days: WalletDayStats[] }) {
  const W = 560;
  const H = 180;
  const pad = { l: 8, r: 8, t: 24, b: 28 };
  const ins = days.map((d) => sum(d, 'in'));
  const outs = days.map((d) => sum(d, 'out'));
  const people = days.map((d) => d.active ?? 0);
  const maxChips = Math.max(1, ...ins, ...outs);
  const maxPeople = Math.max(1, ...people);
  const slot = (W - pad.l - pad.r) / days.length;
  const bw = Math.min(18, slot / 3);
  const y = (v: number, max: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const cx = (i: number) => pad.l + slot * i + slot / 2;
  const line = people.map((p, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)} ${y(p, maxPeople).toFixed(1)}`).join('');
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`近 7 天带入、结回和玩过的人数，带入最多 ${num(maxChips)}，人数最多 ${maxPeople}`}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="chart__axis" />
        {days.map((d, i) => (
          <g key={d.day}>
            <rect x={cx(i) - bw - 1} y={y(ins[i]!, maxChips)} width={bw} height={H - pad.b - y(ins[i]!, maxChips)} rx="3" className="chart__in" />
            <rect x={cx(i) + 1} y={y(outs[i]!, maxChips)} width={bw} height={H - pad.b - y(outs[i]!, maxChips)} rx="3" className="chart__out" />
            <text x={cx(i)} y={H - 8} textAnchor="middle" className="chart__label">
              {i === days.length - 1 ? '今天' : d.day.slice(5)}
            </text>
          </g>
        ))}
        <path d={line} className="chart__line" />
        {people.map((p, i) => (
          <circle key={i} cx={cx(i)} cy={y(p, maxPeople)} r="3.5" className="chart__dot" />
        ))}
      </svg>
      <figcaption className="chart__legend">
        <span className="chart__key chart__key--in">带入（最多 {num(maxChips)}）</span>
        <span className="chart__key chart__key--out">结回</span>
        <span className="chart__key chart__key--line">玩过的人（最多 {maxPeople}）</span>
      </figcaption>
    </figure>
  );
}
