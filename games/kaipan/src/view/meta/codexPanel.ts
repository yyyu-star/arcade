import Phaser from 'phaser';
import { REGIMES, REGIME_LABEL, codex, displayTitle, knowledgeView, type KnowledgeCard, type CodexEntry, type Regime } from '../../core/index.ts';
import type { Profile } from '../../platform/profile.ts';
import { achFrameKey, achIconKey, avatarKey, hasArt, itemKey, stockKey } from '../assets.ts';
import { CODEX_TABS, TIER_NAME } from '../labels.ts';
import { sound } from '../sound.ts';
import { COLOR, ITEM_KIND_COLOR, RARITY_COLOR, THEME_COLOR, RADIUS, TYPE, textOn } from '../theme.ts';
import { addGlyph, addImage, addPill, addSlice } from '../ui/art.ts';
import { Button } from '../ui/button.ts';
import { Dialog, phonePanel } from '../ui/dialog.ts';
import { StockGuy } from '../ui/stockGuy.ts';
import { addText, setColor } from '../ui/text.ts';
import { bindTooltip, type TipContent } from '../ui/tooltip.ts';
import { loadViewed, saveViewed, type CodexGroup, type Viewed } from './prefs.ts';
import { GLOSSARY, ROLE_WORD, term, type Term } from '../glossary.ts';
import { phoneLayout } from '../viewport.ts';

/** 图鉴的页签：五组收藏 + 词典 */
type CodexTab = CodexGroup | 'segments' | 'words' | 'knowledge';

const W = 1220;
const H = 690;
const GRID_X = 32;
const GRID_Y = 132;
const GRID_W = W - 64;
const REGIME_TINT: Record<Regime, number> = { bull: 0xd8453b, bubble: 0xe08a1e, flat: 0x8a8f98, bear: 0x2f8f5b, crash: 0x5b3f9e };
/**
 * 手机横屏：面板大小按 phonePanel（718 宽的世界里 702×392，宽屏 940×392），页签挪到标题右边一排，
 * 网格每页两行（列数随宽度变，卡宽不小于约 100）、翻页按钮放在底部一排（详情条和「关闭」中间）；
 * 卡上的字不缩小，放不下就截短，全名在详情条和长按说明里。
 */
function phoneUi(w: number, h: number) {
  const closeW = 96;
  const pagerW = 84;
  // 「下一页」的左边；「上一页」在它左边 144 处，详情条到「上一页」左边 12 为止
  const nextX = w - 24 - closeW - 12 - pagerW;
  return { w, h, gx: 24, gy: 100, gw: w - 48, progY: 68, rowY: h - 52, closeW, pagerW, nextX, stripW: nextX - 60 - pagerW - 12 - 24, cardH: 110 };
}
type PhoneUi = ReturnType<typeof phoneUi>;

/** 把文字截到 maxW 以内（末尾加省略号）。 */
function clipTo(t: Phaser.GameObjects.Text, maxW: number): Phaser.GameObjects.Text {
  let cut = Array.from(t.text);
  while (t.width > maxW && cut.length > 2) {
    cut = cut.slice(0, -1);
    t.setText(`${cut.join('')}…`);
  }
  return t;
}

const TIER_COLOR: Record<'bronze' | 'silver' | 'gold', number> = { bronze: 0xc98a4b, silver: 0x9aa7b4, gold: 0xf2b72f };

/** 每组里点亮了哪些（档案：见过的股票 / 群友 / 道具 / 事件，得到的成就）。 */
function litSets(p: Profile): Record<CodexGroup, Set<string>> {
  return {
    stocks: new Set(p.seen.stocks),
    friends: new Set(p.seen.friends),
    items: new Set(p.seen.items),
    events: new Set(p.seen.events),
    achievements: new Set(Object.keys(p.achievements)),
  };
}

/** 图鉴总进度（标题页用）：点亮数 / 总数，成就单独算。 */
export function codexProgress(p: Profile): { seen: number; total: number; ach: number; achTotal: number } {
  const c = codex();
  const lit = litSets(p);
  const groups: CodexGroup[] = ['stocks', 'friends', 'items', 'events'];
  return {
    seen: groups.reduce((n, g) => n + c[g].filter((e) => lit[g].has(e.id)).length, 0),
    total: groups.reduce((n, g) => n + c[g].length, 0),
    ach: c.achievements.filter((e) => lit.achievements.has(e.id)).length,
    achTotal: c.achievements.length,
  };
}

/**
 * 图鉴：股票 / 群友 / 道具 / 事件 / 成就五个页签。见过的点亮（立绘或图标 + 说明），没见过的是问号卡；
 * 页签旁显示收集进度，上次打开图鉴之后新点亮的条目右上角加「新」角标（关闭时记为看过）。
 * 只用 codex() 和档案里的 seen / achievements，不碰局内隐藏信息。
 */
export class CodexPanel extends Dialog {
  private readonly profile: Profile;
  private readonly lit: Record<CodexGroup, Set<string>>;
  private readonly viewed: Viewed;
  private readonly all = codex();
  private tab: CodexTab;
  private page: Phaser.GameObjects.Container | null = null;
  private readonly tabs = new Map<CodexTab, Button>();
  private readonly progressBox: Phaser.GameObjects.Container;
  private readonly phone: boolean;
  /** 手机版尺寸（电脑上不用） */
  private readonly ui: PhoneUi;
  /** 手机上各页签翻到第几页 */
  private readonly pageOf: Partial<Record<CodexTab, number>> = {};

  constructor(scene: Phaser.Scene, profile: Profile, tab: CodexTab = 'stocks') {
    const phone = phoneLayout(scene);
    const pp = phone ? phonePanel(scene) : { w: 940, h: 430 };
    super(scene, phone ? pp.w : W, phone ? pp.h : H, '图鉴', () => this.markViewed());
    this.phone = phone;
    const ui = phoneUi(pp.w, pp.h);
    this.ui = ui;
    this.profile = profile;
    this.lit = litSets(profile);
    this.viewed = loadViewed();
    this.tab = tab;
    // 手机：八个页签挤在标题和右上角「×」之间，窄了就缩宽、缩间距
    const tabStep = Math.min(98, (ui.w - 100 - 76) / CODEX_TABS.length);
    CODEX_TABS.forEach((t, i) => {
      const b = phone
        ? new Button(scene, 100 + i * tabStep, 14, { width: Math.min(92, tabStep - 5), height: 40, label: t.label, fontSize: 15, sound: 'select' })
        : new Button(scene, 150 + i * 112, 18, { width: 104, height: 38, label: t.label, fontSize: 15, sound: 'select' });
      b.setHandler(() => this.show(t.key));
      this.inner.add(b);
      this.tabs.set(t.key, b);
      this.named[`codex:tab:${t.key}`] = b;
    });
    this.progressBox = phone ? scene.add.container(ui.gx, ui.progY) : scene.add.container(GRID_X, 82);
    this.inner.add(this.progressBox);
    const close = phone
      ? new Button(scene, ui.w - 24 - ui.closeW, ui.rowY, { width: ui.closeW, height: 40, label: '关闭', fontSize: 15, hotkey: 'Esc' })
      : new Button(scene, W - 32 - 110, H - 64, { width: 110, height: 40, label: '关闭', fontSize: 15, hotkey: 'Esc' });
    close.setHandler(() => this.close());
    this.inner.add(close);
    this.named['codex:close'] = close;
    // 0.5.1：底部详情条——指到（或点到）哪张卡，就在这里写它的名字和一句说明（悬停提示照旧）
    this.strip = phone ? scene.add.container(ui.gx, ui.rowY) : scene.add.container(32, H - 64);
    this.inner.add(this.strip);
    this.show(tab);
  }

  /** 关闭时：这次看到的点亮条目都记为看过，下次不再标「新」。 */
  private readonly strip: Phaser.GameObjects.Container;

  /** 底部详情条：放大镜 + 名字 + 一句（截到一行）；没指着卡时写「指一张卡看详情」。 */
  private setStrip(t: TipContent | null): void {
    const s = this.scene;
    this.strip.removeAll(true);
    const w = this.phone ? this.ui.stripW : W - 32 - 110 - 16 - 32;
    this.strip.add(s.add.rectangle(0, 0, w, 40, COLOR.paperLo).setOrigin(0, 0).setRounded(12).setStrokeStyle(1.5, COLOR.edge, 1));
    this.strip.add(addGlyph(s, 22, 20, 'magnifier', 24));
    if (!t) {
      this.strip.add(addText(s, 42, 20, '指一张卡看详情', { size: TYPE.label, color: COLOR.dim, originY: 0.5 }));
      return;
    }
    const name = addText(s, 42, 20, t.title, { size: TYPE.label + 1, bold: true, color: COLOR.accentDark, originY: 0.5 });
    // 手机条窄：名字太长先截名字，剩的地方不够一句就不放说明（全文在长按说明里）
    if (this.phone) clipTo(name, w - 54);
    const body = addText(s, name.x + name.width + 12, 20, (t.body ?? '').split('\n')[0] ?? '', { size: TYPE.label, color: COLOR.ink, originY: 0.5 });
    if (this.phone) {
      if (body.x + 52 > w - 12) body.setVisible(false);
      else clipTo(body, w - 12 - body.x);
    } else {
      let cut = Array.from(body.text);
      while (body.x + body.width > w - 12 && cut.length > 4) {
        cut = cut.slice(0, -2);
        body.setText(`${cut.join('')}…`);
      }
    }
    this.strip.add([name, body]);
  }

  private markViewed(): void {
    const v: Viewed = { stocks: [...this.lit.stocks], friends: [...this.lit.friends], items: [...this.lit.items], events: [...this.lit.events], achievements: [...this.lit.achievements] };
    saveViewed(v);
  }

  private isNew(g: CodexGroup, id: string): boolean {
    return this.lit[g].has(id) && !this.viewed[g].includes(id);
  }

  private show(tab: CodexTab): void {
    this.tab = tab;
    for (const [k, b] of this.tabs) b.setSelected(k === tab);
    this.page?.destroy();
    // 换页时清掉上一页登记的控件（自动化按名字点，不能点到已经不在的卡片或翻页钮）
    for (const k of Object.keys(this.named)) if (k.startsWith('codex:card:') || k.startsWith('codex:words:') || k.startsWith('codex:seg:') || k.startsWith('codex:page:') || k.startsWith('codex:story:')) delete this.named[k];
    const s = this.scene;
    this.page = s.add.container(0, 0);
    this.inner.add(this.page);
    this.setStrip(null);
    this.strip.setVisible(tab !== 'words' && tab !== 'segments');
    if (tab === 'segments') {
      this.segmentPage();
      return;
    }
    if (tab === 'words') {
      this.progressBox.removeAll(true);
      this.progressBox.add(addGlyph(s, 14, 10, 'book', 30));
      this.progressBox.add(addText(s, 36, 10, `${GLOSSARY.length}`, { size: TYPE.title, bold: true, num: true, originY: 0.5 }));
      this.helpTip(120, '词典', '游戏里的说法，每张卡上写着是什么意思。不用背，玩着玩着就懂了。悬停一张卡看例子。');
      this.wordGrid();
      return;
    }
    if (tab === 'knowledge') {
      this.knowledgePage();
      return;
    }
    const list = this.all[tab];
    const n = list.filter((e) => this.lit[tab].has(e.id)).length;
    const fresh = list.filter((e) => this.isNew(tab, e.id)).length;
    this.drawProgress(n, list.length, fresh);
    if (tab === 'achievements') this.achievementGrid(list);
    else this.cardGrid(tab, list);
    this.helpTip(
      this.phone ? 540 : 470,
      tab === 'achievements' ? '成就' : '图鉴',
      tab === 'achievements'
        ? '成就分铜、银、金三档，一局结束时算。有的成就会解锁新人设（带礼物角标）。没拿到的显示成锁着的样子，悬停照样能看条件。'
        : '悬停（或点一下）卡片看说明。没见过的是问号卡：在局里碰到过（被推荐、买过、进群、拿到、发生过）就会点亮。',
    );
  }

  /** 进度条右边的一个小问号：页面说明收在悬停里。 */
  private helpTip(x: number, title: string, body: string): void {
    const s = this.scene;
    const c = s.add.circle(x, 10, 13, COLOR.paperHi).setStrokeStyle(2, COLOR.muted, 1);
    const q = addText(s, x, 10, '?', { size: TYPE.label + 2, bold: true, color: COLOR.muted, originX: 0.5, originY: 0.5 });
    this.progressBox.add([c, q]);
    // 手机上长按才出说明：按的区域放大到 50×50（圆圈本身只有 26）
    const target = this.phone ? s.add.rectangle(x - 25, -12, 50, 50, 0xffffff, 0.001).setOrigin(0, 0) : c;
    if (target !== c) this.progressBox.add(target);
    target.setInteractive({ useHandCursor: true });
    bindTooltip(target, () => ({ x: this.inner.x + this.progressBox.x + x - 14, y: this.inner.y + this.progressBox.y - 4, w: 28, h: 28 }), () => ({ title, body }));
  }

  /**
   * 手机：这一页签翻到第几页（夹在范围内）。电脑上不分页，总是 0、一页放下全部。
   */
  private pageIndex(tab: CodexTab, pages: number): number {
    const p = Math.max(0, Math.min(pages - 1, this.pageOf[tab] ?? 0));
    this.pageOf[tab] = p;
    return p;
  }

  /** 手机：翻到某一页签的第 p 页。 */
  private turn(tab: CodexTab, p: number): void {
    this.pageOf[tab] = p;
    this.show(tab);
  }

  /** 手机：底部一排的翻页按钮（详情条和「关闭」之间），命名 <prefix>:prev / <prefix>:next。 */
  private phonePager(cur: number, pages: number, prefix: string, go: (page: number) => void): void {
    if (pages <= 1) return;
    const s = this.scene;
    const { rowY: y, nextX: nx, pagerW } = this.ui;
    const prev = new Button(s, nx - 60 - pagerW, y, { width: pagerW, height: 40, label: '上一页', fontSize: 14, sound: 'select' });
    const label = addText(s, nx - 30, y + 20, `${cur + 1}/${pages}`, { size: 14, bold: true, num: true, color: COLOR.muted, originX: 0.5, originY: 0.5 });
    const next = new Button(s, nx, y, { width: pagerW, height: 40, label: '下一页', fontSize: 14, sound: 'select' });
    prev.setEnabled(cur > 0);
    next.setEnabled(cur < pages - 1);
    prev.setHandler(() => go(cur - 1));
    next.setHandler(() => go(cur + 1));
    this.page?.add([prev, label, next]);
    this.named[`${prefix}:prev`] = prev;
    this.named[`${prefix}:next`] = next;
  }

  private drawProgress(n: number, total: number, fresh: number): void {
    const s = this.scene;
    this.progressBox.removeAll(true);
    const w = 320;
    this.progressBox.add(addSlice(s, 0, 0, w, 20, 'progress_track'));
    const fw = Math.max(24, Math.round((w * n) / Math.max(1, total)));
    if (n > 0) this.progressBox.add(addSlice(s, 0, 0, fw, 20, 'progress_fill'));
    const label = addText(s, w + 14, 10, `${n}/${total}`, { size: TYPE.title, bold: true, num: true, originY: 0.5 });
    this.progressBox.add(label);
    if (fresh > 0) {
      const fx = w + 14 + label.width + 14;
      const f = addText(s, fx + 30, 10, `+${fresh}`, { size: TYPE.title, bold: true, num: true, originY: 0.5 });
      setColor(f, COLOR.accentDark);
      if (hasArt(s.textures, 'ui:codex_new')) this.progressBox.add(addImage(s, fx + 12, 10, 'ui:codex_new', 24));
      this.progressBox.add(f);
    }
  }

  /** 一张卡的说明（悬停提示）。 */
  private tip(e: CodexEntry, g: CodexGroup): TipContent {
    if (!this.lit[g].has(e.id) && g !== 'achievements') return { title: '？？？', body: '还没见过。' };
    const got = this.lit[g].has(e.id);
    if (g === 'achievements' && e.hidden && !got) return { title: `隐藏结局（${e.tier ? TIER_NAME[e.tier] : ''}）`, body: '打出来才知道是什么。' };
    const title = g === 'achievements' ? `${e.name}（${e.tier ? TIER_NAME[e.tier] : ''}）${got ? ' · 已达成' : ' · 未达成'}` : e.name;
    const st = e.kind === 'stock' && e.role === 'st' ? `\n${ROLE_WORD.st}：${term('st').explain}` : '';
    return { title, body: `${e.desc}${e.note ? `\n${e.note}` : ''}${st}` };
  }

  private hover(target: Phaser.GameObjects.Rectangle, e: CodexEntry, g: CodexGroup, rect: () => { x: number; y: number; w: number; h: number }): void {
    target.setInteractive({ useHandCursor: true });
    target.on(Phaser.Input.Events.POINTER_UP, () => {
      sound.ui('select');
      this.setStrip(this.tip(e, g));
    });
    target.on(Phaser.Input.Events.POINTER_OVER, () => this.setStrip(this.tip(e, g)));
    bindTooltip(target, rect, () => this.tip(e, g));
  }

  /** 手机：一行放几张卡（卡宽不小于约 100，字放得下），一页两行 */
  private cardCols(): number {
    return Math.max(4, Math.floor((this.ui.gw + 8) / 108));
  }

  private cardW(cols: number): number {
    return (this.ui.gw - 8 * (cols - 1)) / cols;
  }

  /** 手机：词典和小知识的卡带整句文字，窄屏一行 3 张，宽屏 4 张 */
  private textCols(): number {
    return this.ui.gw >= 740 ? 4 : 3;
  }

  private cardGrid(g: CodexGroup, list: CodexEntry[]): void {
    const s = this.scene;
    const ph = this.phone;
    const cols = ph ? this.cardCols() : 10;
    const ch = ph ? this.ui.cardH : 112;
    const cw = ph ? this.cardW(cols) : 108;
    const gx = ((ph ? this.ui.gw : GRID_W) - cw * cols) / (cols - 1);
    // 手机一页两行
    const per = ph ? cols * 2 : list.length;
    const pages = Math.max(1, Math.ceil(list.length / per));
    const pg = ph ? this.pageIndex(g, pages) : 0;
    list.forEach((e, i) => {
      if (i < pg * per || i >= (pg + 1) * per) return;
      const k = i - pg * per;
      const x = (ph ? this.ui.gx : GRID_X) + (k % cols) * (cw + gx);
      const y = (ph ? this.ui.gy : GRID_Y) + Math.floor(k / cols) * (ch + 10);
      const c = s.add.container(x, y);
      const lit = this.lit[g].has(e.id);
      if (!lit) {
        // 0.9.0 没解锁的卡和解锁的一样大（以前用 120×160 的竖图，按高缩放后比解锁的窄一圈，一排卡宽窄不齐）
        c.add(lockedCard(s, cw, ch));
        c.add(addText(s, cw / 2, ch / 2 - 10, '?', { size: 44, bold: true, color: 0xb7a592, originX: 0.5, originY: 0.5 }));
        c.add(addText(s, cw / 2, ch - 22, '？？？', { size: 11, bold: true, color: COLOR.muted, originX: 0.5, originY: 0.5 }));
      } else {
        c.add(addSlice(s, 0, 0, cw, ch, 'codex_card'));
        const color = this.cardColor(e);
        const band = s.add.graphics();
        band.fillStyle(color, 1).fillRoundedRect(4, 4, cw - 8, 22, { tl: 12, tr: 12, bl: 0, br: 0 });
        c.add(band);
        const name = addText(s, cw / 2, 15, e.name, { size: 12, bold: true, color: textOn(color), originX: 0.5, originY: 0.5 });
        // 手机上字号不能再缩（最小 13）：放不下就截短，全名在详情条里
        if (ph) clipTo(name, cw - 10);
        else if (name.width > cw - 12) name.setFontSize(10);
        c.add(name);
        c.add(this.picture(e, cw / 2, 70));
        if (e.kind === 'stock' && e.role === 'st') {
          // 危险股：卡上带红签（详情里写清楚 ST 是什么）
          const t = addText(s, 0, 0, ROLE_WORD.st, { size: 10, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
          const pw = t.width + 10;
          const pillH = ph ? 20 : 16;
          c.add(addPill(s, cw - 8 - pw, 30, pw, pillH, COLOR.danger));
          t.setPosition(cw - 8 - pw / 2, 30 + pillH / 2);
          c.add(t);
        }
      }
      if (this.isNew(g, e.id) && hasArt(s.textures, 'ui:codex_new')) c.add(addImage(s, cw - 6, 4, 'ui:codex_new', 26));
      else if (this.isNew(g, e.id)) c.add(addText(s, cw - 6, 4, '新', { size: 12, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5, stroke: COLOR.danger, strokeWidth: 6 }));
      const hit = s.add.rectangle(0, 0, cw, ch, 0xffffff, 0.001).setOrigin(0, 0);
      this.hover(hit, e, g, () => ({ x: this.inner.x + x, y: this.inner.y + y, w: cw, h: ch }));
      c.add(hit);
      this.page?.add(c);
      this.named[`codex:card:${i}`] = { center: () => ({ x: this.inner.x + x + cw / 2, y: this.inner.y + y + ch / 2 }) };
    });
    if (ph) this.phonePager(pg, pages, 'codex:page', (p) => this.turn(g, p));
  }

  private cardColor(e: CodexEntry): number {
    if (e.theme) return THEME_COLOR[e.theme];
    if (e.itemKind) return ITEM_KIND_COLOR[e.itemKind] ?? COLOR.accent;
    if (e.kind === 'friend') return 0x3f6fe0;
    if (e.kind === 'event') return COLOR.accentDark;
    return e.rarity ? RARITY_COLOR[e.rarity] : COLOR.accent;
  }

  /** 卡面插图：股票小人、群友头像、道具图标；事件没有插图，画一枚印章。 */
  private picture(e: CodexEntry, x: number, y: number): Phaser.GameObjects.GameObject[] {
    const s = this.scene;
    if (e.kind === 'stock') return hasArt(s.textures, stockKey(e.id, 'calm')) ? [new StockGuy(s, x, y + 30, e.id, 'calm', 70, { idle: false })] : [];
    if (e.kind === 'friend') return [addImage(s, x, y, avatarKey(e.id, 'normal'), 62)];
    if (e.kind === 'item') {
      if (hasArt(s.textures, itemKey(e.id))) return [addImage(s, x, y, itemKey(e.id), 62)];
      const color = this.cardColor(e);
      return [s.add.circle(x, y, 26, color).setStrokeStyle(3, COLOR.ink, 1), addText(s, x, y, Array.from(e.name).slice(0, 2).join(''), { size: 15, bold: true, color: textOn(color), originX: 0.5, originY: 0.5 })];
    }
    const ring = s.add.circle(x, y, 28, 0xffe7a8).setStrokeStyle(3, COLOR.accentDark, 1);
    return [ring, addText(s, x, y, '事', { size: 22, bold: true, color: COLOR.accentDark, originX: 0.5, originY: 0.5 })];
  }

  /** 成就：徽章 + 名字（档位看框色），条件和档位在悬停里；会解锁人设的带礼物角标。 */
  private achievementGrid(list: CodexEntry[]): void {
    const s = this.scene;
    const ph = this.phone;
    const cols = ph ? this.cardCols() : 9;
    const cw = ph ? this.cardW(cols) : 120;
    // 0.6.4 成就到 45 个：电脑上排 5 行，卡片压矮一点
    const ch = ph ? this.ui.cardH : 90;
    const gx = ((ph ? this.ui.gw : GRID_W) - cw * cols) / (cols - 1);
    const per = ph ? cols * 2 : list.length;
    const pages = Math.max(1, Math.ceil(list.length / per));
    const pg = ph ? this.pageIndex('achievements', pages) : 0;
    list.forEach((e, i) => {
      if (i < pg * per || i >= (pg + 1) * per) return;
      const k = i - pg * per;
      const x = (ph ? this.ui.gx : GRID_X) + (k % cols) * (cw + gx);
      const y = (ph ? this.ui.gy : GRID_Y) + Math.floor(k / cols) * (ch + (ph ? 10 : 8));
      const c = s.add.container(x, y);
      const got = this.lit.achievements.has(e.id);
      const secret = !!e.hidden && !got;
      const tier = e.tier ?? 'bronze';
      c.add(s.add.rectangle(0, 0, cw, ch, got ? COLOR.paperHi : 0xefe5d6).setOrigin(0, 0).setRounded(14).setStrokeStyle(got ? 3 : 2, got ? TIER_COLOR[tier] : COLOR.edge, 1));
      c.add(achievementBadge(s, cw / 2, ph ? 44 : 36, tier, secret ? 'star' : (e.icon ?? 'star'), got, ph ? 62 : 56));
      const nm = addText(s, cw / 2, ch - (ph ? 18 : 14), secret ? '？？？' : e.name, { size: TYPE.label, bold: true, color: got ? COLOR.ink : COLOR.muted, originX: 0.5, originY: 0.5 });
      if (ph) clipTo(nm, cw - 8);
      else if (nm.width > cw - 10) nm.setFontSize(11);
      c.add(nm);
      if (e.note.includes('解锁人设')) c.add(addGlyph(s, 18, 18, 'gift', 24));
      if (this.isNew('achievements', e.id)) {
        if (hasArt(s.textures, 'ui:codex_new')) c.add(addImage(s, cw - 8, 6, 'ui:codex_new', 24));
        else c.add(addText(s, cw - 8, 6, '新', { size: 12, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5, stroke: COLOR.danger, strokeWidth: 6 }));
      }
      const hit = s.add.rectangle(0, 0, cw, ch, 0xffffff, 0.001).setOrigin(0, 0);
      this.hover(hit, e, 'achievements', () => ({ x: this.inner.x + x, y: this.inner.y + y, w: cw, h: ch }));
      c.add(hit);
      this.page?.add(c);
      this.named[`codex:card:${i}`] = { center: () => ({ x: this.inner.x + x + cw / 2, y: this.inner.y + y + ch / 2 }) };
    });
    if (ph) this.phonePager(pg, pages, 'codex:page', (p) => this.turn('achievements', p));
  }

  /** 词典第几页（一页 15 个词）。 */
  private wordPage = 0;

  /** 词典：每个词一张卡，正文直接写一句话解释，A 股叫法放底部小字；一页 15 个，分页看。 */
  private wordGrid(): void {
    const s = this.scene;
    const ph = this.phone;
    // 手机：一页 4 × 2 张，翻页按钮在底部一排
    const cols = ph ? this.textCols() : 5;
    const rows = ph ? 2 : 3;
    const per = cols * rows;
    const pages = Math.ceil(GLOSSARY.length / per);
    this.wordPage = Math.max(0, Math.min(pages - 1, this.wordPage));
    const gap = 10;
    const x0 = ph ? this.ui.gx : GRID_X;
    const y0 = ph ? this.ui.gy : GRID_Y;
    const gw = ph ? this.ui.gw : GRID_W;
    const cw = (gw - gap * (cols - 1)) / cols;
    const ch = ph ? this.ui.cardH : 136;
    for (const k of Object.keys(this.named)) if (k.startsWith('codex:card:') || k.startsWith('codex:words:') || k.startsWith('codex:seg:')) delete this.named[k];
    GLOSSARY.slice(this.wordPage * per, (this.wordPage + 1) * per).forEach((t, i) => {
      const x = x0 + (i % cols) * (cw + gap);
      const y = y0 + Math.floor(i / cols) * (ch + gap);
      const c = s.add.container(x, y);
      c.add(s.add.rectangle(0, 0, cw, ch, COLOR.paperHi).setOrigin(0, 0).setRounded(12).setStrokeStyle(2, COLOR.edge, 1));
      const w = addText(s, 12, 10, t.word, { size: 15, bold: true, wrap: cw - 20 });
      if (w.height > 24) w.setFontSize(13);
      c.add(w);
      const body = addText(s, 12, 34, t.explain, { size: 12, color: COLOR.ink, wrap: cw - 22, lineSpacing: 2 });
      // 正文最多到底部小字上面，超出的写省略号（全文在下方说明里）
      const room = ch - 34 - 24;
      if (body.height > room) {
        let cut = Array.from(t.explain);
        while (body.height > room && cut.length > 8) {
          cut = cut.slice(0, -3);
          body.setText(`${cut.join('')}…`);
        }
      }
      c.add(body);
      if (t.original) {
        const orig = addText(s, 12, ch - 14, t.original === t.word ? 'A 股里也这么叫' : `A 股叫「${t.original}」`, { size: 10, color: COLOR.dim, originY: 0.5 });
        if (ph) clipTo(orig, cw - 20);
        c.add(orig);
      }
      const hit = s.add.rectangle(0, 0, cw, ch, 0xffffff, 0.001).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      hit.on(Phaser.Input.Events.POINTER_UP, () => sound.ui('select'));
      bindTooltip(hit, () => ({ x: this.inner.x + x, y: this.inner.y + y, w: cw, h: ch }), () => this.wordTip(t));
      c.add(hit);
      this.page?.add(c);
      this.named[`codex:card:${i}`] = { center: () => ({ x: this.inner.x + x + cw / 2, y: this.inner.y + y + ch / 2 }) };
    });
    if (ph) {
      this.phonePager(this.wordPage, pages, 'codex:words', (p) => {
        this.wordPage = p;
        this.show('words');
      });
    } else if (pages > 1) {
      const py = y0 + rows * (ch + gap) + 2;
      const label = addText(s, x0 + gw / 2, py + 16, `${this.wordPage + 1}/${pages}`, { size: 13, bold: true, color: COLOR.muted, originX: 0.5, originY: 0.5 });
      const prev = new Button(s, x0 + gw / 2 - 70 - 96, py, { width: 96, height: 32, label: '上一页', fontSize: 13, sound: 'select' });
      const next = new Button(s, x0 + gw / 2 + 70, py, { width: 96, height: 32, label: '下一页', fontSize: 13, sound: 'select' });
      prev.setEnabled(this.wordPage > 0);
      next.setEnabled(this.wordPage < pages - 1);
      prev.setHandler(() => {
        this.wordPage -= 1;
        this.show('words');
      });
      next.setHandler(() => {
        this.wordPage += 1;
        this.show('words');
      });
      this.page?.add([label, prev, next]);
      this.named['codex:words:prev'] = prev;
      this.named['codex:words:next'] = next;
    }
  }

  /** 小知识：点亮集合 = 档案 knowledge；点亮的卡写名字、一句话和真实世界叫法，没点亮的是问号。 */
  private knowledgePage(): void {
    const s = this.scene;
    const list = knowledgeView(this.profile.knowledge);
    const n = list.filter((k) => k.lit).length;
    this.drawProgress(n, list.length, 0);
    for (const k of Object.keys(this.named)) if (k.startsWith('codex:card:') || k.startsWith('codex:words:') || k.startsWith('codex:seg:') || k.startsWith('codex:page:') || k.startsWith('codex:story:')) delete this.named[k];
    const ph = this.phone;
    const cols = ph ? this.textCols() : 4;
    const gap = 10;
    const cw = ((ph ? this.ui.gw : GRID_W) - gap * (cols - 1)) / cols;
    const ch = ph ? this.ui.cardH : 132;
    // 手机：一页两行，正文截短的部分放进长按说明
    const per = ph ? cols * 2 : list.length;
    const pages = Math.max(1, Math.ceil(list.length / per));
    const pg = ph ? this.pageIndex('knowledge', pages) : 0;
    list.forEach((k, i) => {
      if (i < pg * per || i >= (pg + 1) * per) return;
      const j = i - pg * per;
      const x = (ph ? this.ui.gx : GRID_X) + (j % cols) * (cw + gap);
      const y = (ph ? this.ui.gy : GRID_Y) + Math.floor(j / cols) * (ch + gap);
      const c = s.add.container(x, y);
      this.knowledgeCardBody(c, k, cw, ch);
      if (ph && k.lit) {
        const hit = s.add.rectangle(0, 0, cw, ch, 0xffffff, 0.001).setOrigin(0, 0);
        bindTooltip(hit, () => ({ x: this.inner.x + x, y: this.inner.y + y, w: cw, h: ch }), () => ({ title: k.name, body: `${k.text}\n${k.real}` }));
        c.add(hit);
      }
      this.page?.add(c);
      this.named[`codex:card:${i}`] = { center: () => ({ x: this.inner.x + x + cw / 2, y: this.inner.y + y + ch / 2 }) };
    });
    if (ph) this.phonePager(pg, pages, 'codex:page', (p) => this.turn('knowledge', p));
    this.helpTip(this.phone ? 540 : 470, '小知识', '玩着玩着遇到就会点亮。每张卡先用大白话讲，最后一行才是真实世界里的叫法。');
  }

  private knowledgeCardBody(c: Phaser.GameObjects.Container, k: KnowledgeCard, cw: number, ch: number): void {
    const s = this.scene;
    if (!k.lit) {
      c.add(s.add.rectangle(0, 0, cw, ch, 0xe9dfd2).setOrigin(0, 0).setRounded(12).setStrokeStyle(2, 0xb9a9ad, 1));
      c.add(addText(s, cw / 2, ch / 2 - 10, '?', { size: 40, bold: true, color: 0xb7a592, originX: 0.5, originY: 0.5 }));
      c.add(addText(s, cw / 2, ch - 24, '？？？', { size: 13, bold: true, color: COLOR.muted, originX: 0.5, originY: 0.5 }));
      return;
    }
    c.add(s.add.rectangle(0, 0, cw, ch, COLOR.paperHi).setOrigin(0, 0).setRounded(12).setStrokeStyle(2, COLOR.edge, 1));
    c.add(addText(s, 12, 10, k.name, { size: 15, bold: true, wrap: cw - 24 }));
    const body = addText(s, 12, 36, k.text, { size: 12, color: COLOR.ink, wrap: cw - 24, lineSpacing: 2 });
    const room = ch - 36 - 26;
    if (body.height > room) {
      let cut = Array.from(k.text);
      while (body.height > room && cut.length > 8) {
        cut = cut.slice(0, -3);
        body.setText(`${cut.join('')}…`);
      }
    }
    c.add(body);
    const real = addText(s, 12, ch - 14, k.real, { size: 10, color: COLOR.dim, originY: 0.5, wrap: this.phone ? undefined : cw - 24 });
    // 手机上这行是 13 号字：只放一行，截短（全文在长按说明里）
    if (this.phone) clipTo(real, cw - 24);
    c.add(real);
  }

  private wordTip(t: Term): TipContent {
    return { title: !t.original || t.original === t.word ? t.word : `${t.word}（A 股里叫「${t.original}」）`, body: `${t.explain}\n例：${t.example}` };
  }

  private segPage = 0;

  /** 0.4 重做：见过的行情段。不显示年份和日期，只有游戏化标题、市况和最近一局的小故事（点卡片重看）。 */
  private segmentPage(): void {
    const s = this.scene;
    const page = this.page as Phaser.GameObjects.Container;
    const order = (r: Regime): number => REGIMES.indexOf(r);
    const list = Object.values(this.profile.segments ?? {})
      .map((x) => ({ ...x, title: displayTitle(x.id, x.regime, x.title) }))
      .sort((a, b) => order(a.regime) - order(b.regime) || a.title.localeCompare(b.title, 'zh'));
    const kinds = REGIMES.filter((r) => list.some((x) => x.regime === r));
    this.progressBox.removeAll(true);
    this.progressBox.add(addGlyph(s, 14, 10, 'calendar', 30));
    this.progressBox.add(addText(s, 36, 10, `${list.length}`, { size: TYPE.title, bold: true, num: true, originY: 0.5 }));
    this.helpTip(
      120,
      '行情段',
      '每局的涨跌来自一段随机的真实历史行情（公有领域数据），按游戏规则放大、套了涨跌停；公司和时间都隐去了。打完一局，这里会记下你见过的行情，点卡片重看那段日子的故事。',
    );
    // 手机：五种市况放在进度那一行的右边；卡片一列、一页 4 张，故事在右边；翻页在底部一排
    const ph = this.phone;
    const ui = this.ui;
    // 手机：五个签从进度右边排到面板右边距，窄屏缩宽
    const pillW = ph ? Math.min(110, (ui.w - 24 - (ui.gx + 170) - 4 * 8) / 5) : 138;
    const pillY = ph ? ui.progY - 6 : GRID_Y - 4;
    // 五种市况的收集格
    REGIMES.forEach((r, i) => {
      const seen = kinds.includes(r);
      const x = ph ? this.ui.gx + 170 + i * (pillW + 8) : GRID_X + i * 150;
      const pill = addPill(s, x, pillY, pillW, ph ? 32 : 34, seen ? REGIME_TINT[r] : COLOR.edge);
      page.add(pill);
      page.add(addText(s, x + pillW / 2, pillY + (ph ? 16 : 17), seen ? REGIME_LABEL[r] : '？', { size: 14, bold: true, color: seen ? COLOR.white : COLOR.muted, originX: 0.5, originY: 0.5 }));
    });
    // 左：卡片（两列）；右：故事
    const cols = ph ? 1 : 2;
    const cw = ph ? (ui.w >= 800 ? 280 : 250) : 262;
    // 手机：一页 4 张要放进 gy 到底部一排上面 10 之间，高 52、间距 6
    const ch = ph ? 52 : 64;
    const cgap = ph ? 6 : 8;
    const gx0 = ph ? this.ui.gx : GRID_X;
    const top = ph ? this.ui.gy : GRID_Y + 46;
    const px = gx0 + cols * (cw + 12) + (ph ? 20 : 16);
    const pw = (ph ? ui.w - 24 : W - 32) - px;
    const paneBottom = ph ? ui.rowY - 10 : H - 96;
    const pane = s.add.container(0, 0);
    page.add(s.add.rectangle(px - 12, top, pw + 12, paneBottom - top, 0xffffff, 0.55).setOrigin(0, 0));
    page.add(pane);
    const showStory = (x: (typeof list)[number] | null): void => {
      pane.removeAll(true);
      if (!x) {
        pane.add(addGlyph(s, px + pw / 2, top + 80, 'calendar', 72));
        pane.add(addText(s, px + pw / 2, top + 136, '打完一局再来', { size: TYPE.title, color: COLOR.muted, originX: 0.5 }));
        return;
      }
      const t = addText(s, px, top + 12, `「${x.title}」`, { size: 18, bold: true, color: COLOR.accentDark });
      pane.add(t);
      const pill = addPill(s, px + t.width + 8, top + 12, 54, 24, REGIME_TINT[x.regime]);
      pane.add(pill);
      pane.add(addText(s, pill.x + 27, top + 24, REGIME_LABEL[x.regime], { size: 13, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 }));
      const lines = x.story && x.story.length > 0 ? x.story : ['这段行情的故事要再玩到一次才会记下来。'];
      const body = s.add.container(0, 0);
      pane.add(body);
      const bottom = paneBottom - 8;
      if (ph) {
        this.phoneStory(body, lines, x.verdict, px, top + 50, pw - 16, bottom, px + pw);
        return;
      }
      for (const size of [15, 14, 13, 12]) {
        body.removeAll(true);
        let y = top + 50;
        for (const line of lines) {
          const tx = addText(s, px, y, line, { size, color: COLOR.ink, wrap: pw - 16, lineSpacing: 3 });
          body.add(tx);
          y += tx.height + 6;
        }
        if (x.verdict) {
          const v = addText(s, px, y + 4, x.verdict, { size, bold: true, color: COLOR.accentDark, wrap: pw - 16 });
          body.add(v);
          y += v.height + 4;
        }
        if (y <= bottom) break;
      }
    };
    for (const k of Object.keys(this.named)) if (k.startsWith('codex:card:') || k.startsWith('codex:words:') || k.startsWith('codex:seg:')) delete this.named[k];
    // 一页 10 张（两列五行；手机一列四张），见过的多了翻页看
    const per = ph ? 4 : 10;
    const pages = Math.max(1, Math.ceil(list.length / per));
    this.segPage = Math.max(0, Math.min(pages - 1, this.segPage));
    const shown = list.slice(this.segPage * per, (this.segPage + 1) * per);
    shown.forEach((x, i) => {
      const cx = gx0 + (i % cols) * (cw + 12);
      const cy = top + Math.floor(i / cols) * (ch + cgap);
      const card = s.add.rectangle(cx, cy, cw, ch, 0xffffff, 0.75).setOrigin(0, 0).setStrokeStyle(2, REGIME_TINT[x.regime]);
      page.add(card);
      page.add(addText(s, cx + 12, cy + (ph ? 4 : 10), x.title, { size: 15, bold: true }));
      // 手机：市况签的字是 13 号，签放宽放高一点
      const pl = ph ? { y: 27, w: 54, h: 22, dx: 0 } : { y: 40, w: 46, h: 20, dx: 0 };
      const pill = addPill(s, cx + 12, cy + pl.y, pl.w, pl.h, REGIME_TINT[x.regime]);
      page.add(pill);
      const my = cy + pl.y + pl.h / 2;
      page.add(addText(s, pill.x + pl.w / 2, my, REGIME_LABEL[x.regime], { size: 11, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 }));
      page.add(addGlyph(s, cx + 30 + pl.w, my, 'trophy', 20));
      page.add(addText(s, cx + 44 + pl.w, my, `${x.wins}/${x.runs}`, { size: TYPE.label, bold: true, num: true, color: COLOR.muted, originY: 0.5 }));
      card.setInteractive({ useHandCursor: true }).on(Phaser.Input.Events.POINTER_UP, () => showStory(x));
      this.named[`codex:seg:${i}`] = { center: () => ({ x: this.inner.x + cx + cw / 2, y: this.inner.y + cy + ch / 2 }) };
    });
    if (ph) {
      this.phonePager(this.segPage, pages, 'codex:seg', (p) => {
        this.segPage = p;
        this.show('segments');
      });
    } else if (pages > 1) {
      const py = top + 5 * (ch + 8) + 2;
      const mid = GRID_X + cw + 6;
      const label = addText(s, mid, py + 14, `${this.segPage + 1}/${pages}`, { size: 13, bold: true, color: COLOR.muted, originX: 0.5, originY: 0.5 });
      const prev = new Button(s, mid - 60 - 96, py, { width: 96, height: 28, label: '上一页', fontSize: 13, sound: 'select' });
      const next = new Button(s, mid + 60, py, { width: 96, height: 28, label: '下一页', fontSize: 13, sound: 'select' });
      prev.setEnabled(this.segPage > 0);
      next.setEnabled(this.segPage < pages - 1);
      prev.setHandler(() => {
        this.segPage -= 1;
        this.show('segments');
      });
      next.setHandler(() => {
        this.segPage += 1;
        this.show('segments');
      });
      page.add([label, prev, next]);
      this.named['codex:seg:prev'] = prev;
      this.named['codex:seg:next'] = next;
    }
    showStory(shown[0] ?? null);
  }

  /**
   * 手机：故事字号不能低于 13，13 号还放不下就分页，故事框右上角两个小按钮翻页
   * （命名 codex:story:prev / codex:story:next）。
   */
  private phoneStory(body: Phaser.GameObjects.Container, lines: readonly string[], verdict: string | undefined, x: number, top: number, wrap: number, bottom: number, right: number): void {
    const s = this.scene;
    const items = [...lines.map((t) => ({ t, bold: false })), ...(verdict ? [{ t: verdict, bold: true }] : [])];
    const make = (it: (typeof items)[number], size: number, y: number): Phaser.GameObjects.Text =>
      addText(s, x, y, it.t, { size, bold: it.bold, color: it.bold ? COLOR.accentDark : COLOR.ink, wrap, lineSpacing: 3 });
    // 先试一页放下（15 → 13 号）；都不行就按 13 号分页
    const heights = (size: number): number[] =>
      items.map((it) => {
        const t = make(it, size, -9999);
        const h = t.height;
        t.destroy();
        return h;
      });
    let size = 13;
    let hs = heights(13);
    for (const sz of [15, 14]) {
      const h = heights(sz);
      if (top + h.reduce((a, b) => a + b + 6, 0) <= bottom) {
        size = sz;
        hs = h;
        break;
      }
    }
    const pages: number[][] = [[]];
    let used = 0;
    hs.forEach((h, i) => {
      const cur = pages[pages.length - 1]!;
      if (cur.length > 0 && top + used + h > bottom) {
        pages.push([i]);
        used = h + 6;
      } else {
        cur.push(i);
        used += h + 6;
      }
    });
    const draw = (k: number): void => {
      body.removeAll(true);
      delete this.named['codex:story:prev'];
      delete this.named['codex:story:next'];
      let y = top;
      for (const i of pages[k] ?? []) {
        const t = make(items[i]!, size, y);
        body.add(t);
        y += t.height + 6;
      }
      if (pages.length <= 1) return;
      const prev = new Button(s, right - 96, top - 46, { width: 44, height: 38, label: '‹', fontSize: 20, sound: 'select' });
      const next = new Button(s, right - 46, top - 46, { width: 44, height: 38, label: '›', fontSize: 20, sound: 'select' });
      prev.setEnabled(k > 0);
      next.setEnabled(k < pages.length - 1);
      prev.setHandler(() => draw(k - 1));
      next.setHandler(() => draw(k + 1));
      body.add([prev, next, addText(s, right - 104, top - 27, `${k + 1}/${pages.length}`, { size: 13, bold: true, num: true, color: COLOR.muted, originX: 1, originY: 0.5 })]);
      this.named['codex:story:prev'] = prev;
      this.named['codex:story:next'] = next;
    };
    draw(0);
  }

  get currentTab(): CodexTab {
    return this.tab;
  }
}

/** 成就徽章：档位框 + 图标；没达成用锁定框、图标压暗。缺素材时画一个档位色的圆。 */
export function achievementBadge(scene: Phaser.Scene, x: number, y: number, tier: 'bronze' | 'silver' | 'gold', icon: string, got: boolean, size = 96): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const frame = achFrameKey(got ? tier : 'locked');
  if (hasArt(scene.textures, frame)) c.add(addImage(scene, 0, 0, frame, size));
  else c.add(scene.add.circle(0, 0, size * 0.45, got ? TIER_COLOR[tier] : 0x8d7b84).setStrokeStyle(3, COLOR.ink, 1));
  const ic = achIconKey(icon);
  if (hasArt(scene.textures, ic)) {
    const img = addImage(scene, 0, 0, ic, (size * 64) / 96);
    if (!got) img.setTint(0x5a5058).setAlpha(0.6);
    c.add(img);
  }
  return c;
}

/**
 * 没解锁的卡：0.18.0 改成浅一号的纸（以前深紫底，四行里两行深色压得很重）：纸色底、一层淡点、虚一点的描边。
 * 和解锁卡的九宫格素材对齐：素材四周留 4 的透明边，底下 8 里有一道阴影，所以卡身是 (4, 4) 起 (w-8)×(h-12)。
 */
function lockedCard(s: Phaser.Scene, w: number, h: number): Phaser.GameObjects.Graphics {
  const [x, y, bw, bh] = [4, 4, w - 8, h - 12];
  const g = s.add.graphics();
  g.fillStyle(COLOR.ink, 0.2).fillRoundedRect(x + 3, y + 4, bw, bh, RADIUS.md);
  g.fillStyle(0xe9dfd2, 1).fillRoundedRect(x, y, bw, bh, RADIUS.md);
  g.fillStyle(0xd8cabb, 1);
  for (let yy = y + 10; yy < y + bh - 8; yy += 12) for (let xx = x + 10 + ((yy / 12) % 2) * 6; xx < x + bw - 8; xx += 12) g.fillCircle(xx, yy, 1.4);
  g.lineStyle(2.5, 0xb9a9ad, 1).strokeRoundedRect(x, y, bw, bh, RADIUS.md);
  return g;
}
