/** 钱包流水（0.10.7 起记，每人最近 30 笔）：管理页查人、钱包页"最近进出"共用。 */
import type { LedgerEntry } from './api.ts';
import { gameName, num, signed, timeText } from './format.ts';

const LEDGER_TEXT: Record<LedgerEntry['t'], string> = {
  grant: '新号送的',
  buyin: '带入',
  settle: '结回',
  refund: '放弃退回',
  expire: '到期退回',
  relief: '每日补给',
  admin: '管理员调整',
};


/** entries 新的在前 */
export function LedgerList({ entries }: { entries: LedgerEntry[] }) {
  return (
    <ul className="ledger" data-testid="ledger">
      {entries.map((e, i) => (
        <li key={`${e.at}-${i}`}>
          <span className="ledger__time">{timeText(e.at)}</span>
          <span>
            {LEDGER_TEXT[e.t]}
            {e.g ? ` · ${gameName(e.g)}` : ''}
            {e.capped ? `（到顶没进 ${num(e.capped)}）` : ''}
          </span>
          <span className={e.a > 0 ? 'up' : e.a < 0 ? 'down' : ''}>{signed(e.a)}</span>
        </li>
      ))}
    </ul>
  );
}
