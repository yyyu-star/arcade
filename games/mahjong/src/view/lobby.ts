/**
 * 选桌页（docs/economy.md 第 1 节，各游戏一个样子）：从主页的模式卡进来（0.17.2 起只摆这个模式的东西，docs/art-v3.md 第 4 节）——
 * 娱乐：三个难度 + 单机开打；实盘：四档 + 单机开打；好友房：娱乐三个难度和实盘四档都能选（房间按这个开）+ 开房间、输房间号进房。
 * 规则设置折起来；开打的按钮贴在底部。钱包连不上时实盘不可选。单独部署（没有平台）时只有娱乐，好友房上面多一个昵称框。
 */
import type { XzOpts } from '../core/variants/sichuan-xuezhan/index.ts';
import { LEVELS, type Level } from '../ai/venues.ts';
import { STAKES, type StakesId, type TierId } from '../game/stakes.ts';
import type { WalletView } from '../net/wallet.ts';
import { homeScene, stakeIcon } from './art.ts';
import { busy, button, el } from './dom.ts';
import { GAME_NAME, LEVEL_FOR, LEVEL_NAME, MINUTES_PER_ROUND, num, STAKES_NAME, STARS, VARIANT_NAME } from './text.ts';

export interface LobbyProps {
  wallet: WalletView | null;
  /** 钱包连不上的原因（显示一句话） */
  walletNote: string | null;
  stakes: StakesId;
  /** 娱乐的难度（第一次玩是新手） */
  level: Level;
  opts: XzOpts;
  canResume: boolean;
  /** 开单机、开房间要先问钱包和服务器：按钮转圈直到回来 */
  onSolo(stakes: StakesId, opts: XzOpts, level: Level): Promise<void>;
  onResume(): void;
  onRules(): void;
  /** 好友房：没有时不显示 */
  onRoom?(stakes: StakesId, opts: XzOpts): Promise<void>;
  onJoin?(code: string): void;
  /** 从平台大厅的"好友房"按钮进来（?online=1，和德州、掼蛋同一个约定）：开房、进房那一块滚到看得见、亮一下 */
  friends?: boolean;
  /** 单独部署：没有钱包和实盘；好友房里别人看到的昵称自己填 */
  standalone?: { nick: string; onNick(name: string): void };
  /** 回游戏主页（0.17.0 起选桌页是主页点模式卡进来的第二层） */
  onBack?(): void;
  /** 从哪张模式卡进来的（单独部署没有实盘） */
  mode: 'fun' | 'real' | 'room';
}

const MODE_TITLE = { fun: '娱乐', real: '实盘', room: '好友房' } as const;

export function renderLobby(box: HTMLElement, p: LobbyProps): void {
  box.replaceChildren();
  let stakes = p.stakes;
  let level = p.level;
  const opts: XzOpts = { ...p.opts };
  if (p.onBack) button('pill back', box, '‹ 主页', p.onBack);
  // 竖屏选档页上面那块空白放主页同一张茶馆的画（只占剩下的高度，规则设置展开后自己缩没）；横屏没空，CSS 藏掉
  el('div', 'lobby-art', box).innerHTML = homeScene();
  const head = el('div', 'lobby-head', box);
  el('h1', '', head, MODE_TITLE[p.mode]);
  el('div', 'variant', head, `${GAME_NAME} · ${VARIANT_NAME['sichuan-xuezhan']}`);
  el('div', 'ver', box, `v${__MAHJONG_VERSION__}`);
  if (p.canResume && p.mode !== 'room') button('act go big resume', box, '接着打上一场', p.onResume);

  // 每档一张卡（docs/balance.md 第 5 节，四个游戏一样）：电脑多强（星）、一场约多久、一场最多赢 / 最多输。娱乐三个难度一排，实盘四档一排
  const pick = el('div', 'stakes-box', box);
  const card = (row: HTMLElement, on: boolean, off: boolean, icon: StakesId, name: string, stars: number, lines: string[], choose: () => void): void => {
    const b = button(`stake${on ? ' on' : ''}${off ? ' off' : ''}`, row, '', () => {
      if (off) return;
      choose();
      paint();
    });
    b.insertAdjacentHTML('afterbegin', stakeIcon(icon));
    el('b', '', b, name);
    const star = el('span', 'stars', b, '★'.repeat(stars) + '☆'.repeat(4 - stars));
    star.setAttribute('aria-label', `电脑 ${stars} 星`);
    for (const l of lines) el('small', '', b, l);
  };
  const paint = (): void => {
    pick.replaceChildren();
    // 一场多久每张卡都一样，写在每排的小标题上，卡上不重复（0.17.2）
    const mins = `一场约 ${Math.round((MINUTES_PER_ROUND * opts.rounds) / 5) * 5} 分钟`;
    if (p.mode !== 'real') {
      el('div', 'stakes-label', pick, `娱乐 · 不算筹码 · ${mins}`);
      const fun = el('div', 'stakes', pick);
      for (const l of LEVELS) {
        card(fun, stakes === 'fun' && level === l, false, 'fun', LEVEL_NAME[l], STARS[l], [LEVEL_FOR[l]], () => {
          stakes = 'fun';
          level = l;
        });
      }
    }
    const tiers = p.standalone || p.mode === 'fun' ? [] : STAKES.filter((x) => x.wallet);
    if (!tiers.length) return;
    el('div', 'stakes-label', pick, `实盘 · 用钱包里的筹码 · ${mins}`);
    const real = el('div', 'stakes', pick);
    for (const s of tiers) {
      const off = !p.wallet || p.wallet.balance <= 0;
      card(real, s.id === stakes, off, s.id, `${STAKES_NAME[s.id]}档`, STARS[s.id as TierId], [`最多赢 ${num(s.share * 3)}`, `最多输 ${num(s.share)}`], () => (stakes = s.id));
    }
  };
  paint();
  const note = el('div', 'wallet-note', box);
  if (p.mode === 'fun') note.remove();
  else if (p.wallet) note.textContent = `钱包 ${num(p.wallet.balance)} 筹码（无任何现金价值）。实盘最多输掉带进去的，一场最多赢 3 份。`;
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
  // 局数改了，卡片上的"约多久"跟着变
  row('局数', [4, 8, 16].map((n) => [`${n} 局`, () => opts.rounds === n, () => ((opts.rounds = n as 4 | 8 | 16), paint())]));
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

  // 开打的按钮贴在底部（style.css 的 .go-row），档位、规则设置在上面怎么展开都看得见
  button('link', box, '规则和番型表', p.onRules);
  const go = el('div', 'go-row', box);
  if (p.mode !== 'room') {
    const solo = button('act go big', go, '单机开打', () => void busy(solo, () => p.onSolo(stakes, opts, level)));
    return;
  }
  const room = p.onRoom ? button('act go big', go, '开房间叫朋友', () => void busy(room!, () => p.onRoom!(stakes, opts))) : null;
  if (p.standalone) {
    const row = el('label', 'nick', go);
    el('span', '', row, '好友房里的昵称');
    const input = el('input', '', row) as HTMLInputElement;
    input.maxLength = 12;
    input.placeholder = '不填就叫"游客"';
    input.value = p.standalone.nick;
    input.addEventListener('change', () => p.standalone!.onNick(input.value.trim()));
  }
  if (p.onJoin) {
    const join = el('form', 'join', go);
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
}
