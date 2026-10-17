/**
 * 游戏主页（docs/art-v3.md 第 4 节，0.17.0）：进来先看到茶馆的主视觉和一句玩法，一个最大的"快速开始"（有没打完的单机就是"继续上局"），
 * 三张模式卡（娱乐 / 实盘 / 好友房）点进去才是选档，再加一张我的战绩小卡。以前一进来就是七张档位卡，像设置页。
 */
import { homeScene, stakeIcon } from './art.ts';
import { busy, button, el } from './dom.ts';
import { GAME_NAME, VARIANT_NAME } from './text.ts';

export type HomeMode = 'fun' | 'real' | 'room';

export interface HomeProps {
  /** 快速开始按什么开（"娱乐·新手"之类，按上次选的） */
  quick: string;
  /** 有没打完的单机：按钮换成"继续上局"，底下一行写是哪一场、打到第几局 */
  resume: string | null;
  /** 实盘卡灰掉的原因（钱包连不上、没筹码）；null 是能选。单独部署没有实盘卡 */
  realOff: string | null;
  standalone: boolean;
  /** 单机的战绩（本地记的）：没打过时是 null */
  record: { played: number; won: number; lost: number } | null;
  onQuick(): Promise<void>;
  onResume(): void;
  onMode(m: HomeMode): void;
  onRules(): void;
}

export function renderHome(box: HTMLElement, p: HomeProps): void {
  box.replaceChildren();
  const art = el('div', 'home-art', box);
  art.innerHTML = homeScene();
  const main = el('div', 'home-main', box);
  const head = el('div', 'home-head', main);
  el('h1', 'brand', head, GAME_NAME);
  el('div', 'variant', head, VARIANT_NAME['sichuan-xuezhan']);
  el('p', 'pitch', main, '胡了不下桌，一直打到只剩一家');

  const go = p.resume
    ? button('act go big quick', main, '继续上局', p.onResume)
    : button('act go big quick', main, '快速开始', () => void busy(go, p.onQuick));
  el('small', '', go, p.resume ?? p.quick);

  const modes = el('div', 'modes', main);
  const card = (id: HomeMode, icon: 'fun' | 'lux' | 'room', name: string, line: string, off: string | null): void => {
    const b = button(`mode ${id}${off ? ' off' : ''}`, modes, '', () => (off ? undefined : p.onMode(id)));
    b.insertAdjacentHTML('afterbegin', stakeIcon(icon));
    el('b', '', b, name);
    el('small', '', b, off ?? line);
  };
  card('fun', 'fun', '娱乐', '不算筹码', null);
  if (!p.standalone) card('real', 'lux', '实盘', '用钱包筹码', p.realOff);
  card('room', 'room', '好友房', '叫朋友一起', null);

  const rec = el('div', 'record', main);
  if (p.record) {
    const r = p.record;
    el('span', '', rec, `打了 ${r.played} 场`);
    el('span', '', rec, `赢 ${r.won} 场`);
    if (r.lost >= 2) el('span', 'down', rec, `连输 ${r.lost}`);
  } else el('span', '', rec, '还没打过：先来一场新手练练手');
  button('link', main, '规则和番型表', p.onRules);
  el('div', 'ver', box, `v${__MAHJONG_VERSION__}`);
}
