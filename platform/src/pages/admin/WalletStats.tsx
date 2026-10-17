/** 管理页：全站筹码统计（近 30 天，每天一行）。 */
import { useEffect, useState } from 'react';
import { api, errorText, type WalletDayStats } from '../../api.ts';
import { FormError, Panel, Skeleton } from '../../ui.tsx';
import { num, gameName } from './common.ts';

/**
 * 全站筹码统计（docs/economy.md 第 6 节）：Cron 每天凌晨记一次前一天的。"庄家"是带入 − 结回 − 退回：
 * 正数是玩家输给电脑的（筹码的去处），负数是赢电脑的（来源）。总量涨太快就调数值。
 */
export function WalletStats() {
  const [days, setDays] = useState<WalletDayStats[] | null>(null);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let alive = true;
    api.admin.walletStats().then(
      (r) => alive && setDays(r.days),
      (e: unknown) => alive && setLoadError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, []);
  const sum = (d: WalletDayStats, k: 'in' | 'out' | 'back' | 'capped') => Object.values(d.games).reduce((a, g) => a + g[k], 0);
  return (
    <Panel icon="coin" title="筹码统计">
      {loadError && <FormError text={loadError} />}
      {!days && !loadError && <Skeleton rows={3} />}
      {days && days.length === 0 && <p className="note">还没有记录：每天凌晨 3 点多记一次前一天的。</p>}
      {days && days.length > 0 && (
        <table className="stats-table cards-on-phone" data-testid="wallet-stats">
          <thead>
            <tr>
              <th>日期</th>
              <th>总量</th>
              <th>钱包</th>
              <th>新号送</th>
              <th>补给</th>
              <th>管理员调整</th>
              <th>庄家</th>
              <th>到顶没进</th>
              <th className="cards-on-phone__wide">各游戏</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <td data-label="日期">{d.day.slice(5)}</td>
                <td data-label="总量">{num(d.total)}</td>
                <td data-label="钱包">{d.wallets}</td>
                <td data-label="新号送">{num(d.grant)}</td>
                <td data-label="补给">{num(d.relief)}</td>
                <td data-label="管理员调整">{num(d.admin ?? 0)}</td>
                <td data-label="庄家">{num(sum(d, 'in') - sum(d, 'out') - sum(d, 'back'))}</td>
                <td data-label="到顶没进">{num(sum(d, 'capped'))}</td>
                <td data-label="各游戏" className="cards-on-phone__wide">
                  {Object.keys(d.games).length > 0 ? (
                    <ul className="per-game">
                      {Object.entries(d.games).map(([g, x]) => (
                        <li key={g}>
                          <b>{gameName(g)}</b>{' '}
                          <span>
                            <span>带入 {num(x.in)}</span> · <span>结回 {num(x.out)}</span> · <span>退回 {num(x.back)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
