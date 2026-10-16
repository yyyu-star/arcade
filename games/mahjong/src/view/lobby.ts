/**
 * 选桌页（docs/economy.md 第 1 节，各游戏一个样子）：先选玩法，再选"娱乐 / 实盘"，实盘选档位；规则设置折起来。
 * 钱包连不上时实盘不可选，娱乐照常。单独部署（没有平台）时只有娱乐，好友房上面多一个昵称框。
 */
import type { XzOpts } from '../core/variants/sichuan-xuezhan/index.ts';
import { STAKES, type StakesId } from '../game/stakes.ts';
import type { WalletView } from '../net/wallet.ts';
import { stakeIcon } from './art.ts';
import { busy, button, el } from './dom.ts';
import { GAME_NAME, num, STAKES_NAME, VARIANT_NAME } from './text.ts';

export interface LobbyProps {
  wallet: WalletView | null;
  /** 钱包连不上的原因（显示一句话） */
  walletNote: string | null;
  stakes: StakesId;
  opts: XzOpts;
  canResume: boolean;
  /** 开单机、开房间要先问钱包和服务器：按钮转圈直到回来 */
  onSolo(stakes: StakesId, opts: XzOpts): Promise<void>;
  onResume(): void;
  onRules(): void;
  /** 好友房：没有时不显示 */
  onRoom?(stakes: StakesId, opts: XzOpts): Promise<void>;
  onJoin?(code: string): void;
  /** 从平台大厅的"好友房"按钮进来（?online=1，和德州、掼蛋同一个约定）：开房、进房那一块滚到看得见、亮一下 */
  friends?: boolean;
  /** 单独部署：没有钱包和实盘；好友房里别人看到的昵称自己填 */
  standalone?: { nick: string; onNick(name: string): void };
}

export function renderLobby(box: HTMLElement, p: LobbyProps): void {
  box.replaceChildren();
  let stakes = p.stakes;
  const opts: XzOpts = { ...p.opts };
  const head = el('div', 'lobby-head', box);
  el('h1', '', head, GAME_NAME);
  el('div', 'variant', head, VARIANT_NAME['sichuan-xuezhan']);
  el('div', 'ver', box, `v${__MAHJONG_VERSION__}`);
  if (p.canResume) button('act go big', box, '接着打上一场', p.onResume);

  const pick = el('div', 'stakes', box);
  const paint = (): void => {
    pick.replaceChildren();
    for (const s of p.standalone ? STAKES.filter((x) => !x.wallet) : STAKES) {
      const off = s.wallet && (!p.wallet || p.wallet.balance <= 0);
      const b = button(`stake${s.id === stakes ? ' on' : ''}${off ? ' off' : ''}`, pick, '', () => {
        if (off) return;
        stakes = s.id;
        paint();
      });
      b.insertAdjacentHTML('afterbegin', stakeIcon(s.id));
      el('b', '', b, s.wallet ? `${STAKES_NAME[s.id]}档` : '娱乐');
      el('small', '', b, s.wallet ? `带 ${num(s.share)}` : '不算筹码');
    }
  };
  paint();
  const note = el('div', 'wallet-note', box);
  if (p.wallet) note.textContent = `钱包 ${num(p.wallet.balance)} 筹码（无任何现金价值）。实盘最多输掉带进去的，一场最多赢 3 份。`;
  else if (p.walletNote) note.textContent = p.walletNote;
  else if (p.standalone) note.textContent = '这是单独部署的雀馆：没有账号和钱包，单机、好友房都按娱乐打。';

  const more = el('details', 'rules-opts', box);
  el('summary', '', more, '规则设置');
  const row = (label: string, choices: [string, () => boolean, () => void][]): void => {
    const r = el('div', 'opt', more);
    el('span', 'label', r, label);
    for (const [text, on, set] of choices) {
      const b = button(`chip${on() ? ' on' : ''}`, r, text, () => {
        set();
        for (const x of r.querySelectorAll('.chip')) x.classList.remove('on');
        b.classList.add('on');
      });
    }
  };
  row('局数', [4, 8, 16].map((n) => [`${n} 局`, () => opts.rounds === n, () => (opts.rounds = n as 4 | 8 | 16)]));
  row('封顶', [3, 4, 5].map((n) => [`${n} 番`, () => opts.cap === n, () => (opts.cap = n as 3 | 4 | 5)]));
  row('换三张', [
    ['换', () => opts.swap, () => (opts.swap = true)],
    ['不换', () => !opts.swap, () => (opts.swap = false)],
  ]);
  row('自摸', [
    ['加底', () => opts.zimo === 'di', () => (opts.zimo = 'di')],
    ['加番', () => opts.zimo === 'fan', () => (opts.zimo = 'fan')],
  ]);
  row('呼叫转移', [
    ['开', () => opts.transfer, () => (opts.transfer = true)],
    ['关', () => !opts.transfer, () => (opts.transfer = false)],
  ]);

  const go = el('div', 'go-row', box);
  const solo = button('act go big', go, '单机开打', () => void busy(solo, () => p.onSolo(stakes, opts)));
  const room = p.onRoom ? button('act big', go, '开房间叫朋友', () => void busy(room!, () => p.onRoom!(stakes, opts))) : null;
  if (p.standalone) {
    const row = el('label', 'nick', box);
    el('span', '', row, '好友房里的昵称');
    const input = el('input', '', row) as HTMLInputElement;
    input.maxLength = 12;
    input.placeholder = '不填就叫"游客"';
    input.value = p.standalone.nick;
    input.addEventListener('change', () => p.standalone!.onNick(input.value.trim()));
  }
  if (p.onJoin) {
    const join = el('form', 'join', box);
    const input = el('input', '', join) as HTMLInputElement;
    input.inputMode = 'numeric';
    input.maxLength = 6;
    input.placeholder = '房间号';
    button('act', join, '进房', () => p.onJoin!(input.value.trim()));
    join.addEventListener('submit', (e) => {
      e.preventDefault();
      p.onJoin!(input.value.trim());
    });
    if (p.friends) {
      join.scrollIntoView({ block: 'nearest' });
      for (const x of [room, join]) x?.classList.add('spot');
      // 有鼠标的直接把光标放进房间号；触屏不放，免得一进来就弹键盘盖住半屏
      if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
    }
  }
  button('link', box, '规则和番型表', p.onRules);
}
