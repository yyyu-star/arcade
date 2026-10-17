/**
 * 排行榜界面（DOM）：总榜（守夜 / 夜探 / 无尽）和今天的每日榜（守夜 / 夜探），全部 / 好友两个范围。
 * 别人的昵称都用 textContent 放进去，不拼 HTML。可点的 ≥ 44×44。
 * 主代理接进菜单：`const boards = new BoardsPanel(root, { deps, today: () => beijingDate(Date.now()), onClose })`，菜单上"排行"按钮调 `boards.show()`。
 */
import { readBoard, type BoardDeps, type BoardResult, type Scope } from '../api.ts';
import { dailyBoardId } from '../daily.ts';
import { formatScore, type BoardKind } from '../score.ts';
import './boards.css';

interface Tab {
  key: string;
  name: string;
  kind: BoardKind;
  boardId: (today: string) => string;
}

export const TABS: readonly Tab[] = [
  { key: 'vigil', name: '守夜', kind: 'vigil', boardId: () => 'vigil' },
  { key: 'raid', name: '夜探', kind: 'raid', boardId: () => 'raid' },
  { key: 'endless', name: '无尽', kind: 'endless', boardId: () => 'endless' },
  { key: 'dvigil', name: '每日守夜', kind: 'daily-vigil', boardId: (d) => dailyBoardId(d, 'vigil') },
  { key: 'draid', name: '每日夜探', kind: 'daily-raid', boardId: (d) => dailyBoardId(d, 'raid') },
];

export interface BoardsOptions {
  deps: BoardDeps;
  today(): string;
  onClose(): void;
}

const NOTE: Record<Exclude<BoardResult['kind'], 'ok'>, string> = {
  busy: '榜单忙，过一会儿再看',
  offline: '没连上，点一下标签重试',
  out: '登录后才能看排行',
  bug: '榜单出错了',
};

export class BoardsPanel {
  private readonly root: HTMLDivElement;
  private tab = 'vigil';
  private scope: Scope = 'all';
  /** 切得快时丢掉过期的回答 */
  private seq = 0;

  private readonly opts: BoardsOptions;

  constructor(parent: HTMLElement, opts: BoardsOptions) {
    this.opts = opts;
    this.root = document.createElement('div');
    this.root.className = 'yx-screen yx-boards-layer';
    this.root.style.display = 'none';
    parent.appendChild(this.root);
  }

  show(): void {
    this.root.style.display = '';
    this.render();
    void this.load();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.seq++;
  }

  private render(): void {
    const panel = document.createElement('div');
    panel.className = 'yx-panel yx-boards';
    const head = document.createElement('div');
    head.className = 'yx-panel-head';
    const title = document.createElement('b');
    title.className = 'yx-brush';
    title.textContent = '排行';
    const scopeBtn = document.createElement('button');
    scopeBtn.type = 'button';
    scopeBtn.className = 'yx-tab';
    scopeBtn.textContent = this.scope === 'all' ? '全部' : '好友';
    scopeBtn.onclick = () => {
      this.scope = this.scope === 'all' ? 'friends' : 'all';
      this.render();
      void this.load();
    };
    head.append(title, scopeBtn);
    const tabs = document.createElement('div');
    tabs.className = 'yx-tabs';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `yx-tab${t.key === this.tab ? ' on' : ''}`;
      b.textContent = t.name;
      b.onclick = () => {
        this.tab = t.key;
        this.render();
        void this.load();
      };
      tabs.appendChild(b);
    }
    const note = document.createElement('div');
    note.className = 'yx-bnote';
    note.textContent = '读榜中…';
    const list = document.createElement('ol');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'yx-big ghost';
    close.textContent = '返回';
    close.onclick = () => {
      this.hide();
      this.opts.onClose();
    };
    panel.append(head, tabs, note, list, close);
    this.root.replaceChildren(panel);
  }

  private async load(): Promise<void> {
    const my = ++this.seq;
    const t = TABS.find((x) => x.key === this.tab)!;
    const r = await readBoard(this.opts.deps, t.boardId(this.opts.today()), this.scope);
    if (my !== this.seq) return;
    const note = this.root.querySelector<HTMLElement>('.yx-bnote');
    const list = this.root.querySelector<HTMLElement>('ol');
    if (!note || !list) return;
    list.replaceChildren();
    if (r.kind !== 'ok') {
      note.textContent = NOTE[r.kind];
      return;
    }
    note.textContent = r.entries.length === 0 ? '还没有人上榜，你来第一个' : r.me ? `你：${r.me.rank === null ? '榜外' : `第 ${r.me.rank} 名`} · ${formatScore(t.kind, r.me.score)}` : '你还没上榜';
    for (const e of r.entries) {
      const li = document.createElement('li');
      if (e.isMe) li.className = 'me';
      const rank = document.createElement('b');
      rank.textContent = String(e.rank);
      const name = document.createElement('span');
      name.textContent = e.displayName;
      const score = document.createElement('em');
      score.textContent = formatScore(t.kind, e.score);
      li.append(rank, name, score);
      list.appendChild(li);
    }
  }
}
