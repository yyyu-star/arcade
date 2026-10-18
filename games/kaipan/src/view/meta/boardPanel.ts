import Phaser from 'phaser';
import type { BoardResult, Scope } from '../../platform/board.ts';
import { loadBoard } from '../dailyBoard.ts';
import { boardScoreText } from '../labels.ts';
import { COLOR, SPACE, TYPE } from '../theme.ts';
import { Button } from '../ui/button.ts';
import { Dialog, phonePanel } from '../ui/dialog.ts';
import { addText, fitWidth } from '../ui/text.ts';
import { phoneLayout } from '../viewport.ts';

/** 电脑、手机横屏各一套：面板宽高、每页几行、行高、第一行的 y、"我"那一行和翻页键的 y */
interface Geo {
  w: number;
  h: number;
  per: number;
  rowH: number;
  top: number;
  meY: number;
  pagerY: number;
}
const DESK: Geo = { w: 600, h: 540, per: 10, rowH: 32, top: 84, meY: 418, pagerY: 540 - 66 };
/** 手机：宽按屏幕（最宽 620）、高跟 phonePanel（SE 392）；7 行 + 我 + 翻页键都在 70–376 内 */
const phoneGeo = (scene: Phaser.Scene): Geo => {
  const pp = phonePanel(scene);
  return { w: Math.min(620, pp.w), h: pp.h, per: 7, rowH: 30, top: 70, meY: 290, pagerY: pp.h - 56 };
};

/**
 * 每日挑战排行（0.5.10）：全站 / 好友两页，前 50 名（每页 10 行，手机 7 行），下面单独一行"我：第几名"。
 * 只显示昵称和成绩（平台不给用户名）；我在前 50 名里的那一行标亮。
 */
export class BoardPanel extends Dialog {
  private readonly G: Geo;
  private readonly boardId: string;
  private scope: Scope = 'all';
  private page = 0;
  private readonly cache = new Map<Scope, BoardResult>();
  private rows: Phaser.GameObjects.Container;
  private readonly tabs = new Map<Scope, Button>();
  private token = 0;

  constructor(scene: Phaser.Scene, date: string, boardId: string, onClosed?: () => void) {
    const ph = phoneLayout(scene);
    const G = ph ? phoneGeo(scene) : DESK;
    super(scene, G.w, G.h, `每日排行 · ${date}`, onClosed);
    this.G = G;
    this.boardId = boardId;
    (['all', 'friends'] as const).forEach((sc, i) => {
      const b = new Button(scene, G.w - 72 - (2 - i) * 96, ph ? 12 : 18, { width: 90, height: 38, label: sc === 'all' ? '全部' : '好友', fontSize: 15, sound: 'select' });
      b.setHandler(() => this.show(sc));
      this.inner.add(b);
      this.tabs.set(sc, b);
      this.named[`board:${sc}`] = b;
    });
    this.rows = scene.add.container(0, 0);
    this.inner.add(this.rows);
    this.show('all');
  }

  /** 自动化用：当前页显示的状态 */
  get view(): { scope: Scope; page: number; result: BoardResult | null } {
    return { scope: this.scope, page: this.page, result: this.cache.get(this.scope) ?? null };
  }

  private show(scope: Scope): void {
    if (this.isClosed) return;
    this.scope = scope;
    this.page = 0;
    for (const [k, b] of this.tabs) b.setSelected(k === scope);
    const hit = this.cache.get(scope);
    if (hit && hit.kind === 'ok') return this.draw();
    this.load();
  }

  private load(): void {
    const scope = this.scope;
    const token = ++this.token;
    this.cache.delete(scope);
    this.draw();
    void loadBoard(this.boardId, scope).then((r) => {
      if (this.isClosed || token !== this.token) return;
      this.cache.set(scope, r);
      this.draw();
    });
  }

  private draw(): void {
    const s = this.scene;
    const G = this.G;
    this.rows.destroy();
    this.rows = s.add.container(0, 0);
    this.inner.add(this.rows);
    for (const k of Object.keys(this.named)) if (k.startsWith('board:') && k !== 'board:all' && k !== 'board:friends') delete this.named[k];
    const r = this.cache.get(this.scope);
    const mid = G.top + (G.per * G.rowH) / 2;
    const say = (text: string): void => {
      this.rows.add(addText(s, G.w / 2, mid, text, { size: TYPE.title, color: COLOR.muted, originX: 0.5, originY: 0.5, wrap: G.w - 120, align: 'center' }));
    };
    if (!r) return say('正在读排行……');
    if (r.kind !== 'ok') {
      say(
        r.kind === 'out'
          ? '登录后才能看排行'
          : r.kind === 'busy'
            ? '服务器今天有点忙，排行先看不了，明早恢复'
            : r.kind === 'bug'
              ? '这个排行榜打不开'
              : '没连上，排行没读到',
      );
      if (r.kind === 'offline') {
        const retry = new Button(s, G.w / 2 - 60, mid + 34, { width: 120, height: 42, label: '重试', fontSize: 16 });
        retry.setHandler(() => this.load());
        this.rows.add(retry);
        this.named['board:retry'] = retry;
      }
      return;
    }
    const pages = Math.max(1, Math.ceil(r.entries.length / G.per));
    this.page = Math.max(0, Math.min(pages - 1, this.page));
    if (r.entries.length === 0) say(this.scope === 'friends' ? '好友里今天还没人交成绩' : '今天还没有人交成绩，来当第一个');
    r.entries.slice(this.page * G.per, (this.page + 1) * G.per).forEach((e, i) => {
      const y = G.top + i * G.rowH;
      if (e.isMe) this.rows.add(s.add.rectangle(28, y, G.w - 56, G.rowH - 2, COLOR.accent, 0.18).setOrigin(0, 0).setRounded(8));
      const cy = y + (G.rowH - 2) / 2;
      const medal = e.rank <= 3 ? [0xe8b33a, 0xa9b4c0, 0xc58a5a][e.rank - 1]! : null;
      if (medal !== null) this.rows.add(s.add.circle(66, cy, 13, medal));
      this.rows.add(addText(s, 66, cy, `${e.rank}`, { size: TYPE.label + 1, bold: true, num: true, color: medal !== null ? COLOR.paper : COLOR.ink, originX: 0.5, originY: 0.5 }));
      const score = addText(s, G.w - 44, cy, boardScoreText(e.score), { size: TYPE.label + 1, bold: true, num: true, color: COLOR.ink, originX: 1, originY: 0.5 });
      // 昵称最长能有十几个字：截到分数左边留一格，不压住分数
      const name = addText(s, 98, cy, e.displayName, { size: TYPE.label + 1, bold: e.isMe, color: COLOR.ink, originY: 0.5 });
      const room = score.x - score.width - SPACE.md - 98;
      if (e.isMe) {
        const tag = addText(s, 0, cy, '（我）', { size: TYPE.label + 1, bold: true, color: COLOR.ink, originY: 0.5 });
        fitWidth(name, room - tag.width);
        this.rows.add(tag.setX(98 + name.width));
      } else fitWidth(name, room);
      this.rows.add([name, score]);
    });
    // 我：不在这一页（或不在前 50）时单独一行；我和第 50 名同分但来得晚时，名次 ≤ 50 却不在列表里，也按这一行显示
    const listed = r.entries.some((e) => e.isMe);
    const me = r.me === null ? '我：今天还没交过成绩' : listed ? `我：第 ${r.me.rank ?? '—'} 名 · ${boardScoreText(r.me.score)}` : `我：${r.me.rank === null ? '1 万名以后' : `第 ${r.me.rank} 名`} · ${boardScoreText(r.me.score)}`;
    this.rows.add(s.add.rectangle(28, G.meY - 4, G.w - 56, 2, COLOR.edge, 0.6).setOrigin(0, 0));
    this.rows.add(addText(s, 44, G.meY + 18, me, { size: TYPE.label + 1, bold: true, color: COLOR.ink, originY: 0.5 }));
    if (pages > 1) {
      const prev = new Button(s, G.w - 44 - 84 * 2 - 60, G.pagerY, { width: 84, height: 40, label: '上一页', fontSize: 14, sound: 'select' });
      const label = addText(s, G.w - 44 - 84 - 30, G.pagerY + 20, `${this.page + 1}/${pages}`, { size: 14, bold: true, num: true, color: COLOR.muted, originX: 0.5, originY: 0.5 });
      const next = new Button(s, G.w - 44 - 84, G.pagerY, { width: 84, height: 40, label: '下一页', fontSize: 14, sound: 'select' });
      prev.setEnabled(this.page > 0).setHandler(() => this.turn(-1));
      next.setEnabled(this.page < pages - 1).setHandler(() => this.turn(1));
      this.rows.add([prev, label, next]);
      this.named['board:prev'] = prev;
      this.named['board:next'] = next;
    }
    this.rows.add(addText(s, 44, G.pagerY + 20, '只比当天，没有奖励', { size: 13, color: COLOR.dim, originY: 0.5 }));
  }

  private turn(d: number): void {
    this.page += d;
    this.draw();
  }
}
