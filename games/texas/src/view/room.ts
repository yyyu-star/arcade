/**
 * 好友房的等人页（开打前）和连接提示条。开打以后用的是牌桌（table.ts），这里只管"等大家坐好"那一屏。
 * 0.18.4（美术 v3 第 5 步）：座位画成桌边的椅子——中间一张这一间主题房的桌面，用到的座位从正下方顺时针沿桌边排开。
 */
import { stakesOf } from '../core/stakes.ts';
import type { OnlineState } from '../online.ts';
import { SEATS } from '../room/rules.ts';
import { START_STACK } from '../tour/rules.ts';
import { site, twoText } from '../site.ts';
import { el, setText, toggle } from './dom.ts';
import { ROOM_NAME } from './rooms.ts';
import { chips } from './text.ts';

export interface WaitHandlers {
  sit(seat: number): void;
  start(): void;
  invite(): void;
  leave(): void;
  retry(): void;
}

export class RoomPanel {
  readonly root: HTMLDivElement;
  private readonly code: HTMLDivElement;
  private readonly info: HTMLDivElement;
  private readonly mark: HTMLDivElement;
  private readonly seats: { box: HTMLDivElement; name: HTMLSpanElement; sit: HTMLButtonElement }[] = [];
  private readonly startBtn: HTMLButtonElement;
  private readonly waitNote: HTMLDivElement;
  /** 坐下的真人不到两个（0.4.0）：开打灰掉，说一句为什么 */
  private readonly twoNote: HTMLDivElement;
  /** 快速匹配桌（0.20.0）：没有房间码、叫不了人、不用选座、不用点开打，只说一句在等谁 */
  private readonly matchNote: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly bannerText: HTMLSpanElement;
  private readonly retryBtn: HTMLButtonElement;

  constructor(stage: HTMLElement, h: WaitHandlers) {
    this.root = el('div', 'room-wait', stage);
    const head = el('div', 'rw-head', this.root);
    el('span', 'rw-label', head, '房间码');
    this.code = el('div', 'rw-code', head);
    // 叫朋友来（0.3.0）：手机上弹系统分享，别的复制链接
    button(head, 'pill go rw-invite', '叫朋友来', () => h.invite());
    this.info = el('div', 'rw-info', this.root);
    const grid = el('div', 'rw-seats', this.root);
    el('div', 'rw-felt', grid);
    this.mark = el('div', 'rw-mark', grid);
    for (let i = 0; i < SEATS; i++) {
      const box = el('div', 'rw-seat', grid);
      el('span', 'rw-no', box, `${i + 1} 号`);
      const name = el('span', 'rw-name', box);
      const sit = button(box, 'pill rw-sit', '坐这里', () => h.sit(i));
      this.seats.push({ box, name, sit });
    }
    this.twoNote = el('div', 'rw-two hidden', this.root);
    this.matchNote = el('div', 'rw-match hidden', this.root, '排到了！人到齐就开打，没来的座位电脑替他打');
    const go = el('div', 'rw-go', this.root);
    button(go, 'pill', '离开房间', () => h.leave());
    this.startBtn = button(go, 'start', '开打', () => h.start());
    this.waitNote = el('div', 'rw-wait', go, '等房主开打');

    this.banner = el('div', 'room-banner hidden', stage);
    this.bannerText = el('span', '', this.banner);
    this.retryBtn = button(this.banner, 'pill', '重试', () => h.retry());
  }

  draw(s: OnlineState | null): void {
    const waiting = !!s && s.room?.status === 'waiting';
    toggle(this.root, 'hidden', !waiting);
    // 连接提示：重连中、连不上
    const conn = s?.status === 'reconnecting' ? '网络断了，正在重连…' : s?.status === 'failed' ? '连不上房间' : s?.status === 'connecting' ? '正在进房间…' : '';
    setText(this.bannerText, conn);
    toggle(this.banner, 'hidden', conn === '');
    toggle(this.retryBtn, 'hidden', s?.status !== 'failed');
    if (!s || !waiting) return;

    const match = s.room?.match === true;
    toggle(this.root, 'match', match);
    toggle(this.matchNote, 'hidden', !match);
    setText(this.code, match ? '' : `${s.code.slice(0, 3)} ${s.code.slice(3)}`);
    // 档位和人数开房时就定了（房间发来的），进房的人一眼知道要带多少
    const o = s.opts;
    const st = o ? stakesOf(o.stakes) : null;
    const tour = o?.tour === true;
    setText(
      this.info,
      o && st && tour
        ? `锦标赛 · ${o.fun ? '娱乐' : st.name} · 6 人 · 每人 ${chips(START_STACK)} 比赛筹码，打到剩一人。` +
            (o.fun || site.standalone ? '筹码不算数' : `开赛时每个坐下的人交一份报名费 ${chips(st.max)}，奖池只在真人之间按名次分，结回钱包`) +
            (o.fill ? '；空位开赛时由电脑补' : '；空位不补，按坐下的人数开赛') +
            '。坐满 6 人或房主点开始就开赛，开赛后不能再坐下'
        : o && st
        ? `${st.name} · 盲注 ${chips(st.sb)}/${chips(st.bb)} · ${o.size} 人。` +
            (site.standalone || o.fun ? `开打时每个坐下的人带 ${chips(st.max)} 上桌（筹码不算数）；空位由电脑补` : `开打时每个坐下的人从钱包带 ${chips(st.max)} 上桌，离桌或房间关掉时结回去；空位由电脑补`)
        : '',
    );
    const size = o?.size ?? SEATS;
    setText(this.mark, o ? ROOM_NAME[o.stakes] : '');
    setText(this.startBtn, tour ? '开赛' : '开打');
    const mine = s.you?.seat ?? null;
    this.seats.forEach((x, i) => {
      // 椅子沿桌边：1 号在正下方，往左手边（顺时针）一圈；按百分比摆，横屏竖屏都跟着容器的椭圆走
      const a = Math.PI / 2 + (2 * Math.PI * i) / size;
      x.box.style.left = `${50 + 41 * Math.cos(a)}%`;
      x.box.style.top = `${50 + 40 * Math.sin(a)}%`;
      const info = s.room!.seats[i]!;
      const used = i < size;
      toggle(x.box, 'hidden', !used && info.kind === 'empty');
      toggle(x.box, 'me', i === mine);
      toggle(x.box, 'taken', info.kind !== 'empty');
      setText(x.name, info.kind === 'empty' ? '空位' : (info.name ?? '玩家'));
      toggle(x.sit, 'hidden', match || info.kind !== 'empty' || !used);
    });
    // 匹配桌由房间自己开打（人齐或等满 20 秒），点了也只回 not_host
    if (match) {
      for (const e of [this.twoNote, this.startBtn, this.waitNote]) toggle(e, 'hidden', true);
      return;
    }
    // 坐着的人都给"开打"（0.3.5）：房间不下发谁是房主，房主换了设备、页面被顶掉后本机不知道自己是房主，按钮一藏房间就只能干等；
    // 不是房主的点了由 kit 回 not_host，提示一句。没坐下的看"等房主开打"
    const canStart = s.host || mine !== null;
    // 实盘好友房至少两个真人（0.4.0）：房间那边一个人开打也不发牌，按钮先灰掉，免得点了干坐着
    const humans = s.room!.seats.filter((x, i) => i < size && x.kind === 'human').length;
    setText(this.twoNote, tour ? '锦标赛至少要两个人才开赛' : twoText());
    toggle(this.twoNote, 'hidden', humans >= 2);
    toggle(this.startBtn, 'hidden', !canStart);
    // 锦标赛不管实盘还是娱乐都至少两个真人（电脑补的不算）
    this.startBtn.disabled = mine === null || s.status !== 'open' || humans < 2;
    toggle(this.waitNote, 'hidden', canStart);
  }
}

function button(parent: HTMLElement, cls: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, parent, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
