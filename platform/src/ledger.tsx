/**
 * 钱包流水（0.10.7 起记，每人最近 30 笔）：管理页的用户详情、钱包页"最近进出"共用。
 * 0.11.0：按天分组（日期小标题滚动时吸顶），每行 时间 / 类型（彩色小标签加图标）/ 游戏 / 金额（加绿减红、右对齐）；
 * 先显示 PAGE 条，多的点"再看更多"。接口不给每笔之后的余额，所以没有余额这一列。
 */
import { useState } from 'react';
import type { LedgerEntry } from './api.ts';
import { gameName, num, signed, tone } from './format.ts';
import './ledger.css';

const PAGE = 10;

const KINDS: Record<LedgerEntry['t'], { text: string; icon: string }> = {
  grant: { text: '新号送的', icon: 'M12 8v13M4 8h16v4H4zM6 12h12v9H6zM12 8c-2-4-6-4-6-1s4 1 6 1c2 0 6 2 6-1s-4-3-6 1' },
  buyin: { text: '带入', icon: 'M12 4v12m0 0l-5-5m5 5l5-5M5 20h14' },
  settle: { text: '结回', icon: 'M12 20V8m0 0l-5 5m5-5l5 5M5 4h14' },
  refund: { text: '放弃退回', icon: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3' },
  expire: { text: '到期退回', icon: 'M12 7v5l3 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z' },
  relief: { text: '每日补给', icon: 'M12 5v14M5 12h14' },
  admin: { text: '管理员调整', icon: 'M12 3l7 3v5c0 4.4-3 8.4-7 10-4-1.6-7-5.6-7-10V6z' },
};

const clock = (ms: number) => new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const dayKey = (ms: number) => new Date(ms).toDateString();
function dayTitle(ms: number): string {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const d = new Date(ms);
  if (d.toDateString() === today.toDateString()) return '今天';
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
}

/** entries 新的在前 */
export function LedgerList({ entries }: { entries: LedgerEntry[] }) {
  const [shown, setShown] = useState(PAGE);
  const groups: { key: string; title: string; rows: LedgerEntry[] }[] = [];
  for (const e of entries.slice(0, shown)) {
    const key = dayKey(e.at);
    if (groups.at(-1)?.key !== key) groups.push({ key, title: dayTitle(e.at), rows: [] });
    groups.at(-1)!.rows.push(e);
  }
  return (
    <div className="ledger" data-testid="ledger">
      {groups.map((g) => (
        <section key={g.key} className="ledger__day">
          <h4 className="ledger__date">{g.title}</h4>
          <ul>
            {g.rows.map((e, i) => (
              <li key={`${e.at}-${i}`} className="ledger__row">
                <span className="ledger__time">{clock(e.at)}</span>
                <span className={`ledger__kind ledger__kind--${e.t}`}>
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
                    <path d={KINDS[e.t].icon} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {KINDS[e.t].text}
                </span>
                <span className="ledger__what">
                  {e.g ? gameName(e.g) : ''}
                  {e.capped ? <small>到顶没进 {num(e.capped)}</small> : null}
                </span>
                <span className={`ledger__amount ${tone(e.a) ?? ''}`}>{signed(e.a)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {entries.length > shown && (
        <button className="btn btn--small ledger__more" type="button" onClick={() => setShown(shown + PAGE)}>
          再看更多（还有 {entries.length - shown} 笔）
        </button>
      )}
    </div>
  );
}
