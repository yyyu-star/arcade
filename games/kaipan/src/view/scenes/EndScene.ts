import { achievementHints, achievementView, dailyBoardId, difficultyView, formatMoney, formatPoints, personaView, storyView, runSummary, stocksOf, stockCard, type AchievementHint, type GameState, type RunSummary } from '../../core/index.ts';
import { RevealPanel } from '../meta/revealPanel.ts';
import { BoardPanel } from '../meta/boardPanel.ts';
import { onBoardChange, retryRun, runBoard } from '../dailyBoard.ts';
import { goLobby, lobbyLabel } from '../lobby.ts';
import { live, onLiveChange } from '../live.ts';
import { chips, liveEndText } from '../liveText.ts';
import { setColor } from '../ui/text.ts';
import { bestKey, isDifficultyUnlocked, isPersonaUnlocked, loadProfile, type Profile, type RecordResult } from '../../platform/profile.ts';
import { ensureMetaArt, hasArt, stockKey, type Glyph } from '../assets.ts';
import { addBackdrop } from '../fx/effects.ts';
import { confetti } from '../fx/particles.ts';
import { bestText, boardLine, dailyTag, dailyText, endSubtitle, ledgerRows, levelLabel, summaryRows } from '../labels.ts';
import { loadLastSetup, saveLastSetup } from '../meta/prefs.ts';
import { playUnlocks } from '../meta/unlockDialog.ts';
import { unlocksOf, type Unlock } from '../meta/unlocks.ts';
import { randomSeed, type Session } from '../session.ts';
import { sound } from '../sound.ts';
import { COLOR, GAME_WIDTH, PHONE, TYPE, arrowOf, signColor } from '../theme.ts';
import { addGlyph, addPaper, addPill } from '../ui/art.ts';
import { bindTooltip, type TipContent } from '../ui/tooltip.ts';
import { statTile, tipOnButton } from '../meta/bits.ts';
import { addBadge, addPortrait } from '../meta/setupPanel.ts';
import { Button } from '../ui/button.ts';
import { StockGuy } from '../ui/stockGuy.ts';
import { addText } from '../ui/text.ts';
import type Phaser from 'phaser';
import { Room } from '../trade/room.ts';
import { phoneLayout } from '../viewport.ts';
import { posterArtFor, posterContent, renderPoster, sharePoster } from '../poster.ts';
import { BaseScene } from './BaseScene.ts';

const W = 960;
const H = 600;

/** 结束页纸卡的一套尺寸（电脑一套、手机横屏一套），坐标都相对纸卡左上角。 */
interface Geo {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 左栏左边距、宽 */
  pad: number;
  leftW: number;
  /** 立绘 / 徽章的中心 y、立绘宽、徽章大小 */
  headY: number;
  portrait: number;
  badge: number;
  titleY: number;
  titleSize: number;
  moneySize: number;
  wallet: number;
  /** 「最赚的一笔」卡：宽、小人最大、离纸卡底边 */
  boxW: number;
  guyMax: number;
  boxBottom: number;
  /** 右栏左边、战绩格（列数、宽、图标、字号） */
  mx: number;
  rightW: number;
  tileCols: number;
  tw: number;
  tileIcon: number;
  tileSize: number;
  tileGap: number;
  /** 收获一行：是否在同一行写「收获」两个字（手机），图标大小 */
  gainsInline: boolean;
  chipIcon: number;
  /** 底部按钮高、离纸卡底边 */
  btnH: number;
  btnBottom: number;
}

const DESK_GEO: Geo = {
  x: GAME_WIDTH / 2 - W / 2, y: 60, w: W, h: H, pad: 40, leftW: 420, headY: 46, portrait: 40, badge: 36, titleY: 86, titleSize: 40, moneySize: 40, wallet: 44,
  boxW: 400, guyMax: 180, boxBottom: 40, mx: 480, rightW: 404, tileCols: 2, tw: 196, tileIcon: 40, tileSize: TYPE.title + 2, tileGap: 12,
  gainsInline: false, chipIcon: 34, btnH: 50, btnBottom: 74,
};
/**
 * 手机横屏（960×444）：纸卡 940×430；左栏标题、账户、最赚的一笔都收小一号，
 * 右栏战绩改成 3 × 2，「收获」两个字和图标并在一行，按钮 46 高。字号都不低于 13。
 */
const PHONE_GEO: Geo = {
  x: 10, y: 7, w: 940, h: 430, pad: 24, leftW: 380, headY: 34, portrait: 34, badge: 30, titleY: 58, titleSize: 32, moneySize: 32, wallet: 36,
  boxW: 380, guyMax: 120, boxBottom: 34, mx: 430, rightW: 486, tileCols: 3, tw: 156, tileIcon: 32, tileSize: TYPE.title, tileGap: 9,
  gainsInline: true, chipIcon: 30, btnH: 46, btnBottom: 58,
};

/**
 * 结束页：称号与最终账户、本局小结、这个人设 × 难度（或今天的每日挑战）的最好成绩（刷新时标「新纪录」）、
 * 本局新达成的成就和解锁；进场后依次弹出成就、新人设、新难度。按钮：同种子再来、新局、主菜单。
 */
export class EndScene extends BaseScene {
  protected override readonly phoneReady = PHONE;
  private buttons: Record<string, Button> = {};
  private room: Room | null = null;
  private summary: RunSummary | null = null;
  private result: RecordResult | null = null;
  /** 0.6.0 实盘局：结算的大字和说明（结回的回话晚到时就地改字，不重建场景） */
  private liveHead: Phaser.GameObjects.Text | null = null;
  private liveBody: Phaser.GameObjects.Text | null = null;

  constructor(session: Session) {
    super('end', session);
  }

  protected override build(): void {
    this.buttons = {};
    this.liveHead = null;
    this.liveBody = null;
    const s = this.session.state;
    const sum = runSummary(s);
    const lv0 = sum.live;
    const months = lv0?.months ?? 12;
    this.summary = sum;
    this.result = this.session.recordEnd();
    const profile: Profile = this.result?.profile ?? loadProfile().profile;
    this.room = new Room(this, sum.won ? 'bull' : 'bear', { ambient: this.lively });
    addBackdrop(this, 0.35).disableInteractive();
    const G = phoneLayout(this) ? PHONE_GEO : DESK_GEO;
    const ph = G !== DESK_GEO;
    const { x, y } = G;
    const W = G.w;
    const H = G.h;
    addPaper(this, x, y, W, H);

    // ---- 左：谁 × 哪一级、通关/出局、称号、最终账户、最赚的一笔
    const lv = difficultyView(sum.difficulty);
    const setup = `${sum.personaName} · ${levelLabel(lv.level, sum.difficultyName)}`;
    const L = x + G.pad;
    const hy = y + G.headY;
    addPortrait(this, L + 22, hy, { id: sum.persona, name: sum.personaName }, false, G.portrait);
    addBadge(this, L + 22 + G.badge + 8, hy, lv.level, G.badge);
    const who = this.add.rectangle(L, hy - 28, 90, 56, 0xffffff, 0.001).setOrigin(0, 0);
    bindTooltip(who, () => ({ x: L, y: hy - 28, w: 90, h: 56 }), () => ({ title: '这一局', body: setup }));
    const pillX = L + (ph ? 84 : 96);
    this.tag(pillX, hy - 10, sum.won ? '通关' : '出局', sum.won ? COLOR.accent : COLOR.danger, 64);
    if (sum.daily) this.tag(pillX + 74, hy - 10, dailyTag(sum.daily), COLOR.info, 120);
    if (lv0) this.tag(pillX + 74, hy - 10, `实盘 · ${chips(lv0.stake)}`, COLOR.accentDark, 120);
    const title = addText(this, L, y + G.titleY, sum.title, { size: G.titleSize, bold: true, color: COLOR.ink, wrap: G.leftW });
    title.setInteractive();
    bindTooltip(title, () => ({ x: L, y: y + G.titleY, w: title.width, h: title.height }), () => ({ title: sum.title, body: endSubtitle(sum) }));
    // 0.5.1：副标题放回卡面（撑到几月 / 带多少钱上岸）；0.6.0 实盘局这里是"结回多少"，放在最显眼的位置
    const subT = lv0
      ? (this.liveHead = addText(this, L, y + G.titleY + 6 + title.height, '', { size: TYPE.title + 2, bold: true, num: true, color: COLOR.accentDark, wrap: G.leftW }))
      : addText(this, L, y + G.titleY + 6 + title.height, endSubtitle(sum), { size: TYPE.label + 1, color: COLOR.muted, wrap: G.leftW });
    // 0.6.3 按打法的评语：称号右边一枚标签，副标题下面一句话
    const st = sum.style;
    this.tag(L + title.width + 14, y + G.titleY + title.height / 2 - 11, st.tag, COLOR.info, Math.max(84, Array.from(st.tag).length * 15 + 22));
    const styleT = addText(this, L, subT.y + subT.height + 4, st.line, { size: TYPE.label, color: COLOR.accentDark, wrap: G.leftW });
    const ay = y + G.titleY + 18 + title.height + subT.height + styleT.height + (ph ? 18 : 24);
    addGlyph(this, L + 22, ay, 'wallet', G.wallet);
    addText(this, L + 52, ay, formatMoney(sum.account), { size: G.moneySize, bold: true, num: true, color: COLOR.ink, originY: 0.5 });
    // 0.5.2：「最赚的一笔」收进一块浅底卡：左边大小人，右边一列（标题、名字、涨幅、这段日子）在卡里上下居中，
    // 以前三样各自摆在固定坐标上，和小人对不齐、底下空一大截
    const boxY = ay + (ph ? 28 : 36);
    const boxH = y + H - G.boxBottom - boxY;
    const boxW = G.boxW;
    this.add.rectangle(L, boxY, boxW, boxH, 0xffffff, 0.55).setOrigin(0, 0).setRounded(18).setStrokeStyle(2, COLOR.edge, 1);
    // 小人 + 右边一列当成一组，在卡里左右、上下都居中（右列按最宽的 170 估）
    const guySize = Math.min(G.guyMax, boxH - (ph ? 24 : 40));
    const groupW = guySize + 20 + 170;
    const guyX = L + (boxW - groupW) / 2 + guySize / 2;
    const guyFeet = boxY + (boxH + guySize) / 2 + 4;
    const colX = guyX + guySize / 2 + 20;
    const stack: { h: number; draw: (yy: number) => void }[] = [];
    if (sum.bestTrade) {
      const card = stockCard(s, sum.bestTrade.stockId);
      new StockGuy(this, guyX, guyFeet, card.id, sum.bestTrade.ret >= 0 ? 'limitup' : 'worried', guySize, { idle: this.lively });
      const ret = sum.bestTrade.ret;
      stack.push({ h: 22, draw: (yy) => addText(this, colX, yy + 11, '最赚的一笔', { size: TYPE.label, color: COLOR.muted, originY: 0.5 }) });
      stack.push({
        h: 34,
        draw: (yy) => {
          addGlyph(this, colX + 12, yy + 17, 'trophy', 26);
          addText(this, colX + 30, yy + 17, card.name, { size: TYPE.title, bold: true, originY: 0.5 });
        },
      });
      stack.push({ h: ph ? 40 : 46, draw: (yy) => addText(this, colX, yy + (ph ? 20 : 23), `${arrowOf(ret)}${formatPoints(Math.abs(ret), 1, false)}`, { size: ph ? TYPE.big : TYPE.big + 6, bold: true, num: true, color: signColor(ret), originY: 0.5 }) });
    } else {
      // 没有交易：让本局第一个题材的龙头哭一下
      const id = s.themeIds.map((t) => stocksOf(t)[0]?.id).find((v) => v && hasArt(this.textures, stockKey(v, 'limitdown')));
      if (id) new StockGuy(this, guyX, guyFeet, id, 'limitdown', guySize, { idle: this.lively });
      stack.push({ h: 22, draw: (yy) => addText(this, colX, yy + 11, '这局没交易', { size: TYPE.label, color: COLOR.muted, originY: 0.5 }) });
      stack.push({ h: ph ? 40 : 46, draw: (yy) => addText(this, colX, yy + (ph ? 20 : 23), '0 笔', { size: ph ? TYPE.big : TYPE.big + 6, bold: true, num: true, color: COLOR.muted, originY: 0.5 }) });
    }
    // 0.4 重做：真实行情局可以随时再看一遍"这段日子"的小故事
    if (s.real) stack.push({ h: ph ? 52 : 56, draw: (yy) => (this.buttons.reveal = new Button(this, colX, yy + (ph ? 8 : 12), { width: 150, height: 44, label: '这段日子', variant: 'default', fontSize: 15, hotkey: 'V', onClick: () => this.openReveal() })) });
    const stackH = stack.reduce((n, it) => n + it.h, 0);
    let sy = boxY + Math.max(ph ? 6 : 12, (boxH - stackH) / 2);
    for (const it of stack) {
      it.draw(sy);
      sy += it.h;
    }

    // ---- 右：战绩图标格（2 × 3），完整说法在悬停
    const mx = x + G.mx;
    const tw = G.tw;
    const th = G.tileIcon + 16;
    const cols = G.tileCols;
    const tgx = G.tileGap;
    const ty0 = y + (ph ? 16 : 28);
    const tiles: [Glyph, string, string, number?][] = [
      ['calendar', `${sum.billsPaid}/${months}`, '还上', sum.won ? COLOR.accentDark : undefined],
      ['wallet', formatMoney(sum.peakAccount), '最高'],
      ['bolt', `${sum.limitUpDays}天`, '涨停'],
      ['arrow_up', sum.maxBoards > 1 ? `${sum.maxBoards}天` : '–', '连涨停'],
      ['horn', `${sum.chains}次`, '带小弟'],
    ];
    tiles.forEach(([g, v, label, color], i) => {
      const tx = mx + (i % cols) * (tw + tgx);
      const ty = ty0 + Math.floor(i / cols) * (th + 10);
      statTile(this, tx, ty, g, v, label, { w: tw, icon: G.tileIcon, size: G.tileSize, color, tint: g === 'arrow_up' ? COLOR.up : undefined });
    });
    // 第 6 格：炒股本身净赚多少（0.5.4：以前是"最好 0/12"，没计入档案时看不懂；最好成绩挪到下面那一行）
    {
      const tx = mx + ((tiles.length) % cols) * (tw + tgx);
      const ty = ty0 + Math.floor(tiles.length / cols) * (th + 10);
      const tm = sum.tradeMoney;
      const v = tm === null ? '–' : formatMoney(tm, { sign: true });
      statTile(this, tx, ty, tm !== null && tm < 0 ? 'arrow_down' : 'arrow_up', v, '炒股净赚', { w: tw, icon: G.tileIcon, size: G.tileSize, color: tm === null ? undefined : signColor(tm), tint: tm === null ? undefined : signColor(tm) });
      const hit = this.add.rectangle(tx, ty, tw, th, 0xffffff, 0.001).setOrigin(0, 0);
      bindTooltip(hit, () => ({ x: tx, y: ty, w: tw, h: th }), () => ({
        title: '炒股净赚',
        body:
          tm === null
            ? '这局是旧版本开的，没有记下炒股合计。'
            : `每天收盘股票带来的赚亏，加上买入的手续费和持股分红（不算账单、利息和奖励）。\n${ledgerRows(sum).map(([k, v]) => `${k} ${v}`).join('\n')}\n称号按炒股净赚是本钱的几倍来定。`,
      }));
    }
    const rowsN = Math.ceil((tiles.length + 1) / cols);
    const gw = tw * cols + tgx * (cols - 1);
    const gridHit = this.add.rectangle(mx, ty0, gw, rowsN * th + (rowsN - 1) * 10, 0xffffff, 0.001).setOrigin(0, 0).setDepth(-1);
    bindTooltip(gridHit, () => ({ x: mx, y: ty0, w: gw, h: rowsN * (th + 10) }), () => ({ title: '这一局', body: summaryRows(sum).map(([k, v]) => `${k}：${v}`).join('\n') }));

    // ---- 收获：图标 + 数字（名字在悬停）；手机上「收获」两个字和图标并在一行
    const gy = ty0 + rowsN * (th + 10) + (ph ? 4 : 16);
    const gl = addText(this, mx, ph ? gy + 22 : gy, '收获', { size: TYPE.title, bold: true, originY: ph ? 0.5 : 0 });
    this.gains(ph ? mx + gl.width + 10 : mx, ph ? gy : gy + 34, sum, G.chipIcon);

    // ---- 12 个月账单轨道（0.5.1）：还上的绿格、没还上的红格、没走到的灰格；实盘只有 6 格
    const ky = ph ? gy + 56 : gy + 98;
    addGlyph(this, mx + 12, ky + 14, 'house', 24);
    for (let m = 0; m < months; m++) {
      const px = mx + 34 + m * 31;
      const paid = m < sum.billsPaid;
      const failed = !sum.won && m === sum.billsPaid;
      const fill = paid ? 0xc8ecd2 : failed ? 0xffd2cc : COLOR.paperLo;
      const box = this.add.rectangle(px, ky, 27, 28, fill).setOrigin(0, 0).setRounded(7).setStrokeStyle(1.5, failed ? COLOR.danger : COLOR.edge, 1);
      addText(this, px + 13.5, ky + 14, `${m + 1}`, { size: paid || failed ? 13 : 11, bold: true, color: paid ? COLOR.down : failed ? COLOR.danger : COLOR.dim, originX: 0.5, originY: 0.5 });
      if (this.lively && (paid || failed)) {
        box.setScale(0.2);
        this.tweens.add({ targets: box, scale: 1, duration: 200, delay: 40 * m, ease: 'Back.easeOut' });
      }
    }
    // 实盘：最好成绩、经历两行的位置换成结算的说明（实盘局不进最好成绩）
    if (lv0) {
      this.liveBody = addText(this, mx + 12, ky + 44, '', { size: TYPE.label, color: COLOR.ink, wrap: ph ? G.rightW - 24 : 392, lineSpacing: 3 });
      this.updateLive();
      const off = onLiveChange(() => this.updateLive());
      this.events.once('shutdown', off);
    } else {
      // 最好成绩 / 今日挑战一句（0.5 只在悬停，0.5.1 放回来）
      const best = profile.best[bestKey(sum.persona, sum.difficulty)];
      const line = sum.daily ? `今日挑战：${dailyText(profile.daily[sum.daily])}` : `${sum.personaName}·${sum.difficulty}级最好：${bestText(best)}`;
      addGlyph(this, mx + 12, ky + 52, 'trophy', 22);
      const lw = ph ? G.rightW - 100 : 380;
      const lt = addText(this, mx + 30, ky + 44, line, { size: TYPE.label, color: COLOR.ink, wrap: lw, lineSpacing: 2 });
      if (sum.daily ? this.result?.newDaily : this.result?.newBest) this.newTag(Math.min(mx + 30 + lt.width + 8, mx + lw + 20), ky + 36);
    }
    // 这局的经历（借钱、押跌……）：最多两条，整段在「收获」的包里；每日挑战第二条的位置给排行榜（0.5.10）
    const board = sum.daily ? sum.daily : null;
    sum.recap.slice(0, lv0 ? 0 : board ? 1 : 2).forEach((l, i) => {
      const t = addText(this, mx + 30, ky + 92 + i * 22, l, { size: TYPE.label - 1, color: COLOR.muted });
      let cut = Array.from(t.text);
      const rw = ph ? G.rightW - 40 : 380;
      while (t.width > rw && cut.length > 6) {
        cut = cut.slice(0, -2);
        t.setText(`${cut.join('')}…`);
      }
      addGlyph(this, mx + 12, ky + 100 + i * 22, 'bag', 16);
    });

    if (board) this.boardRow(mx, ky + 114, ph ? G.rightW : 404, sum.runId, board);

    // 0.6.8 下次可以试试：离得最近的一两个成就和这局的进度。只在娱乐局放（实盘局不在筹码局里推"再来"，economy.md 第 0 节），
    // 只说成就进度，不提输赢和筹码；放不下（手机上经历多了）就不放
    if (!lv0) {
      const hy = board ? ky + 150 : ky + 92 + Math.min(sum.recap.length, 2) * 22;
      const hints = achievementHints(s, Object.keys(profile.achievements));
      if (hints.length > 0 && hy + 20 <= y + H - G.btnBottom - 6) this.hintRow(mx, hy, ph ? G.rightW - 40 : 380, hints);
    }

    const by = y + H - G.btnBottom;
    const mk = (key: string, label: string, bx: number, w: number, variant: 'primary' | 'default', fn: () => void, hotkey?: string): void => {
      this.buttons[key] = new Button(this, bx, by, { width: w, height: G.btnH, label, variant, fontSize: 16, hotkey, onClick: fn });
    };
    // 手机：三个按钮加「晒战绩」撑满右栏（486 宽），手指好点
    const bw = ph ? [104, 140, 104] : [120, 150, 110];
    // 实盘局只有一个「回开始菜单」：不在结束页推"再开一局"（设计稿第 5 节），同种子重玩也会开出一局没带入的实盘
    if (lv0) mk('menu', '回开始菜单', mx + (ph ? 0 : bw[0]! + 12), ph ? 180 : bw[1]!, 'primary', () => this.session.toTitle(), 'Esc');
    else {
      mk('retry', sum.daily ? '再挑战' : '重玩', mx, bw[0]!, 'default', () => this.session.newRun(s.seed, s.setup), 'R');
      mk('new', '新一局', mx + bw[0]! + 12, bw[1]!, 'primary', () => this.newRun(sum, profile), '空格');
      mk('menu', '主菜单', mx + bw[0]! + bw[1]! + 24, bw[2]!, 'default', () => this.session.toTitle(), 'Esc');
    }
    const retry = this.buttons.retry;
    if (retry) tipOnButton(retry, () => ({ x: mx, y: by, w: bw[0]!, h: G.btnH }), () => ({ title: sum.daily ? '再挑战一次' : '同一局再来', body: `这一局的编号：${s.seed}\n输入同一个编号能重玩同一局` }));
    addText(this, x + G.pad, y + H - (ph ? 17 : 26), `#${s.seed}`, { size: 12, color: COLOR.dim, originY: 0.5 });
    // 回大厅（0.5.8）：和开始菜单一样在左上角；这局已经结束、记进档案了，点了直接走。
    // 手机横屏纸卡几乎铺满，挪到左栏标题行的右端（每日挑战的标签到 x≈312）
    const lobbyAt = ph ? { x: L + G.leftW - 96, y: y + 8 } : { x: 14, y: 10 };
    this.buttons.lobby = new Button(this, lobbyAt.x, lobbyAt.y, { width: ph ? 96 : 104, height: 42, label: lobbyLabel(), icon: 'house', fontSize: 16, onClick: () => goLobby() });
    // 0.6.5 结局海报：电脑上放在右上角（和「大厅」对称），手机上放在按钮那一排的最右边
    const posterAt = ph ? { x: mx + (lv0 ? 192 : bw[0]! + bw[1]! + bw[2]! + 36), y: by, w: ph && lv0 ? 140 : 102, h: G.btnH } : { x: GAME_WIDTH - 14 - 132, y: 10, w: 132, h: 42 };
    this.posterButton(posterAt, sum);
  }

  /** 「下次可以试试」一行：星星 + 成就名 + 这局的进度，悬停看每个成就怎么拿 */
  private hintRow(mx: number, hy: number, width: number, hints: readonly AchievementHint[]): void {
    addGlyph(this, mx + 12, hy + 8, 'star', 16);
    const t = addText(this, mx + 30, hy, `下次可以试试：${hints.map((h) => `${h.name} ${h.have}/${h.need}`).join(' · ')}`, { size: TYPE.label - 1, color: COLOR.info });
    let cut = Array.from(t.text);
    while (t.width > width && cut.length > 8) {
      cut = cut.slice(0, -2);
      t.setText(`${cut.join('')}…`);
    }
    t.setInteractive();
    bindTooltip(t, () => ({ x: mx + 30, y: hy, w: t.width, h: t.height }), () => ({ title: '下次可以试试', body: hints.map((h) => `${h.name}：${h.desc}（这局 ${h.have}/${h.need}）`).join('\n') }));
  }

  /**
   * 「晒战绩」：进场就在后台画好海报，点了马上分享或下载（iOS 的分享要在点的同一下里调用）。
   * 每日挑战交完分读到名次后再画一张带名次的（0.6.10）；画好之前点，分享的是手上那张。
   */
  private posterButton(at: { x: number; y: number; w: number; h: number }, sum: RunSummary): void {
    let content = posterContent(sum);
    let blob: Blob | null = null;
    const b = new Button(this, at.x, at.y, { width: at.w, height: at.h, label: '晒战绩', icon: 'star', fontSize: 16, onClick: () => {
      if (!blob) return;
      const done = (text: string): void => {
        if (!b.scene) return;
        b.setLabel(text);
        this.time.delayedCall(1800, () => b.scene && b.setLabel('晒战绩'));
      };
      void sharePoster(blob, `kaipan-${sum.seed}.png`, content.shareTitle).then((r) => done(r === 'shared' ? '分享了' : r === 'saved' ? '已保存' : r === 'failed' ? '没存上' : '晒战绩'));
    } });
    b.setLoading(true, '画海报');
    this.buttons.poster = b;
    const paint = (c: typeof content): void => {
      void renderPoster(c, posterArtFor(this.textures, c)).then((x) => {
        // 不带名次的那张晚于带名次的画完：不拿旧的盖掉新的
        if (x && (c === content || !blob)) blob = x;
        if (!b.scene || b.isEnabled()) return;
        if (blob) b.setLoading(false, '晒战绩').setEnabled(true);
        else if (c === content) b.setLoading(false, '画不出来').setEnabled(false);
      });
    };
    paint(content);
    if (!sum.daily) return;
    const rankNow = (): number | null => {
      const r = runBoard(sum.runId);
      return r.state === 'done' && r.rank ? r.rank : null;
    };
    let shown: number | null = null;
    const update = (): void => {
      const rank = rankNow();
      if (!rank || rank === shown || !b.scene) return;
      shown = rank;
      content = posterContent(sum, rank);
      paint(content);
    };
    update();
    const off = onBoardChange(update);
    this.events.once('shutdown', off);
  }

  /**
   * 每日挑战的排行榜一行（0.5.10）：交分的状态（交上了排第几、今天交太多了、连不上……）+「排行榜」；连不上时多一个「重试」。
   * 交分是异步的，状态变了只重画这一行。
   */
  private boardRow(x: number, y: number, w: number, runId: string, date: string): void {
    const box = this.add.container(0, 0);
    const draw = (): void => {
      box.removeAll(true);
      delete this.buttons.board;
      delete this.buttons['board:retry'];
      const b = runBoard(runId);
      const line = boardLine(b);
      const open = new Button(this, x + w - 100, y - 4, { width: 100, height: 34, label: '排行榜', icon: 'trophy', fontSize: 14 });
      open.setHandler(() => {
        if (!this.dialogOpen) this.trackDialog(new BoardPanel(this, date, b.state === 'sending' || b.state === 'done' ? b.boardId : dailyBoardId(date)));
      });
      box.add(open);
      this.buttons.board = open;
      let right = x + w - 100 - 8;
      if (line?.retry) {
        const retry = new Button(this, right - 64, y - 4, { width: 64, height: 34, label: '重试', fontSize: 14 });
        retry.setHandler(() => retryRun(runId));
        box.add(retry);
        this.buttons['board:retry'] = retry;
        right -= 64 + 8;
      }
      box.add(addGlyph(this, x + 12, y + 13, 'star', 18));
      // 不计入档案（调试局等）：不交分，只留「排行榜」入口，星号后面写上是哪天的榜（这局的日期不一定是今天）
      const t = addText(this, x + 30, y + 13, line?.text ?? `每日排行 ${date.slice(5).replace('-', '/')}`, { size: TYPE.label - 1, bold: !!line?.good, color: line?.good ? COLOR.accentDark : COLOR.muted, originY: 0.5 });
      let cut = Array.from(t.text);
      while (t.width > right - x - 34 && cut.length > 4) {
        cut = cut.slice(0, -2);
        t.setText(`${cut.join('')}…`);
      }
      box.add(t);
    };
    draw();
    const off = onBoardChange(() => box.active && draw());
    box.once('destroy', off);
  }

  /** "这段日子"小故事（真实行情局）：进场先弹一次，之后点按钮再看。 */
  private openReveal(then?: () => void): boolean {
    const v = storyView(this.session.state);
    if (!v || this.dialogOpen) {
      then?.();
      return false;
    }
    const d = new RevealPanel(this, v, () => {
      this.session.notify();
      then?.();
    });
    this.trackDialog(d);
    this.session.notify();
    return true;
  }

  /** 新局：沿用这局的人设和难度（每日挑战、调试局之后用上次自己选的）；都要按档案校验解锁，没解锁的退回新手 + 第 1 级。 */
  private newRun(sum: RunSummary, profile: Profile): void {
    const want = sum.daily || !sum.ranked || this.result?.ignored ? loadLastSetup() : { persona: sum.persona, difficulty: sum.difficulty };
    const setup = {
      persona: isPersonaUnlocked(profile, want.persona) ? want.persona : 'newbie',
      difficulty: isDifficultyUnlocked(profile, want.difficulty) ? want.difficulty : 1,
    } as const;
    saveLastSetup(setup);
    this.session.newRun(randomSeed(), setup);
  }

  /** 本局新达成的成就、新解锁的人设和难度、点亮的图鉴：一排图标 + 数字，名字在悬停；没计入档案时一行短话（原因在悬停）。 */
  private gains(x: number, y: number, sum: RunSummary, icon = 34): void {
    const r = this.result;
    const why: string | null = !r
      ? '这次不写档案'
      : r.ignored === 'debug'
        ? '调试局（URL 开局参数或调试模式），不计入档案和成就'
        : r.ignored === 'locked'
          ? '这个人设或难度还没解锁，这局不计入档案'
          : r.ignored === 'future'
            ? '每日挑战的日期还没到，这局不计入档案'
            : r.ignored === 'duplicate'
              ? '这局已经记进档案了'
              : r.ignored === 'unfinished'
                ? '这局还没结束'
                : null;
    if (why || !r) {
      const t = addText(this, x, y + 20, '不计入档案', { size: TYPE.label, color: COLOR.muted, originY: 0.5 }).setInteractive();
      bindTooltip(t, () => ({ x, y, w: t.width, h: 40 }), () => ({ title: '不计入档案', body: why ?? '' }));
      return;
    }
    const chips: { g?: Glyph; art?: (cx: number, cy: number) => void; v: string; tip: TipContent }[] = [];
    if (r.newAchievements.length > 0) chips.push({ g: 'star', v: `×${r.newAchievements.length}`, tip: { title: '新成就', body: r.newAchievements.map((id) => achievementView(id).name).join('、') } });
    for (const id of r.newPersonas) {
      const p = personaView(id);
      chips.push({ art: (cx, cy) => addPortrait(this, cx, cy, p, false, 34), v: '新', tip: { title: '解锁人设', body: p.name } });
    }
    if (r.newDifficulty !== null) {
      const d = difficultyView(r.newDifficulty);
      chips.push({ art: (cx, cy) => addBadge(this, cx, cy, d.level, 38), v: '新', tip: { title: '解锁难度', body: levelLabel(d.level, d.name) } });
    }
    const seen = r.newSeen.stocks.length + r.newSeen.friends.length + r.newSeen.items.length + r.newSeen.events.length;
    if (seen > 0) chips.push({ g: 'book', v: `+${seen}`, tip: { title: '图鉴', body: `图鉴里新点亮了 ${seen} 条` } });
    if (r.newKnowledge.length > 0) chips.push({ g: 'gift', v: `+${r.newKnowledge.length}`, tip: { title: '小知识', body: `点亮小知识 ${r.newKnowledge.length} 张` } });
    if (sum.recap.length > 0) chips.push({ g: 'bag', v: `${sum.recap.length}`, tip: { title: '这局的经历', body: sum.recap.map((l) => `· ${l}`).join('\n') } });
    if (chips.length === 0) {
      addText(this, x, y + 20, '这次空手', { size: TYPE.label, color: COLOR.muted, originY: 0.5 });
      return;
    }
    let cx = x;
    // icon 小于 34（手机）时整枚收窄：图标格 = icon + 14
    const lead = icon + 14;
    for (const c of chips.slice(0, 6)) {
      const t = addText(this, 0, 0, c.v, { size: TYPE.title, bold: true, num: true, color: COLOR.accentDark, originY: 0.5 });
      const w = lead + t.width + (icon < 34 ? 8 : 10);
      this.add.rectangle(cx, y, w, 44, COLOR.paperHi, 0.9).setOrigin(0, 0).setRounded(12).setStrokeStyle(2, COLOR.edge, 1);
      if (c.g) addGlyph(this, cx + lead / 2, y + 22, c.g, icon);
      else c.art?.(cx + lead / 2, y + 22);
      t.setPosition(cx + lead - 2, y + 22).setDepth(1);
      const hit = this.add.rectangle(cx, y, w, 44, 0xffffff, 0.001).setOrigin(0, 0).setDepth(2);
      const hx = cx;
      bindTooltip(hit, () => ({ x: hx, y, w, h: 44 }), () => c.tip);
      cx += w + 8;
    }
  }

  private tag(x: number, y: number, text: string, fill: number, w: number): void {
    addPill(this, x, y - 2, w, 26, fill);
    addText(this, x + w / 2, y + 11, text, { size: TYPE.label, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
  }

  private newTag(x: number, y: number): void {
    const pill = addPill(this, x, y - 1, 56, 20, COLOR.up);
    const t = addText(this, pill.x + 28, y + 9, '新纪录', { size: 12, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
    if (this.lively) this.tweens.add({ targets: [pill, t], alpha: { from: 1, to: 0.55 }, duration: 600, yoyo: true, repeat: 3 });
  }

  protected override render(s: GameState): void {
    sound.mood(s.phase === 'won' ? 'victory' : 'defeat');
  }

  /** 实盘结算的字：按本机的实盘记录（待结、结完、作废、出错）；说过一次就记下，开始菜单不再弹 */
  private updateLive(): void {
    const head = this.liveHead;
    const body = this.liveBody;
    const sum = this.summary;
    if (!head?.active || !body?.active || !sum?.live) return;
    const r = live.record;
    const t = r && r.seed === this.session.state.seed ? liveEndText(r, sum.won) : { head: '这局不算筹码', body: '这局没有带入筹码（或者本金已经原样退回），只是打着玩。' };
    head.setText(t.head);
    body.setText(t.body);
    setColor(head, r?.step === 'error' || r?.step === 'void' ? COLOR.danger : COLOR.accentDark);
    if (r && r.seed === this.session.state.seed && this.session.liveOk) live.markTold();
  }

  /** 进场：音效、彩带，然后依次弹出新成就、新人设、新难度（弹窗的素材在 meta 图集，先等它就绪）。 */
  override async enter(): Promise<void> {
    if (!this.summary) return;
    sound.cue({ type: this.summary.won ? 'runWon' : 'runLost' });
    if (this.summary.won) confetti(this, this.anim);
    const list = this.session.takeUnlocks(this.summary.runId, unlocksOf(this.result));
    const won = this.summary.won;
    // 不阻塞会话队列：玩家这时点「新局」也能马上走
    const unlocks = (): void => {
      if (list.length > 0) void this.showUnlocks(list, won);
    };
    // 真实行情局：每局第一次进结束页先弹"这段日子"小故事，关掉之后再弹成就和解锁（不阻塞会话队列）
    if (this.session.state.real && this.session.takeReveal(this.summary.runId)) {
      void this.anim.wait(won ? 900 : 400).then(() => {
        if (!this.sys.isActive() || !this.openReveal(unlocks)) unlocks();
      });
      return;
    }
    unlocks();
  }

  private async showUnlocks(list: Unlock[], won: boolean): Promise<void> {
    await ensureMetaArt(this.textures);
    if (!this.sys.isActive()) return;
    await this.anim.wait(won ? 700 : 300);
    if (!this.sys.isActive() || this.dialogOpen) return;
    playUnlocks(this, this.anim, list, (d) => this.trackDialog(d), () => this.session.notify());
  }

  protected override teardown(): void {
    this.room?.destroy();
  }

  protected override onKey(e: KeyboardEvent): boolean {
    if (e.code === 'Space' || e.code === 'Enter') return this.buttons.new?.press() ?? false;
    if (e.code === 'KeyR') return this.buttons.retry?.press() ?? false;
    if (e.code === 'KeyV') return this.buttons.reveal?.press() ?? false;
    if (e.code === 'Escape') return this.buttons.menu?.press() ?? false;
    return false;
  }

  override controls(): Record<string, { x: number; y: number }> {
    const out: Record<string, { x: number; y: number }> = {};
    for (const [k, b] of Object.entries(this.buttons)) out[k] = b.center();
    return out;
  }
}
