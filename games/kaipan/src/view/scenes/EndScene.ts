import { achievementHints, achievementView, canChallenge, challengeScore, dailyBoardId, difficultyView, formatMoney, formatPoints, personaView, storyView, runSummary, stocksOf, stockCard, type AchievementHint, type GameState, type RunSummary } from '../../core/index.ts';
import { RevealPanel } from '../meta/revealPanel.ts';
import { BoardPanel } from '../meta/boardPanel.ts';
import { onBoardChange, retryRun, runBoard } from '../dailyBoard.ts';
import { goLobby, lobbyLabel } from '../lobby.ts';
import { live, onLiveChange } from '../live.ts';
import { chips, liveEndText } from '../liveText.ts';
import { setColor } from '../ui/text.ts';
import { bestKey, isDifficultyUnlocked, isPersonaUnlocked, loadProfile, type Profile, type RecordResult } from '../../platform/profile.ts';
import { ensureMetaArt, hasArt, queueLazy, stockKey, type Glyph } from '../assets.ts';
import { addBackdrop } from '../fx/effects.ts';
import { confetti, fireworks, rainCloud } from '../fx/particles.ts';
import { bestText, boardLine, boardScoreText, dailyTag, dailyText, endSubtitle, ledgerRows, levelLabel, summaryRows, tradeWord } from '../labels.ts';
import { funSetup, loadLastSetup, saveLastSetup } from '../meta/prefs.ts';
import { playUnlocks } from '../meta/unlockDialog.ts';
import { unlocksOf, type Unlock } from '../meta/unlocks.ts';
import { randomSeed, type Session } from '../session.ts';
import { sound } from '../sound.ts';
import { COLOR, GAME_WIDTH, PHONE, TYPE, arrowOf, mixColor, signColor } from '../theme.ts';
import { addGlyph, addPaper, addPill } from '../ui/art.ts';
import { bindTooltip, type TipContent } from '../ui/tooltip.ts';
import { statTile, tipOnButton } from '../meta/bits.ts';
import { addBadge, addPortrait } from '../meta/setupPanel.ts';
import { Button } from '../ui/button.ts';
import { moneyShort } from '../ui/dialog.ts';
import { StockGuy } from '../ui/stockGuy.ts';
import { addText, fitWidth } from '../ui/text.ts';
import type Phaser from 'phaser';
import { Room } from '../trade/room.ts';
import { END_CUTSCENE_MS } from '../trade/billTiming.ts';
import { coverOf, phoneLayout, viewOf } from '../viewport.ts';
import { gameLink, shareArt, shareData } from '../shareCard.ts';
import { onChallengeChange, readChallenge, retryChallengeEnd, runChallenge, startChallenge } from '../challenge.ts';
import { ChallengeLinkDialog, ChallengePanel } from '../meta/challengePanel.ts';
import type { ChallengeFail } from '../../platform/challenge.ts';
import { cloudUserId } from '../cloudSync.ts';
import { standalone } from '../../platform/mode.ts';
import { prepareShare, type PreparedShare } from 'arcade-kit/share';
import { myName } from '../../platform/mode.ts';
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
  /** 战绩格竖排（小图标和标签一行、数字一行，手机窄屏）；月份轨道一格的间距 */
  stacked: boolean;
  trackPitch: number;
  /** 账单轨道离「收获」、最好成绩 / 经历 / 排行榜 / 下次试试离轨道的距离 */
  dy: { track: number; best: number; recap: number; row: number; hint: number };
}

const DESK_GEO: Geo = {
  x: GAME_WIDTH / 2 - W / 2, y: 60, w: W, h: H, pad: 40, leftW: 420, headY: 46, portrait: 40, badge: 36, titleY: 86, titleSize: 40, moneySize: 40, wallet: 44,
  boxW: 400, guyMax: 180, boxBottom: 40, mx: 480, rightW: 404, tileCols: 2, tw: 196, tileIcon: 40, tileSize: TYPE.title + 2, tileGap: 12,
  gainsInline: false, chipIcon: 34, btnH: 50, btnBottom: 74, stacked: false, trackPitch: 31,
  dy: { track: 98, best: 44, recap: 92, row: 114, hint: 150 },
};
/**
 * 手机横屏（0.19.1 按世界宽度，718–960×404）：纸卡 = 整屏弹窗大小（SE 702×392，宽屏 940×392）；
 * 左栏标题、账户、最赚的一笔收小一号，宽 290–380；右栏战绩 3 × 2，一格不到 140 宽时竖排，
 * 「收获」两个字和图标并在一行，按钮 46 高，按右栏宽度分。
 */
function phoneGeo(V: { w: number; h: number }): Geo {
  const w = Math.min(940, V.w - 16);
  const h = Math.min(430, V.h - 12);
  const pad = w >= 900 ? 24 : 20;
  const leftW = Math.max(290, Math.min(380, Math.round(w * 0.42)));
  const mx = pad + leftW + 20;
  const rightW = w - mx - 16;
  const tileGap = 8;
  const tw = Math.floor((rightW - tileGap * 2) / 3);
  const stacked = tw < 140;
  return {
    x: Math.round((V.w - w) / 2), y: Math.round((V.h - h) / 2), w, h, pad, leftW, headY: 34, portrait: 34, badge: 30, titleY: 58, titleSize: 32, moneySize: 32, wallet: 36,
    boxW: leftW, guyMax: 120, boxBottom: 34, mx, rightW, tileCols: 3, tw, tileIcon: stacked ? 20 : 32, tileSize: TYPE.title, tileGap,
    gainsInline: true, chipIcon: 30, btnH: 46, btnBottom: 56, stacked, trackPitch: Math.min(31, Math.floor((rightW - 44) / 12)),
    dy: { track: 52, best: 40, recap: 84, row: 98, hint: 132 },
  };
}

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

  /** 直接从存档打开结束页（没进过对局）时，补上小屋延伸出来的那圈和雨天图层。 */
  preload(): void {
    queueLazy(this.load, this.textures);
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
    // 通关是傍晚的暖光，出局是夜里
    this.room.setTime(sum.won ? 'dusk' : 'night', null);
    addBackdrop(this, 0.35).disableInteractive();
    const G = phoneLayout(this) ? phoneGeo(viewOf(this)) : DESK_GEO;
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
    // 0.16.0 手机上「大厅」回到左上角（和别的画面一样），头像那一行往右让出它的位置
    const hx = ph ? 104 : 0;
    // 手机窄屏上一行放不下「大厅 + 头像 + 级别 + 通关 + 每日挑战/实盘」：有第二枚标签时不放头像和级别（悬停里有）
    const second = sum.daily || lv0;
    const faces = !(ph && second && hx + 84 + 74 + 120 > G.leftW);
    if (faces) {
      addPortrait(this, L + hx + 22, hy, { id: sum.persona, name: sum.personaName }, false, G.portrait);
      addBadge(this, L + hx + 22 + G.badge + 8, hy, lv.level, G.badge);
    }
    const pillX = L + hx + (!faces ? 0 : ph ? 84 : 96);
    const who = this.add.rectangle(L + hx, hy - 28, faces ? 90 : 64, 56, 0xffffff, 0.001).setOrigin(0, 0);
    bindTooltip(who, () => ({ x: L + hx, y: hy - 28, w: faces ? 90 : 64, h: 56 }), () => ({ title: '这一局', body: setup }));
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
    // 手机窄屏框只有 290 宽：小人按右边一列（约 170）让出来的宽度缩，不出框
    const guySize = Math.min(G.guyMax, boxH - (ph ? 24 : 40), boxW - 20 - 170 - 16);
    const groupW = guySize + 20 + 170;
    const guyX = L + (boxW - groupW) / 2 + guySize / 2;
    const guyFeet = boxY + (boxH + guySize) / 2 + 4;
    const colX = guyX + guySize / 2 + 20;
    const stack: { h: number; draw: (yy: number) => void }[] = [];
    if (sum.bestTrade) {
      const card = stockCard(s, sum.bestTrade.stockId);
      new StockGuy(this, guyX, guyFeet, card.id, sum.bestTrade.ret >= 0 ? 'limitup' : 'worried', guySize, { idle: this.lively });
      const ret = sum.bestTrade.ret;
      // 0.18.1 每一笔都亏的局，不说「最赚」
      stack.push({ h: 22, draw: (yy) => addText(this, colX, yy + 11, ret >= 0 ? '最赚的一笔' : '亏得最少的一笔', { size: TYPE.label, color: COLOR.muted, originY: 0.5 }) });
      stack.push({
        h: 34,
        draw: (yy) => {
          addGlyph(this, colX + 12, yy + 17, 'trophy', 26);
          addText(this, colX + 30, yy + 17, card.name, { size: TYPE.title, bold: true, originY: 0.5 });
        },
      });
      stack.push({ h: ph ? 40 : 46, draw: (yy) => addText(this, colX, yy + (ph ? 20 : 23), `${arrowOf(ret)}${formatPoints(Math.abs(ret), 1, false)}`, { size: ph ? TYPE.big : TYPE.big + 6, bold: true, num: true, color: signColor(ret), originY: 0.5 }) });
      // 0.18.0 电脑上框里地方大：再写一行最亏的一笔（以前框里只有一只小人）
      const worst = s.stats.trades.reduce<(typeof s.stats.trades)[number] | null>((w, t) => (!w || t.ret < w.ret ? t : w), null);
      if (!ph && worst && worst.ret < -5 && worst.stockId !== sum.bestTrade.stockId) {
        const wn = stockCard(s, worst.stockId).name;
        stack.push({ h: 30, draw: (yy) => addText(this, colX, yy + 15, `最亏：${wn} ${arrowOf(worst.ret)}${formatPoints(Math.abs(worst.ret), 1, false)}`, { size: TYPE.label, bold: true, color: signColor(worst.ret), originY: 0.5 }) });
      }
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
    const th = G.stacked ? 54 : G.tileIcon + 16;
    const rowGap = ph ? 8 : 10;
    const cols = G.tileCols;
    const tgx = G.tileGap;
    const ty0 = y + (ph ? 16 : 28);
    // 竖排的窄格里金额写短的（「¥5479.9万」），全数在悬停
    const money = (v: number, sign = false): string => (G.stacked ? moneyShort(v, sign) : formatMoney(v, sign ? { sign: true } : undefined));
    const tiles: [Glyph, string, string, number?][] = [
      ['calendar', `${sum.billsPaid}/${months}`, '还上', sum.won ? COLOR.accentDark : undefined],
      ['wallet', money(sum.peakAccount), '最高'],
      ['bolt', `${sum.limitUpDays}天`, '涨停'],
      ['arrow_up', sum.maxBoards > 1 ? `${sum.maxBoards}天` : '–', '连涨停'],
      ['horn', `${sum.chains}次`, '带小弟'],
    ];
    tiles.forEach(([g, v, label, color], i) => {
      const tx = mx + (i % cols) * (tw + tgx);
      const ty = ty0 + Math.floor(i / cols) * (th + rowGap);
      statTile(this, tx, ty, g, v, label, { w: tw, icon: G.tileIcon, size: G.tileSize, color, tint: g === 'arrow_up' ? COLOR.up : undefined, stacked: G.stacked });
    });
    // 第 6 格：炒股本身净赚多少（0.5.4：以前是"最好 0/12"，没计入档案时看不懂；最好成绩挪到下面那一行）
    {
      const tx = mx + ((tiles.length) % cols) * (tw + tgx);
      const ty = ty0 + Math.floor(tiles.length / cols) * (th + rowGap);
      const tm = sum.tradeMoney;
      // 0.18.1 亏了写「炒股净亏 ¥325万」（以前写「炒股净赚 −¥325万」，和副标题对不上）
      const word = tm === null ? '炒股净赚' : tradeWord(tm);
      const v = tm === null ? '–' : tm < 0 ? money(-tm) : money(tm, true);
      statTile(this, tx, ty, tm !== null && tm < 0 ? 'arrow_down' : 'arrow_up', v, word, { w: tw, icon: G.tileIcon, size: G.tileSize, color: tm === null ? undefined : signColor(tm), tint: tm === null ? undefined : signColor(tm), stacked: G.stacked });
      const hit = this.add.rectangle(tx, ty, tw, th, 0xffffff, 0.001).setOrigin(0, 0);
      bindTooltip(hit, () => ({ x: tx, y: ty, w: tw, h: th }), () => ({
        title: word,
        body:
          tm === null
            ? '这局是旧版本开的，没有记下炒股合计。'
            : `每天收盘股票带来的赚亏，加上买入的手续费和持股分红（不算账单、利息和奖励）。\n${ledgerRows(sum).map(([k, v]) => `${k} ${v}`).join('\n')}\n称号按炒股净赚是本钱的几倍来定。`,
      }));
    }
    const rowsN = Math.ceil((tiles.length + 1) / cols);
    const gw = tw * cols + tgx * (cols - 1);
    const gridHit = this.add.rectangle(mx, ty0, gw, rowsN * th + (rowsN - 1) * rowGap, 0xffffff, 0.001).setOrigin(0, 0).setDepth(-1);
    bindTooltip(gridHit, () => ({ x: mx, y: ty0, w: gw, h: rowsN * (th + rowGap) }), () => ({ title: '这一局', body: summaryRows(sum).map(([k, v]) => `${k}：${v}`).join('\n') }));

    // ---- 收获：图标 + 数字（名字在悬停）；手机上「收获」两个字和图标并在一行
    const gy = ty0 + rowsN * (th + rowGap) + (ph ? 4 : 16);
    const gl = addText(this, mx, ph ? gy + 22 : gy, '收获', { size: TYPE.title, bold: true, originY: ph ? 0.5 : 0 });
    const gx = ph ? mx + gl.width + 10 : mx;
    this.gains(gx, ph ? gy : gy + 34, sum, G.chipIcon, mx + G.rightW - gx);

    // ---- 12 个月账单轨道（0.5.1）：还上的绿格、没还上的红格、没走到的灰格；实盘只有 6 格
    // 0.18.0 屏幕材质（art-v3：数字在跳的地方用夜蓝小屏）：整条放在一块小屏上，每格上面一根这个月账户涨跌的小柱
    const ky = gy + G.dy.track;
    const P = G.trackPitch;
    const trackW = 34 + months * P + 6;
    const barH = ph ? 8 : 14;
    const rets = s.stats.monthRets;
    const maxRet = Math.max(1, ...rets.map((r) => Math.abs(r)));
    this.add.rectangle(mx - 4, ky - barH - 8, trackW, barH + 8 + 34, COLOR.screen).setOrigin(0, 0).setRounded(10).setStrokeStyle(2, COLOR.ink, 1);
    addGlyph(this, mx + 14, ky + 14, 'house', 22);
    const bars = this.add.graphics();
    for (let m = 0; m < months; m++) {
      const px = mx + 34 + m * P;
      const paid = m < sum.billsPaid;
      const failed = !sum.won && m === sum.billsPaid;
      const fill = paid ? 0x1f6f4a : failed ? 0x6a2430 : 0x2e3d4f;
      const edge = paid ? 0x45d68f : failed ? 0xff6b6b : 0x3e5066;
      const box = this.add.rectangle(px, ky, P - 4, 28, fill).setOrigin(0, 0).setRounded(7).setStrokeStyle(1.5, edge, 1);
      addText(this, px + (P - 4) / 2, ky + 14, `${m + 1}`, { size: paid || failed ? 13 : 11, bold: true, num: true, color: paid ? 0xc8ffe0 : failed ? 0xffd2cc : 0x8a9bb0, originX: 0.5, originY: 0.5 });
      const r = rets[m];
      if (r !== undefined && Math.abs(r) >= 0.5) {
        const h = Math.max(2, (Math.abs(r) / maxRet) * barH);
        bars.fillStyle(mixColor(signColor(r), 0xffffff, 0.25), 1).fillRoundedRect(px + (P - 4) / 2 - 5, ky - 3 - h, 10, h, 2);
      }
      if (this.lively && (paid || failed)) {
        box.setScale(0.2);
        this.tweens.add({ targets: box, scale: 1, duration: 200, delay: 40 * m, ease: 'Back.easeOut' });
      }
    }
    const trackHit = this.add.rectangle(mx - 4, ky - barH - 8, trackW, barH + 42, 0xffffff, 0.001).setOrigin(0, 0);
    bindTooltip(trackHit, () => ({ x: mx - 4, y: ky - barH - 8, w: trackW, h: barH + 42 }), () => ({
      title: '每个月',
      body: `格子：这个月的账单还上了（绿）、没还上（红）、没走到（灰）。\n小柱：这个月炒股让账户涨了还是跌了，越高越多。\n${rets.map((r, i) => `${i + 1}月 ${formatPoints(r, 1)}`).join('　')}`,
    }));
    // 实盘：最好成绩、经历两行的位置换成结算的说明（实盘局不进最好成绩）
    if (lv0) {
      this.liveBody = addText(this, mx + 12, ky + G.dy.best, '', { size: TYPE.label, color: COLOR.ink, wrap: ph ? G.rightW - 24 : 392, lineSpacing: 3 });
      this.updateLive();
      const off = onLiveChange(() => this.updateLive());
      this.events.once('shutdown', off);
    } else {
      // 最好成绩 / 今日挑战一句（0.5 只在悬停，0.5.1 放回来）
      const best = profile.best[bestKey(sum.persona, sum.difficulty, sum.short)];
      const line = sum.daily ? `今日挑战：${dailyText(profile.daily[sum.daily])}` : `${sum.personaName}·${sum.difficulty}级${sum.short ? '短局' : ''}最好：${bestText(best)}`;
      addGlyph(this, mx + 12, ky + G.dy.best + 8, 'trophy', 22);
      const lw = ph ? G.rightW - 100 : 380;
      const lt = addText(this, mx + 30, ky + G.dy.best, line, { size: TYPE.label, color: COLOR.ink, wrap: lw, lineSpacing: 2 });
      if (sum.daily ? this.result?.newDaily : this.result?.newBest) this.newTag(Math.min(mx + 30 + lt.width + 8, mx + lw + 20), ky + G.dy.best - 8);
    }
    // 这局的经历（借钱、押跌……）：最多两条，整段在「收获」的包里；每日挑战第二条的位置给排行榜（0.5.10）
    const board = sum.daily ? sum.daily : null;
    // 0.13.0 好友挑战那一行占同一个位置（挑战局不会是每日挑战）：挑战局交成绩；能发起的局（娱乐局、计入了档案、登录了）放「挑战好友」
    const chal = !board && (runChallenge(s.seed) !== null || (canChallenge(s) && !!this.result && !this.result.ignored && cloudUserId() !== null && !standalone()));
    const row = !!board || chal;
    sum.recap.slice(0, lv0 ? 0 : row ? 1 : 2).forEach((l, i) => {
      const t = addText(this, mx + 30, ky + G.dy.recap + i * 22, l, { size: TYPE.label - 1, color: COLOR.muted });
      let cut = Array.from(t.text);
      const rw = ph ? G.rightW - 40 : 380;
      while (t.width > rw && cut.length > 6) {
        cut = cut.slice(0, -2);
        t.setText(`${cut.join('')}…`);
      }
      addGlyph(this, mx + 12, ky + G.dy.recap + 8 + i * 22, 'bag', 16);
    });

    if (board) this.boardRow(mx, ky + G.dy.row, ph ? G.rightW : 404, sum.runId, board);
    else if (chal) this.challengeRow(mx, ky + G.dy.row, ph ? G.rightW : 404, sum);

    // 0.6.8 下次可以试试：离得最近的一两个成就和这局的进度。只在娱乐局放（实盘局不在筹码局里推"再来"，economy.md 第 0 节），
    // 只说成就进度，不提输赢和筹码；放不下（手机上经历多了）就不放
    if (!lv0) {
      const hy = row ? ky + G.dy.hint : ky + G.dy.recap + Math.min(sum.recap.length, 2) * 22;
      const hints = achievementHints(s, Object.keys(profile.achievements));
      if (hints.length > 0 && hy + 20 <= y + H - G.btnBottom - 6) this.hintRow(mx, hy, ph ? G.rightW - 40 : 380, hints);
    }

    const by = y + H - G.btnBottom;
    const mk = (key: string, label: string, bx: number, w: number, variant: 'primary' | 'default', fn: () => void, hotkey?: string): void => {
      this.buttons[key] = new Button(this, bx, by, { width: w, height: G.btnH, label, variant, fontSize: 16, hotkey, onClick: fn });
    };
    // 手机：三个按钮加「分享」撑满右栏（350–500 宽），手指好点；中间的「新一局」宽一点
    const shareW = ph ? (G.stacked ? 76 : 102) : 132;
    const rest = G.rightW - shareW - 36;
    const bw = ph ? [Math.floor(rest * 0.3), rest - 2 * Math.floor(rest * 0.3), Math.floor(rest * 0.3)] : [120, 150, 110];
    const liveW = ph ? Math.min(180, G.rightW - 12 - 140) : bw[1]!;
    // 实盘局只有一个「回开始菜单」：不在结束页推"再开一局"（设计稿第 5 节），同种子重玩也会开出一局没带入的实盘
    if (lv0) mk('menu', '回开始菜单', mx + (ph ? 0 : bw[0]! + 12), liveW, 'primary', () => this.session.toTitle(), 'Esc');
    else {
      mk('retry', sum.daily ? '再挑战' : '重玩', mx, bw[0]!, 'default', () => this.session.newRun(s.seed, s.setup), 'R');
      mk('new', '新一局', mx + bw[0]! + 12, bw[1]!, 'primary', () => this.newRun(sum, profile), '空格');
      mk('menu', '主菜单', mx + bw[0]! + bw[1]! + 24, bw[2]!, 'default', () => this.session.toTitle(), 'Esc');
    }
    const retry = this.buttons.retry;
    if (retry) tipOnButton(retry, () => ({ x: mx, y: by, w: bw[0]!, h: G.btnH }), () => ({ title: sum.daily ? '再挑战一次' : '同一局再来', body: `这一局的编号：${s.seed}\n输入同一个编号能重玩同一局` }));
    addText(this, x + G.pad, y + H - (ph ? 17 : 26), `#${s.seed}`, { size: 12, color: COLOR.dim, originY: 0.5 });
    // 回大厅（0.5.8）：和开始菜单一样在左上角；这局已经结束、记进档案了，点了直接走。
    // 手机横屏纸卡几乎铺满：放在纸卡的左上角（0.16.0 以前插在左栏标题行中间）
    const lobbyAt = ph ? { x: x + 10, y: y + 12 } : { x: 14, y: 10 };
    this.buttons.lobby = new Button(this, lobbyAt.x, lobbyAt.y, { width: ph ? 96 : 104, height: 42, label: lobbyLabel(), icon: 'house', fontSize: 16, onClick: () => goLobby() });
    // 分享（0.6.5 起的海报位置，0.12.0 换成共用包的分享卡）：电脑上放在右上角（和「大厅」对称），手机上放在按钮那一排的最右边
    const shareAt = ph ? { x: mx + (lv0 ? liveW + 12 : bw[0]! + bw[1]! + bw[2]! + 36), y: by, w: lv0 ? 140 : shareW, h: G.btnH } : { x: GAME_WIDTH - 14 - 132, y: 10, w: 132, h: 42 };
    this.shareButton(shareAt, sum);
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
   * 「分享」（0.12.0，docs/design-share.md）：数据交给共用包画卡、分享；手机能带图片就调系统分享，不能就出预览（存图、复制链接）。
   * 0.12.1 起结束页一出来就先画好（共用包 prepareShare）：iOS 只许在点的那一下里调系统分享，点了再画就过期了、只能出预览。
   * 所以点击里直接调 share()，前面不能有 await。每日挑战读到名次后再画一张带名次的，画好了才换上，之前点分享的是手上那张。
   */
  private shareButton(at: { x: number; y: number; w: number; h: number }, sum: RunSummary): void {
    const label = '分享';
    const prepare = (rank: number | null): PreparedShare => {
      const { artKey, text, ...card } = shareData(sum, rank);
      const name = myName();
      const art = shareArt(this.textures, artKey);
      return prepareShare(
        { ...card, ...(art && { art }), ...(name && { player: { name, badge: sum.title } }) },
        { url: gameLink(location.href), text, fileName: `kaipan-${sum.seed}.png` },
      );
    };
    const rankNow = (): number | null => {
      const r = sum.daily ? runBoard(sum.runId) : null;
      return r?.state === 'done' && r.rank ? r.rank : null;
    };
    let shown = rankNow();
    let prepared = prepare(shown);
    const b = new Button(this, at.x, at.y, { width: at.w, height: at.h, label, icon: 'star', fontSize: 16, onClick: () => {
      void prepared.share().then((res) => b.scene && res !== 'cancelled' && sound.ui('select'), () => b.scene && sound.ui('denied'));
    } });
    // 画好之前转圈（一般几百毫秒）；画不出来也放开，点了由共用包出预览或报错
    b.setLoading(true, '画卡片');
    void prepared.ready.then(() => b.scene && b.setLoading(false, label));
    this.buttons.share = b;
    if (!sum.daily) return;
    const update = (): void => {
      const rank = rankNow();
      if (!rank || rank === shown || !b.scene) return;
      shown = rank;
      const next = prepare(rank);
      void next.ready.then(() => {
        if (shown === rank) prepared = next;
      });
    };
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

  /**
   * 0.13.0 好友挑战的一行：挑战局写交成绩的状态和「看成绩」；别的娱乐局写一句邀请和「挑战好友」（点了交给平台、拿链接）。
   * 交成绩是异步的，状态变了只重画这一行。
   */
  private challengeRow(x: number, y: number, w: number, sum: RunSummary): void {
    const s = this.session.state;
    const box = this.add.container(0, 0);
    const keys = ['challenge', 'challenge:results', 'challenge:retry'];
    const line = (text: string, good = false): void => {
      const t = addText(this, x + 30, y + 13, text, { size: TYPE.label - 1, bold: good, color: good ? COLOR.accentDark : COLOR.muted, originY: 0.5 });
      fitWidth(t, w - 30 - 108 - (this.buttons['challenge:retry'] ? 72 : 0));
      box.add([addGlyph(this, x + 12, y + 13, 'trophy', 18), t]);
    };
    const button = (key: string, label: string, bx: number, bw: number, fn: () => void): Button => {
      const b = new Button(this, bx, y - 4, { width: bw, height: 34, label, fontSize: 14 });
      b.setHandler(fn);
      box.add(b);
      this.buttons[key] = b;
      return b;
    };
    const draw = (): void => {
      box.removeAll(true);
      for (const k of keys) delete this.buttons[k];
      const r = runChallenge(s.seed);
      if (!r) {
        line('发给好友，同一局比一比');
        const b = button('challenge', '挑战好友', x + w - 100, 100, () => {
          b.setLoading(true, '建挑战');
          void startChallenge(s, sum).then((c) => {
            if (!b.scene) return;
            b.setLoading(false, c.ok ? '挑战好友' : CHALLENGE_SEND_FAIL[c.why]);
            if (c.ok && !this.dialogOpen) this.trackDialog(new ChallengeLinkDialog(this, c.url, `开盘挑战：我${boardScoreText(challengeScore(sum))}，同一局你来试试`));
          });
        });
        return;
      }
      const open = button('challenge:results', '看成绩', x + w - 100, 100, () => {
        open.setLoading(true, '读成绩');
        void readChallenge(r.id).then((v) => {
          if (!open.scene) return;
          open.setLoading(false, v.ok ? '看成绩' : '没读到');
          if (v.ok && !this.dialogOpen) this.trackDialog(new ChallengePanel(this, v.view));
        });
      });
      open.setEnabled(r.state === 'done');
      if (r.state === 'error' && r.why !== 'gone' && r.why !== 'full') button('challenge:retry', '重试', x + w - 100 - 72, 64, () => retryChallengeEnd(s, sum));
      if (r.state === 'sending') line(`正在把成绩交给 ${r.owner} 的挑战……`);
      else if (r.state === 'error') line(CHALLENGE_END_FAIL[r.why]);
      else {
        const me = r.view?.me;
        const where = me ? `挑战里第 ${me.rank ?? '—'} 名 · 共 ${r.view?.count ?? 1} 人` : '成绩交上了';
        line(r.already ? `之前交过，只算第一次：${where}` : where, !r.already);
      }
    };
    draw();
    const off = onChallengeChange(() => box.active && draw());
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
    const want = sum.daily || !sum.ranked || this.result?.ignored ? loadLastSetup() : { persona: sum.persona, difficulty: sum.difficulty, short: sum.short };
    const setup = {
      persona: isPersonaUnlocked(profile, want.persona) ? want.persona : 'newbie',
      difficulty: isDifficultyUnlocked(profile, want.difficulty) ? want.difficulty : 1,
      short: want.short,
    } as const;
    saveLastSetup(setup);
    this.session.newRun(randomSeed(), funSetup(setup));
  }

  /** 本局新达成的成就、新解锁的人设和难度、点亮的图鉴：一排图标 + 数字，名字在悬停；没计入档案时一行短话（原因在悬停）。 */
  private gains(x: number, y: number, sum: RunSummary, icon = 34, room = Infinity): void {
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
    const list = chips.slice(0, 6);
    for (const [i, c] of list.entries()) {
      const t = addText(this, 0, 0, c.v, { size: TYPE.title, bold: true, num: true, color: COLOR.accentDark, originY: 0.5 });
      const w = lead + t.width + (icon < 34 ? 8 : 10);
      // 手机窄屏放不下的几枚收成一个「+N」，悬停里逐条写
      const left = list.slice(i);
      if (left.length > 1 && cx + w + 8 + 52 > x + room) {
        t.destroy();
        this.moreChip(cx, y, left.map((m) => m.tip));
        return;
      }
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

  private moreChip(x: number, y: number, tips: readonly TipContent[]): void {
    const t = addText(this, x + 10, y + 22, `+${tips.length}`, { size: TYPE.title, bold: true, num: true, color: COLOR.accentDark, originY: 0.5 }).setDepth(1);
    const w = Math.max(52, t.width + 20);
    this.add.rectangle(x, y, w, 44, COLOR.paperHi, 0.9).setOrigin(0, 0).setRounded(12).setStrokeStyle(2, COLOR.edge, 1);
    const hit = this.add.rectangle(x, y, w, 44, 0xffffff, 0.001).setOrigin(0, 0).setDepth(2);
    bindTooltip(hit, () => ({ x, y, w, h: 44 }), () => ({ title: '还有', body: tips.map((tp) => `${tp.title}：${tp.body}`).join('\n') }));
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

  /** 0.11.0 实盘结回 ≥ 3 倍：屏幕正中一行大字弹出来，两秒后收起（点哪儿都不挡） */
  private celebrate(bp: number, gear: number): void {
    sound.cue({ type: 'settle', ret: 5 });
    confetti(this, this.anim);
    const V = viewOf(this);
    const t = addText(this, V.w / 2, V.h / 2, `杠杆 ×${gear}　结回 ${(bp / 10_000).toFixed(1)} 倍！`, {
      size: PHONE ? 40 : 52,
      bold: true,
      color: COLOR.accentDark,
      originX: 0.5,
      originY: 0.5,
      stroke: 0xfff6e6,
      strokeWidth: 10,
    }).setDepth(500);
    t.setName('end:celebrate');
    if (this.anim.instant) {
      this.time.delayedCall(2200, () => t.destroy());
      return;
    }
    t.setScale(0.3);
    this.tweens.add({ targets: t, scale: 1, duration: 420, ease: 'Back.Out' });
    this.tweens.add({ targets: t, alpha: 0, delay: 2200, duration: 500, onComplete: () => t.destroy() });
  }

  /** 实盘结算的字：按本机的实盘记录（待结、结完、作废、出错）；说过一次就记下，开始菜单不再弹 */
  private updateLive(): void {
    const head = this.liveHead;
    const body = this.liveBody;
    const sum = this.summary;
    if (!head?.active || !body?.active || !sum?.live) return;
    const r = live.record;
    const t = r && r.seed === this.session.state.seed ? liveEndText(r, sum.won, sum.live ? { x: sum.live.gear, margin: sum.live.margin } : undefined) : { head: '这局不算筹码', body: '这局没有带入筹码（或者本金已经原样退回），只是打着玩。' };
    head.setText(t.head);
    body.setText(t.body);
    setColor(head, r?.step === 'error' || r?.step === 'void' ? COLOR.danger : COLOR.accentDark);
    if (r && r.seed === this.session.state.seed && this.session.liveOk) live.markTold();
  }

  /** 进场：音效、彩带，然后依次弹出新成就、新人设、新难度（弹窗的素材在 meta 图集，先等它就绪）。 */
  override async enter(): Promise<void> {
    if (!this.summary) return;
    sound.cue({ type: this.summary.won ? 'runWon' : 'runLost' });
    await this.cutscene(this.summary.won);
    if (this.summary.won) confetti(this, this.anim);
    // 0.11.0 实盘结回 ≥ 3 倍：大字庆祝、再放一次彩带和大赚的音效
    const lv = this.summary.live;
    if (lv && lv.bp >= 30_000) this.celebrate(lv.bp, lv.gear);
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

  /**
   * 0.17.0 结束页出场前的过场（art-v3 第 5 节）：通关放烟花、出局下雨，一行大字，1.2 秒后收起；点一下跳过。
   * 一局只有一次；关掉动画、「减少动态效果」时不放。过场时盖一层挡板，免得误点到下面的按钮。
   */
  private async cutscene(won: boolean): Promise<void> {
    const a = this.anim;
    if (a.instant || !this.lively) return;
    a.begin();
    const V = viewOf(this);
    const cv = coverOf(this);
    const block = this.add.rectangle(cv.x, cv.y, cv.w, cv.h, COLOR.ink, won ? 0.25 : 0.4).setOrigin(0, 0).setDepth(390).setInteractive();
    const big = addText(this, V.w / 2, V.h / 2 - 24, won ? '通关！' : '出局', {
      size: PHONE ? 60 : 76,
      bold: true,
      color: won ? COLOR.accent : 0xe2d8e6,
      originX: 0.5,
      originY: 0.5,
      stroke: COLOR.ink,
      strokeWidth: 10,
    }).setDepth(395);
    const sub = addText(this, V.w / 2, V.h / 2 + 40, won ? '带着钱上岸了' : '这一局到这儿了', { size: TYPE.title + 4, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5, stroke: COLOR.ink, strokeWidth: 6 }).setDepth(395);
    a.fx({ targets: [big, sub], scale: { from: 0.4, to: 1 }, duration: 360, ease: 'Back.Out' }, () => [big, sub].forEach((t) => t.setScale(1)));
    if (won) [[0.25, 0.3], [0.75, 0.28], [0.5, 0.18]].forEach(([fx, fy], i) => this.time.delayedCall(i * 220, () => this.sys.isActive() && fireworks(this, a, V.w * fx!, V.h * fy!, true)));
    else [0.3, 0.55, 0.78].forEach((fx, i) => rainCloud(this, a, V.w * fx, V.h * (0.22 + (i % 2) * 0.06)));
    await a.wait(END_CUTSCENE_MS);
    const parts = [block, big, sub];
    a.fx({ targets: parts, alpha: 0, duration: 200 }, () => parts.forEach((p) => p.destroy()));
    if (a.instant) parts.forEach((p) => p.active && p.destroy());
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

/** 发起没成：按钮上写一句（下一次点照样能发） */
const CHALLENGE_SEND_FAIL: Record<ChallengeFail, string> = {
  out: '先登录',
  gone: '发不了',
  full: '发不了',
  limit: '今天发够了',
  busy: '服务器忙',
  offline: '没连上',
  bug: '发不了',
};

/** 挑战局交成绩没成：那一行写什么 */
const CHALLENGE_END_FAIL: Record<ChallengeFail, string> = {
  out: '登录后才能交挑战的成绩',
  gone: '这个挑战已经打不开了（过期了），成绩没交上',
  full: '这个挑战已经满 100 人了，成绩没交上',
  limit: '服务器今天有点忙，挑战的成绩没交上',
  busy: '服务器今天有点忙，挑战的成绩没交上',
  offline: '没连上，挑战的成绩没交上',
  bug: '挑战的成绩没交上',
};
