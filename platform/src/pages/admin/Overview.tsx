/** 管理页：今日概况和近 7 天趋势。 */
import { useEffect, useState } from 'react';
import { type AdminOverview, api, errorText, type WalletDayStats } from '../../api.ts';
import { FormError, Panel } from '../../ui.tsx';
import { WALLET_GAMES } from '../../games.ts';
import { chips, gameName } from './common.ts';

/** 今日概况（0.10.7）：今天现算，加前 6 天的趋势。0.10.7 以前的记录没有人数，写"—"。 */
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
  const games = (d: WalletDayStats) => Object.entries(d.games);
  const sum = (d: WalletDayStats, k: 'in' | 'out') => games(d).reduce((t, [, g]) => t + g[k], 0);
  const dash = (n: number | undefined) => (n === undefined ? '—' : chips(n));
  return (
    <Panel title="今日概况">
      {error && <FormError text={error} />}
      {!data && !error && <p className="note">正在读取…</p>}
      {data && (
        <>
          <dl className="overview" data-testid="overview">
            <div>
              <dt>来过</dt>
              <dd>{chips(data.today.visitors)}</dd>
            </div>
            <div>
              <dt>玩过筹码局</dt>
              <dd>{dash(data.today.active)}</dd>
            </div>
            <div>
              <dt>领补给</dt>
              <dd>{dash(data.today.reliefCount)} 人</dd>
            </div>
            <div>
              <dt>新号送的</dt>
              <dd>{chips(data.today.grant)}</dd>
            </div>
            <div>
              <dt>管理员调整</dt>
              <dd>{chips(data.today.admin ?? 0)}</dd>
            </div>
          </dl>
          {games(data.today).length > 0 ? (
            <ul className="overview__games">
              {games(data.today).map(([g, x]) => (
                <li key={g}>
                  <strong>{gameName(g)}</strong> {dash(x.players)} 人 · 带入 {chips(x.in)} · 结回 {chips(x.out)}
                  {x.capped ? ` · 到顶没进 ${chips(x.capped)}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">今天还没人带筹码玩。</p>
          )}
          <table className="stats-table" data-testid="trend">
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
              {[data.today, ...data.days].map((d, i) => (
                <tr key={d.day}>
                  <td>{i === 0 ? '今天' : d.day.slice(5)}</td>
                  <td>{dash(d.active)}</td>
                  {WALLET_GAMES.map(({ id }) => (
                    <td key={id}>{d.games[id] ? dash(d.games[id]!.players) : 0}</td>
                  ))}
                  <td>{chips(sum(d, 'in'))}</td>
                  <td>{chips(sum(d, 'out'))}</td>
                  <td>{chips(d.relief)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Panel>
  );
}
