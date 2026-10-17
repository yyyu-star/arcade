import Phaser from 'phaser';
import { BALANCE, bankView, billView, calendarView, formatMoney, fx, itemView, monthThemeView, runMonths, shortGoal, topBar, type GameState, type ItemView, type Mood } from '../../core/index.ts';
import { goalShort, stamp } from './tempoFx.ts';
import type { Animator } from '../fx/anim.ts';
import { flashBox, floatText, pop } from '../fx/effects.ts';
import { sparkles } from '../fx/particles.ts';
import { billLine, billStatus, dailyTag, dayLabel, levelHint, shortItemName } from '../labels.ts';
import type { Rect } from '../rect.ts';
import { sound } from '../sound.ts';
import { COLOR, ITEM_KIND_COLOR, PHONE, TYPE, signColor, textOn } from '../theme.ts';
import { hasArt, itemKey } from '../assets.ts';
import { addGlyph, addImage, addPill, addWood } from '../ui/art.ts';
import { Button } from '../ui/button.ts';
import { addText, fitWidth, setColor } from '../ui/text.ts';
import { bindTooltip } from '../ui/tooltip.ts';
import { MOOD_WORD, term } from '../glossary.ts';

/** 大环境方向：只决定顶栏箭头和颜色（文字说明在日历提示里）。 */
const MOOD_SIGN: Record<Mood, number> = { bull: 1, flat: 0, bear: -1 };
import { TOP } from './layout.ts';
import { isLiveRun, marginWarn } from '../live.ts';
import { chips, levText } from '../liveText.ts';
import { lobbyLabel } from '../lobby.ts';

/**
 * 顶栏各块的位置。电脑是 1264×56 的一条；手机横屏（0.5.5）是 952×46，各块收窄、两行字往上提，字号不低于 13。
 * 0.16.0 木条：每一组都是「图标 + 大数字」一行、下面一行小字（账户的人设、Lv 也挪到数字下面），小字的中线对齐（电脑 48、手机 38）。
 * 0.9.0 账户上面那行小字离顶边留出 4 以上（以前贴着边）。
 * 0.9.2 最左边是常驻的「大厅」（小房子在上、字在下，和银行按钮一个样子），日期那一块整体右移让出位置。
 * goalX：有月度目标时「目标 + 要还的钱」那一块的左边（账户那一列收窄到 accW）；billLeft：没有目标时那一块的左边。
 */
const TB = PHONE
  ? {
      lobby: { x: 4, y: 6, w: 40, h: 40, iconDy: 13, iconS: 18 },
      calIcon: { x: 66, y: 18, s: 22 }, day: { x: 82, y: 6, size: 16 }, calPill: { x: 54, y: 29, h: 18 }, calTextX: 62, row2Y: 38,
      calHit: { x: 50, y: 4, w: 136, h: 44 }, flagsRight: 182, flagY: 29,
      accLabel: { x: 216, y: 38 }, wallet: { x: 200, y: 18, s: 24 }, account: { x: 216, y: 3, size: 22 }, accHit: { x: 186, y: 4, w: 202, h: 44 }, accWideW: 222,
      goalX: 392, billLeft: 416, billRight: 640, billBox: { y: 6, h: 40 }, hourglass: { x: 604, y: 18, s: 18 }, daysLeft: { x: 616, y: 18 },
      billY: 6, billNoteY: 38, goalIconY: 18, goalWordY: 38, goalBarY: 34, goalBarW: 90, houseY: 38, houseNoGoalY: 18, billTitleSize: 17,
      itemsX: 646, itemsY: 4, itemsW: 214, itemsWExt: 146, rowIconY: 23, rowChipY: 23, row2Y0: 11, row2H: 23, row2Icon: 21,
      bank: { x: 798, y: 6, w: 60, h: 40 }, bankIconDy: 14, bankIconS: 20,
      help: { x: 864, y: 7, w: 42, h: 38 }, settings: { x: 912, y: 7, w: 40, h: 38 }, gear: { x: 932, y: 26, r: 10 }, rollY: 48,
    }
  : {
      lobby: { x: 16, y: 10, w: 52, h: 46, iconDy: 15, iconS: 22 },
      calIcon: { x: 94, y: 26, s: 26 }, day: { x: 112, y: 14, size: TYPE.title }, calPill: { x: 84, y: 39, h: 18 }, calTextX: 92, row2Y: 48,
      calHit: { x: 78, y: 8, w: 212, h: 52 }, flagsRight: 290, flagY: 39,
      accLabel: { x: 330, y: 48 }, wallet: { x: 312, y: 26, s: 28 }, account: { x: 330, y: 7, size: 26 }, accHit: { x: 296, y: 8, w: 232, h: 52 }, accWideW: 280,
      goalX: 534, billLeft: 584, billRight: 884, billBox: { y: 10, h: 48 }, hourglass: { x: 842, y: 26, s: 20 }, daysLeft: { x: 856, y: 26 },
      billY: 14, billNoteY: 48, goalIconY: 24, goalWordY: 48, goalBarY: 44, goalBarW: 110, houseY: 48, houseNoGoalY: 26, billTitleSize: TYPE.title,
      itemsX: 896, itemsY: 10, itemsW: 258, itemsWExt: 168, rowIconY: 18, rowChipY: 24, row2Y0: 12, row2H: 26, row2Icon: 24,
      bank: { x: 1080, y: 10, w: 74, h: 46 }, bankIconDy: 17, bankIconS: 24,
      help: { x: 1172, y: 14, w: 44, h: 40 }, settings: { x: 1222, y: 14, w: 40, h: 40 }, gear: { x: 1242, y: 34, r: 11 }, rollY: 56,
    };
const ITEMS_X = TB.itemsX;
const GOAL_X = TB.goalX;
const ACC_W = TB.accHit.w;
/** 0.4 C 银行按钮：右上角"怎么玩"左边（道具栏让出位置） */
const BANK = TB.bank;
/** 有银行按钮时道具栏让出右边一截 */
const ITEMS_W_EXT = TB.itemsWExt;
const ITEMS_W = TB.itemsW;
const CHIP_W = 46;
const CHIP_H = 22;

/** 设置按钮上的齿轮（矢量绘制，省一张素材请求）。 */
function drawGear(scene: Phaser.Scene, x: number, y: number, r: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y });
  const teeth = 8;
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2;
    const outer = i % 4 === 1 || i % 4 === 2;
    const rr = outer ? r : r * 0.74;
    pts.push(new Phaser.Math.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
  }
  g.fillStyle(COLOR.ink, 1).fillPoints(pts, true);
  g.fillStyle(COLOR.paperHi, 1).fillCircle(0, 0, r * 0.36);
  return g;
}

/**
 * 顶栏：月份 · 第几天 · 日历事件（悬停看全年日历）、账户余额（大字）、
 * 「本月月供 ¥X · 还剩 N 天」（不够时变红闪烁）、道具栏（悬停看说明）、设置按钮。
 */
/** 日期行标签的右边界：「账户」那一列从 x 296 开始（见 accHit），留一点空。 */
const FLAGS_RIGHT = TB.flagsRight;
const FLAG_GAP = 6;

interface Flag {
  label: string;
  short: string;
  fill: number;
  tip: { title: string; body: string };
}

/** 顶栏日期行的标签：每日挑战、市场传闻、加班（按这个顺序）。 */
function flagList(t: ReturnType<typeof topBar>): Flag[] {
  const out: Flag[] = [];
  if (t.daily) out.push({ label: dailyTag(t.daily), short: '每日挑战', fill: COLOR.accent, tip: { title: '每日挑战', body: `${t.daily} 的每日挑战：今天所有人玩的是同一局：一样的行情、一样的人设，成绩记在当天。` } });
  if (t.notice) out.push({ label: t.notice.name, short: '市场传闻', fill: COLOR.danger, tip: { title: t.notice.name, body: t.notice.text } });
  if (t.busy) out.push({ label: '今天加班', short: '在加班', fill: 0x6e5966, tip: { title: '今天在加班', body: '顾不上炒股：今天不能买也不能卖，只能直接开盘。' } });
  return out;
}

/** 标签宽度（与 flag() 的画法一致：文字宽 + 左右各 6）。 */
function measureFlag(scene: Phaser.Scene, label: string): number {
  const t = addText(scene, 0, 0, label, { size: 11, bold: true });
  const w = t.width + 12;
  t.destroy();
  return w;
}

export class TopBarView {
  private readonly scene: Phaser.Scene;
  private readonly day: Phaser.GameObjects.Text;
  private readonly calPill: Phaser.GameObjects.Rectangle;
  private readonly calText: Phaser.GameObjects.Text;
  private readonly weather: Phaser.GameObjects.Text;
  private readonly accLabel: Phaser.GameObjects.Text;
  private readonly flags: Phaser.GameObjects.Container;
  private flagSig = '';
  private readonly account: Phaser.GameObjects.Text;
  private readonly bill: Phaser.GameObjects.Text;
  private readonly billNote: Phaser.GameObjects.Text;
  private readonly billBox: Phaser.GameObjects.Rectangle;
  private billPulse: Phaser.Tweens.Tween | null = null;
  /** 0.5：这一局有月度目标（顶栏显示目标进度） */
  private readonly tempo: boolean;
  private readonly goalBar: Phaser.GameObjects.Graphics;
  private readonly goalTag: Phaser.GameObjects.Container;
  private readonly hourglass: Phaser.GameObjects.Image;
  private readonly daysLeft: Phaser.GameObjects.Text;
  private lastDaysLeft: number | null = null;
  private readonly houseIcon: Phaser.GameObjects.Image;
  private goalSig = '';
  private readonly items: Phaser.GameObjects.Container;
  private readonly chips = new Map<string, Phaser.GameObjects.Container>();
  private readonly chipSize = new Map<string, { w: number; h: number }>();
  private itemSig: string | null = null;
  private state: GameState;
  readonly settings: Button;
  readonly help: Button;
  shownAccount = 0;

  /** 0.4 C：银行按钮（这一局有抵押玩法时才有） */
  readonly bank: Button | null;
  private bankRing: Phaser.GameObjects.Rectangle | null = null;
  private bankPulse: Phaser.Tweens.Tween | null = null;

  /** 0.9.2 左上角常驻的「大厅」（单独部署时是「首页」），点了由场景先确认再走 */
  readonly lobby: Button;

  constructor(scene: Phaser.Scene, s: GameState, onSettings: () => void, onHelp?: () => void, onBank?: () => void, onLobby?: () => void) {
    this.scene = scene;
    this.state = s;
    addWood(scene, TOP.x, TOP.y, TOP.w, TOP.h).setDepth(20);
    const d = 21;
    const L = TB.lobby;
    this.lobby = new Button(scene, L.x, L.y, { width: L.w, height: L.h, label: '', subLabel: lobbyLabel(), fontSize: 15, onClick: onLobby });
    this.lobby.setDepth(d + 1);
    addGlyph(scene, L.x + L.w / 2, L.y + L.iconDy, 'house', L.iconS).setDepth(d + 2);
    // 0.5：日历图标 + 「1月 1/5」，下面是日历事件小签和大环境箭头（说明都在悬停提示里）
    addGlyph(scene, TB.calIcon.x, TB.calIcon.y, 'calendar', TB.calIcon.s).setDepth(d);
    this.day = addText(scene, TB.day.x, TB.day.y, '', { size: TB.day.size, bold: true }).setDepth(d);
    this.calPill = addPill(scene, TB.calPill.x, TB.calPill.y, 90, TB.calPill.h, 0xffe7a8).setDepth(d);
    this.calText = addText(scene, TB.calTextX, TB.row2Y, '', { size: 12, bold: true, originY: 0.5 }).setDepth(d);
    this.weather = addText(scene, 0, TB.row2Y, '', { size: 12, bold: true, color: COLOR.muted, originY: 0.5 }).setDepth(d);
    const ch = TB.calHit;
    const calHit = scene.add.rectangle(ch.x, ch.y, ch.w, ch.h, 0xffffff, 0.001).setOrigin(0, 0).setDepth(d);
    bindTooltip(calHit, () => ({ ...ch }), () => this.calendarTip());

    this.accLabel = addText(scene, TB.accLabel.x, TB.accLabel.y, '账户', { size: 11, color: COLOR.muted, originY: 0.5 }).setDepth(d);
    addGlyph(scene, TB.wallet.x, TB.wallet.y, 'wallet', TB.wallet.s).setDepth(d);
    // 本月市场传闻（股灾预告）、今天加班：天气右边的小标签，悬停看说明
    this.flags = scene.add.container(0, 0).setDepth(d);
    this.account = addText(scene, TB.account.x, TB.account.y, '', { size: TB.account.size, bold: true, num: true }).setDepth(d);
    const ah = TB.accHit;
    const accHit = scene.add.rectangle(ah.x, ah.y, ACC_W, ah.h, 0xffffff, 0.001).setOrigin(0, 0).setDepth(d);
    bindTooltip(accHit, () => ({ x: ah.x, y: ah.y, w: ACC_W, h: ah.h }), () => {
      const t = topBar(this.state);
      const lv = t.live && isLiveRun(this.state) ? t.live : null;
      const rules = this.state.setup?.live;
      const liveLine =
        lv && rules
          ? `\n实盘：带了一份 ${chips(lv.stake)} 筹码进场，资产涨跌按 ${levText(rules.lev ?? 1)} 倍算进筹码；按现在的资产（扣掉借款）算结回约 ${chips(lv.value)}。` +
            `打完 ${rules.months} 个月按最后的资产结，最多拿回 ${BALANCE.live.cap} 份，赔光就是 0。`
          : '';
      // 0.10.0 娱乐短局：最终目标（最后一个月月底的首付）开局就说清楚
      const short = this.state.setup?.short;
      const goal = shortGoal(this.state);
      const shortLine = short && goal > 0 ? `\n短局：打 ${short.months} 个月，${short.months} 月底除了账单还要交一笔首付 ${formatMoney(goal)}，交得上就赢。` : '';
      return {
        title: `账户 · ${t.personaName}`,
        body: `第 ${t.difficulty} 级${t.difficultyName}（${levelHint(t.difficulty)}）${t.daily ? ' · 每日挑战' : ''}\n你所有的钱，也是这一局的分数。买进的股票平分账户，空着的格子是现金。月底要从这里还钱，还不上，游戏就结束。${liveLine}${shortLine}`,
      };
    });

    // 0.5：有月度目标时这一块变宽（账户那一列让出一截），上面一行是本月目标，下面一行是这个月要还的钱
    this.tempo = !!monthThemeView(s);
    const bx = this.tempo ? GOAL_X : TB.billLeft;
    const bw = TB.billRight - bx;
    this.billBox = scene.add.rectangle(bx, TB.billBox.y, bw, TB.billBox.h, 0xffffff, 0).setOrigin(0, 0).setRounded(10).setDepth(d);
    this.goalBar = scene.add.graphics().setDepth(d);
    this.goalTag = scene.add.container(0, 0).setDepth(d);
    // 沙漏 + 还剩几天（目标那一行右边）、房子 + 这个月要还的钱（进度条右边）
    this.hourglass = addGlyph(scene, TB.hourglass.x, TB.hourglass.y, 'hourglass', TB.hourglass.s).setDepth(d).setVisible(false);
    this.daysLeft = addText(scene, TB.daysLeft.x, TB.daysLeft.y, '', { size: 15, bold: true, num: true, originY: 0.5 }).setDepth(d).setVisible(false);
    this.houseIcon = addGlyph(scene, 0, 0, 'house', 22).setDepth(d).setVisible(false);
    this.bill = addText(scene, bx + 12, TB.billY, '', { size: this.tempo ? 14 : 15, bold: true }).setDepth(d);
    this.billNote = addText(scene, bx + 12, TB.billNoteY, '', { size: 12, color: COLOR.muted, originY: 0.5 }).setDepth(d);
    const billHit = scene.add.rectangle(bx, ah.y, bw, ah.h, 0xffffff, 0.001).setOrigin(0, 0).setDepth(d);
    bindTooltip(billHit, () => ({ x: bx, y: ah.y, w: bw, h: ah.h }), () => {
      const mt = monthThemeView(this.state);
      const b0 = billView(this.state);
      const goalTip = mt ? `本月看点「${mt.name}」${mt.goal.boss ? '（中场挑战）' : ''}：${mt.intro}\n本月目标：${mt.goalText}${mt.goal.done ? '（已达成）' : mt.goal.failed ? '（没达成）' : ''}\n${mt.rewardText}\n这个月：${mt.rule}\n\n` : '';
      const b = billView(this.state);
      // 突发账单：总额已含在 amount 里
      const extras = b.extras ?? [];
      const detail = extras.length > 0 ? `\n其中突然要花的：${extras.map((e) => `${e.name} ${formatMoney(e.amount)}`).join('、')}` : '';
      // 事件留下的延后结算：只显示本金和到期月份（结果到期才知道）
      const pend = topBar(this.state).pending;
      const pending = pend.length > 0 ? `\n还没结算的：${pend.map((p) => `${p.name} ${formatMoney(p.amount)}（${p.month}月初见分晓）`).join('、')}` : '';
      return {
        title: mt ? `${b0.month}月 · ${mt.name}` : `${b.month}月要还的钱 · ${b.name}`,
        body: `${goalTip}${mt ? `这个月要还 ${formatMoney(b.amount)}（${b.name}）：` : ''}${formatMoney(b.amount)}，这个月最后一天收盘后自动从账户里扣。账户不够，游戏就结束${b.credit ? `（你有${itemView('credit').name}，能帮你还这一次，但下个月要还的钱 ×${fx('credit', 'nextBillMult')}）` : ''}。${detail}${pending}\n每个月都要还，名目越来越离谱。`,
      };
    });

    this.items = scene.add.container(ITEMS_X, TB.itemsY).setDepth(d);
    this.settings = new Button(scene, TB.settings.x, TB.settings.y, { width: TB.settings.w, height: TB.settings.h, label: '', onClick: onSettings });
    this.help = new Button(scene, TB.help.x, TB.help.y, { width: TB.help.w, height: TB.help.h, label: '?', fontSize: 20, onClick: onHelp });
    this.help.setDepth(d);
    this.help.tooltip(() => ({ title: '怎么玩', body: '三页图看懂这个游戏：风口怎么轮流火、什么时候买、什么时候卖。' }));
    this.settings.setDepth(d);
    drawGear(scene, TB.gear.x, TB.gear.y, TB.gear.r).setDepth(d + 1);
    if (s.ext) {
      this.bankRing = scene.add.rectangle(BANK.x - 3, BANK.y - 3, BANK.w + 6, BANK.h + 6, 0xffffff, 0).setOrigin(0, 0).setRounded(10).setStrokeStyle(3, COLOR.danger, 1).setDepth(d).setVisible(false);
      this.bank = new Button(scene, BANK.x, BANK.y, { width: BANK.w, height: BANK.h, label: '', subLabel: '借钱', fontSize: 15, onClick: onBank });
      addGlyph(scene, BANK.x + BANK.w / 2, BANK.y + TB.bankIconDy, 'bank', TB.bankIconS).setDepth(d + 2);
      this.bank.setDepth(d + 1);
      this.bank.onDenied(() => (bankView(this.state).open ? null : `银行第 ${bankView(this.state).openMonth} 个月才开门`));
      this.bank.tooltip(() => {
        const b = bankView(this.state);
        if (!b.open) return { title: '银行（还没开门）', body: `第 ${b.openMonth} 个月起可以把东西押给银行借钱炒股：赚了翻倍，亏了东西没了。` };
        return { title: '银行', body: b.debt > 0 ? `欠银行 ${formatMoney(b.debt)}，自己的钱 ${formatMoney(b.net)}，每月另付利息 ${formatMoney(b.monthlyInterest)}。${b.called ? '\n银行已经打过电话了，再亏东西就要被收走！' : ''}` : '把东西押给银行，多借一笔钱炒股：赚了翻倍，亏了东西没了。' };
      });
    } else this.bank = null;
    this.render(s);
  }

  private calendarTip(): { title: string; body: string } {
    // 实盘只打几个月：日历只列到最后一个月
    const months = runMonths(this.state);
    const cal = calendarView(this.state).filter((c) => c.month <= months);
    const cur = cal.find((c) => c.current);
    const lines = cal.map((c) => `${c.current ? '▶ ' : '   '}${c.month}月 ${c.name}${c.days !== 5 ? `（${c.days} 天）` : ''}`);
    const mood = topBar(this.state).mood;
    return {
      title: cur ? `${cur.month}月 · ${cur.name}：${cur.desc}` : '日历',
      body: `今天大环境：${MOOD_WORD[mood]}。${term('mood').explain}\n\n${months < 12 ? `这 ${months} 个月` : '这一年'}的日历是固定的，提前就能看到：\n${lines.join('\n')}`,
    };
  }

  /** 按状态刷新（无动画）。 */
  render(s: GameState): void {
    this.state = s;
    const t = topBar(s);
    this.day.setText(dayLabel(t));
    // 大环境：箭头 + 颜色（「大环境：一般」这类说明在日历的悬停提示里）
    const moodSign = MOOD_SIGN[t.mood];
    this.weather.setText(`大环境${moodSign > 0 ? '↑' : moodSign < 0 ? '↓' : '–'}`);
    // 日历小签放不下（手机上让出「大厅」以后，「开春政策窗口」会顶到账户那一列）就截短，全名在悬停里
    fitWidth(this.calText.setText(t.calendar.name), FLAGS_RIGHT - TB.calTextX - 16 - this.weather.width);
    this.calPill.setSize(this.calText.width + 16, TB.calPill.h);
    this.weather.setX(TB.calPill.x + this.calPill.width + 8);
    setColor(this.weather, moodSign > 0 ? COLOR.up : moodSign < 0 ? COLOR.down : COLOR.muted);
    // 「账户 · Lv1」：人设、难度全称在悬停提示里
    // 0.5.1：人设名找回来（难度全称仍在悬停里）
    // 手机上顶栏窄：不写「账户」两个字（钱包图标就是账户）
    // 0.6.0 实盘：这一行换成实盘小牌子「实盘 · 小档 2,000 → 约 2,104」（人设、难度在悬停里），跟着每天收盘更新
    const lv = t.live && isLiveRun(s) ? t.live : null;
    // 手机上这一行右边紧挨着月度目标的图标，豪华档的数字长，省掉一份是多少（悬停里有）
    // 0.11.0 杠杆常显：「实盘 · 小档 2,000 · 杠杆×2 → 约 2,480」
    const gx = s.setup?.live?.gear?.x ?? 1;
    this.accLabel.setText(lv ? (PHONE ? `实盘${lv.tierName}×${gx} → 约 ${chips(lv.value)}` : `实盘 · ${lv.tierName} ${chips(lv.stake)} · 杠杆×${gx} → 约 ${chips(lv.value)}`) : `${PHONE ? '' : '账户 · '}${t.personaName} · Lv${t.difficulty}${t.daily ? ' · 每日' : ''}`);
    setColor(this.accLabel, t.daily || lv ? COLOR.accentDark : COLOR.muted);
    this.renderDanger(lv ? marginWarn(s) : null);
    this.renderFlags(t, this.weather.x + this.weather.width + 8);
    this.setAccount(s.account);
    this.renderBill(s);
    this.renderItems(t.items);
    this.renderBank(s);
  }

  /** 银行按钮：没开门时变灰；欠着钱写"欠 ¥x"；银行打过电话时外圈红框闪烁。 */
  private renderBank(s: GameState): void {
    if (!this.bank) return;
    const b = bankView(s);
    this.bank.setEnabled(b.open && s.phase === 'premarket');
    if (!b.open) this.bank.setEnabled(false);
    this.bank.setSubLabel(!b.open ? `${b.openMonth}月开` : b.called ? '来电！' : b.debt > 0 ? '欠钱' : '借钱');
    // 月底付完账单会跌破银行的线时也闪（和猫的"银行提醒"一起）
    const alarm = b.called || b.risk !== null;
    this.bankRing?.setVisible(alarm);
    if (alarm && !this.bankPulse && this.bankRing && !(this.scene.data.get('calm') as boolean)) {
      this.bankPulse = this.scene.tweens.add({ targets: this.bankRing, alpha: { from: 1, to: 0.2 }, duration: 500, yoyo: true, repeat: -1 });
    } else if (!alarm && this.bankPulse) {
      this.bankPulse.stop();
      this.bankPulse = null;
      this.bankRing?.setAlpha(1);
    }
  }

  /**
   * 日期下面那一行的标签（每日挑战、市场传闻、加班）：排在天气后面，右边不能越过「账户」那一列。
   * 放得下就用全称；放不下先换短称；还放不下就合并成一个「N 个提醒」，提示里逐条写全。
   */
  private renderFlags(t: ReturnType<typeof topBar>, x0: number): void {
    const sig = `${t.daily ?? ''}|${t.notice?.id ?? ''}|${t.busy}|${x0}`;
    if (sig === this.flagSig) return;
    this.flagSig = sig;
    this.flags.removeAll(true);
    this.flagsArea = null;
    const list = flagList(t);
    if (list.length === 0) return;
    const right = FLAGS_RIGHT;
    const width = (labels: string[]): number => labels.reduce((n, l) => n + measureFlag(this.scene, l) + FLAG_GAP, -FLAG_GAP);
    let x = x0;
    const flag = (label: string, fill: number, tip: { title: string; body: string }): void => {
      const tt = addText(this.scene, 0, TB.flagY + 9, label, { size: 11, bold: true, color: COLOR.white, originY: 0.5 });
      const w = tt.width + 12;
      const pill = addPill(this.scene, x, TB.flagY, w, 18, fill);
      tt.setX(x + 6);
      const bx = x;
      pill.setInteractive();
      bindTooltip(pill, () => ({ x: bx, y: TB.flagY, w, h: 18 }), () => tip);
      this.flags.add([pill, tt]);
      x += w + FLAG_GAP;
    };
    if (x0 + width(list.map((f) => f.label)) <= right) {
      for (const f of list) flag(f.label, f.fill, f.tip);
    } else if (x0 + width(list.map((f) => f.short)) <= right) {
      for (const f of list) flag(f.short, f.fill, f.tip);
    } else {
      const first = list.find((f) => f.fill === COLOR.danger) ?? list[0]!;
      // 手机上日期标签（比如「双十一」）长时连「N 个提醒」也放不下：再缩成「N提醒」「!N」
      const n = list.length;
      const label = [`${n} 个提醒`, `${n}提醒`].find((l) => x0 + measureFlag(this.scene, l) <= right) ?? `!${n}`;
      flag(label, first.fill, { title: list.map((f) => f.tip.title).join(' · '), body: list.map((f) => `${f.tip.title}：${f.tip.body}`).join('\n') });
    }
    this.flagsArea = { x: x0, y: TB.flagY, w: x - FLAG_GAP - x0, h: 18 };
  }

  /** 日期行标签占的区域（自动化检查不越过「账户」那一列）；没有标签时为 null。 */
  flagsArea: Rect | null = null;

  flagsRect(): Rect | null {
    return this.flagsArea;
  }

  /** 0.5.1：账户数字跳一下（卖出的金币飞回钱包时）。 */
  pulseAccount(): void {
    const t = this.account;
    t.scene.tweens.killTweensOf(t);
    t.setScale(1);
    t.scene.tweens.add({ targets: t, scale: 1.12, duration: 120, yoyo: true, ease: 'Quad.easeOut' });
  }

  private flash: Phaser.Tweens.Tween | null = null;

  /** 0.11.0 开了杠杆、离清零线不远：账户数字变红闪；离远了恢复 */
  private renderDanger(warn: number | null): void {
    const on = warn !== null;
    if (on === !!this.flash) return;
    this.flash?.stop();
    this.flash = null;
    this.account.setAlpha(1);
    setColor(this.account, on ? COLOR.danger : COLOR.ink);
    if (on) this.flash = this.scene.tweens.add({ targets: this.account, alpha: 0.35, duration: 380, yoyo: true, repeat: -1 });
  }

  setAccount(v: number): void {
    this.shownAccount = v;
    this.account.setText(formatMoney(v));
  }

  private renderBill(s: GameState): void {
    const b = billView(s);
    const mt = this.tempo ? monthThemeView(s) : null;
    const st = billStatus(b);
    const alarm = st.status === 'short' || st.status === 'credit';
    // 月底倒数：最后 3 天每少一天响一下（不够还时更急）；只在天数变小时响，开局、换月、读档不响
    if (this.lastDaysLeft !== null && b.daysLeft < this.lastDaysLeft && b.daysLeft >= 1 && b.daysLeft <= 3) sound.ui(alarm ? 'denied' : 'toggle');
    this.lastDaysLeft = b.daysLeft;
    if (mt) {
      // 上：本月目标 X / Y · 还剩 N 天（boss 月带红签）；下：进度条 + 这个月要还多少
      const g = goalShort(mt.goal);
      const state = '';
      const sig = `${mt.goal.boss}|${mt.goal.done}|${mt.goal.failed}`;
      if (sig !== this.goalSig) {
        this.goalSig = sig;
        this.goalTag.removeAll(true);
        // 靶心图标代替「本月目标」字样：达成盖红、没达成变灰、中场挑战加紫圈
        const fill = mt.goal.done ? COLOR.up : mt.goal.failed ? 0x8d7b84 : mt.goal.boss ? 0x6a3a8a : COLOR.accent;
        const ring = this.scene.add.circle(GOAL_X + 24, TB.goalIconY, 15, fill, mt.goal.boss || mt.goal.done ? 0.25 : 0).setStrokeStyle(mt.goal.boss ? 2 : 0, fill, 1);
        const icon = addGlyph(this.scene, GOAL_X + 24, TB.goalIconY, 'target', PHONE ? 22 : 26);
        if (mt.goal.failed) icon.setTint(0xbbb0b6);
        // 0.5.1：靶心下面一行小字分清「目标」和「挑战」（中场挑战）
        const tagWord = addText(this.scene, GOAL_X + 24, TB.goalWordY, mt.goal.boss ? '挑战' : mt.goal.done ? '达成' : '目标', { size: 9, bold: true, color: fill, originX: 0.5, originY: 0.5 });
        this.goalTag.add([ring, icon, tagWord]);
        this.goalTagW = 30;
      }
      this.bill.setPosition(GOAL_X + 14 + this.goalTagW, TB.billY).setFontSize(15);
      this.bill.setText(`${g.text}${state}`);
      setColor(this.bill, mt.goal.failed ? COLOR.muted : mt.goal.done ? COLOR.up : COLOR.ink);
      this.daysLeft.setText(`${mt.daysLeft}`).setVisible(true);
      this.hourglass.setVisible(true);
      this.goalBar.clear();
      const bw = TB.goalBarW;
      const gx = GOAL_X + 44;
      this.goalBar.fillStyle(0xe8dccb, 1).fillRoundedRect(gx, TB.goalBarY, bw, 8, 4);
      const f = mt.goal.done ? 1 : mt.goal.failed ? 0 : g.frac;
      if (f > 0) this.goalBar.fillStyle(mt.goal.done ? COLOR.up : mt.goal.boss ? 0x6a3a8a : COLOR.accent, 1).fillRoundedRect(gx, TB.goalBarY, Math.max(8, bw * f), 8, 4);
      // 右半：房子图标 + 这个月要还多少（不够时变红写「差 ¥x」）
      this.houseIcon.setPosition(gx + bw + 22, TB.houseY).setVisible(true);
      this.billNote.setPosition(gx + bw + 38, TB.billNoteY).setFontSize(13);
      // 0.5.1：名目和后果找回来——「房租 ¥6,800」「差¥x · 会出局」「差¥x · 信用卡垫」
      // 手机上这一格只有七八十宽：只写金额（名目、后果在悬停里），以前「孩子补习班 ¥6,800」被道具图标盖住
      const gap = formatMoney(b.amount - b.account);
      this.billNote.setText(
        PHONE
          ? st.status === 'short' || st.status === 'credit' ? `差${gap}` : formatMoney(b.amount)
          : st.status === 'short' ? `差${gap} · 会出局` : st.status === 'credit' ? `差${gap} · 信用卡垫` : `${b.name} ${formatMoney(b.amount)}`,
      );
      fitWidth(this.billNote, TB.billRight - this.billNote.x - 4);
      setColor(this.billNote, alarm ? COLOR.danger : st.status === 'tight' ? COLOR.accentDark : COLOR.ink);
    } else {
      // 没有月度主题的局：房子 + 要还的钱（大字）、沙漏 + 天数，名目放小字
      this.houseIcon.setPosition(this.billBox.x + 22, TB.houseNoGoalY).setVisible(true);
      this.bill.setPosition(this.billBox.x + 40, TB.billY).setFontSize(TB.billTitleSize);
      this.bill.setText(formatMoney(b.amount));
      void billLine;
      this.hourglass.setVisible(true);
      this.daysLeft.setText(`${b.daysLeft}`).setVisible(true);
      const name = b.name;
      this.billNote.setPosition(this.billBox.x + 40, TB.billNoteY);
      this.billNote.setText(
        st.status === 'short' ? `差${formatMoney(b.amount - b.account)} · 还不上会出局` : st.status === 'credit' ? `差${formatMoney(b.amount - b.account)} · 信用卡垫` : st.status === 'tight' ? `还完剩${formatMoney(b.account - b.amount)}` : name,
      );
      setColor(this.billNote, alarm ? COLOR.danger : st.status === 'tight' ? COLOR.accentDark : COLOR.muted);
      setColor(this.bill, alarm ? COLOR.danger : COLOR.ink);
    }
    this.billBox.setFillStyle(alarm ? 0xffd9d2 : mt?.goal.boss ? 0xf1e4f7 : 0xffffff, alarm || mt?.goal.boss ? 1 : 0);
    if (alarm) this.billBox.setStrokeStyle(2, COLOR.danger, 1);
    else if (mt?.goal.boss) this.billBox.setStrokeStyle(2, 0x6a3a8a, 1);
    else this.billBox.setStrokeStyle(0, 0, 0);
    // 快不够时闪烁提醒（减少动态效果时只变红不闪）
    const want = alarm && s.phase === 'premarket';
    if (want && !this.billPulse && !(this.scene.data.get('calm') as boolean)) {
      this.billPulse = this.scene.tweens.add({ targets: this.billBox, alpha: { from: 1, to: 0.45 }, duration: 700, yoyo: true, repeat: -1 });
    } else if (!want && this.billPulse) {
      this.billPulse.remove();
      this.billPulse = null;
      this.billBox.setAlpha(1);
    }
  }

  private goalTagW = 0;

  /** 0.5：目标进度变了——刷新顶栏这一块，跳一下；达成 / 没达成时盖章、出声。 */
  goalChanged(anim: Animator, s: GameState, result: 'progress' | 'done' | 'failed'): void {
    this.state = s;
    this.renderBill(s);
    if (!this.tempo) return;
    const r = this.billRect();
    if (result === 'progress') {
      pop(anim, this.bill, 1.12);
      flashBox(this.scene, anim, r.x, r.y + 2, r.w, r.h - 4, COLOR.gold, 60);
      return;
    }
    const done = result === 'done';
    sound.cue({ type: 'stamp', paid: done, credit: false });
    stamp(this.scene, anim, r.x + r.w - 70, r.y + 30, done ? '达成！' : '没达成', done);
    if (done) sparkles(this.scene, anim, r.x + 40, r.y + 26, 12);
  }

  private get itemsW(): number {
    return this.bank ? ITEMS_W_EXT : ITEMS_W;
  }

  private renderItems(items: ItemView[]): void {
    const sig = items.map((i) => i.id).join(',');
    if (sig === this.itemSig) return;
    this.itemSig = sig;
    this.items.removeAll(true);
    this.chips.clear();
    this.chipSize.clear();
    if (items.length === 0) {
      // 空道具栏：只放一个半透明背包，悬停看说明
      const bag = addGlyph(this.scene, 18, TB.rowChipY, 'bag', 28).setAlpha(0.45);
      bag.setInteractive();
      bindTooltip(bag, () => ({ x: ITEMS_X, y: TB.itemsY, w: 36, h: 36 }), () => ({ title: '道具栏（空）', body: '月底还完钱，三选一的奖励里可以挑道具。' }));
      const hint = addText(this.scene, 36, TB.rowChipY, '月底挑道具', { size: 11, color: COLOR.muted, originY: 0.5 });
      this.items.add([bag, hint]);
      return;
    }
    // 有彩色图标的道具画成圆形图标，没有的（美术还没交）退回两字徽章；道具多了缩小成两排
    const icons = items.map((it) => hasArt(this.scene.textures, itemKey(it.id)));
    const anyIcon = icons.some(Boolean);
    const big = anyIcon ? 34 : CHIP_W;
    const oneRow = items.reduce((w, _, i) => w + (icons[i] ? 34 : CHIP_W) + 4, -4) <= this.itemsW;
    // 一排放得下时图标小一点，下面标道具名的前两个字；两排时只有图标（悬停看全名）
    const iconSize = oneRow ? 28 : TB.row2Icon;
    const chipW = oneRow ? CHIP_W : 40;
    const chipH = oneRow ? CHIP_H : 20;
    // 先排位置：最多两排，再多就收进最后一个「+N」，免得第三排盖住下面的复盘
    const MORE_W = 30;
    const slots: { x: number; row: number; w: number; h: number }[] = [];
    {
      let x = 0;
      let row = 0;
      for (let i = 0; i < items.length; i++) {
        const w = icons[i] ? iconSize : chipW;
        const h = icons[i] ? iconSize : chipH;
        if (x + w > this.itemsW && x > 0) {
          x = 0;
          row += 1;
        }
        if (row > 1) break;
        slots.push({ x, row, w, h });
        x += w + 4;
      }
      if (slots.length < items.length) {
        while (slots.length > 0) {
          const last = slots[slots.length - 1]!;
          if (last.row < 1 || last.x + last.w + 4 + MORE_W <= this.itemsW) break;
          slots.pop();
        }
      }
    }
    const shown = items.slice(0, slots.length);
    const hidden = items.slice(slots.length);
    shown.forEach((it, i) => {
      const { x, row, w, h } = slots[i]!;
      const rowH = oneRow ? big : TB.row2H;
      const cy = (oneRow ? (icons[i] ? TB.rowIconY : TB.rowChipY) : TB.row2Y0) + row * rowH;
      const color = ITEM_KIND_COLOR[it.kind] ?? COLOR.accent;
      const c = this.scene.add.container(x + w / 2, cy);
      if (icons[i]) {
        c.add(this.scene.add.circle(0, 0, w / 2, 0xffffff, 0.001));
        c.add(addImage(this.scene, 0, 0, itemKey(it.id), w));
        // 手机上顶栏矮，图标下面不写名字（悬停 / 长按看全名）
        if (oneRow && !PHONE) c.add(addText(this.scene, 0, w / 2 + 7, shortItemName(it.name), { size: 9, bold: true, color: COLOR.muted, originX: 0.5, originY: 0.5 }));
      } else {
        const pill = addPill(this.scene, -w / 2, -h / 2, w, h, color);
        const label = addText(this.scene, 0, 0, shortItemName(it.name), { size: oneRow ? 12 : 11, bold: true, color: textOn(color), originX: 0.5, originY: 0.5 });
        c.add([pill, label]);
      }
      c.setSize(w, h).setInteractive({ useHandCursor: false });
      const bx = x;
      bindTooltip(c, () => ({ x: ITEMS_X + bx, y: TB.itemsY + cy - h / 2, w, h }), () => ({
        title: `${it.name}（${it.tag}）`,
        body: `${it.desc}${it.flavor ? `\n「${it.flavor}」` : ''}${this.expiry(it.id)}`,
        color,
      }));
      this.items.add(c);
      this.chips.set(it.id, c);
      this.chipSize.set(it.id, { w, h });
    });
    if (hidden.length > 0) {
      const lastSlot = slots[slots.length - 1];
      const x = lastSlot ? lastSlot.x + lastSlot.w + 4 : 0;
      const cy = TB.row2Y0 + TB.row2H;
      const h = 20;
      const c = this.scene.add.container(x + MORE_W / 2, cy);
      c.add([addPill(this.scene, -MORE_W / 2, -h / 2, MORE_W, h, COLOR.muted), addText(this.scene, 0, 0, `+${hidden.length}`, { size: 11, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 })]);
      c.setSize(MORE_W, h).setInteractive({ useHandCursor: false });
      bindTooltip(c, () => ({ x: ITEMS_X + x, y: TB.itemsY + cy - h / 2, w: MORE_W, h }), () => ({
        title: `还有 ${hidden.length} 件道具`,
        body: hidden.map((it) => `${it.name}（${it.tag}）：${it.desc}${this.expiry(it.id).replace('\n', ' ')}`).join('\n'),
      }));
      this.items.add(c);
      // 收起来的道具触发时，闪这个「+N」
      for (const it of hidden) {
        this.chips.set(it.id, c);
        this.chipSize.set(it.id, { w: MORE_W, h });
      }
    }
  }

  /** 临时道具的到期说明。 */
  private expiry(id: string): string {
    const e = topBar(this.state).expiring.find((x) => x.id === id);
    return e ? `\n临时的：${e.month}月底就没了` : '';
  }

  /** 道具图标在世界坐标的中心（触发时从这里飘字）。 */
  itemCenter(id: string): { x: number; y: number } | null {
    const c = this.chips.get(id);
    return c ? { x: ITEMS_X + c.x, y: TB.itemsY + c.y } : null;
  }

  /** 道具触发：图标闪一下。 */
  flashItem(anim: Animator, id: string): void {
    const c = this.chips.get(id);
    if (!c) return;
    pop(anim, c, 1.5);
    const p = this.itemCenter(id);
    const sz = this.chipSize.get(id) ?? { w: CHIP_W, h: CHIP_H };
    if (p) {
      flashBox(this.scene, anim, p.x - sz.w / 2 - 3, p.y - sz.h / 2 - 3, sz.w + 6, sz.h + 6, COLOR.gold, 30);
      sparkles(this.scene, anim, p.x, p.y, 6);
    }
  }

  /** 账户数字滚动到 to，并在旁边飘出变化额。 */
  async rollAccount(anim: Animator, from: number, to: number, ms: number): Promise<void> {
    const delta = to - from;
    if (Math.abs(delta) >= 0.5) {
      floatText(this.scene, anim, this.account.x + this.account.width + 56, TB.rollY, formatMoney(delta, { sign: true }), signColor(delta), { size: 18, pop: true, rise: 12, hold: 500, depth: 60 });
    }
    let last = -1;
    await anim.count(from, to, ms, (v) => {
      this.setAccount(v);
      const p = Math.abs(to - from) < 1e-9 ? 1 : (v - from) / (to - from);
      const step = Math.floor(p * 12);
      if (step !== last && !anim.instant) {
        last = step;
        sound.cue({ type: 'countUp', progress: Math.max(0, Math.min(1, p)) });
      }
    });
    this.setAccount(to);
    if (Math.abs(delta) >= 0.5) pop(anim, this.account, 1.15);
  }

  /** 引导与自动化用的区域。 */
  billRect(): Rect {
    const x = this.tempo ? GOAL_X : TB.billLeft;
    return { x, y: TB.accHit.y, w: TB.billRight - x, h: TB.accHit.h };
  }
  accountRect(): Rect {
    return { x: TB.accHit.x, y: TB.accHit.y, w: this.tempo ? ACC_W : TB.accWideW, h: TB.accHit.h };
  }
}
