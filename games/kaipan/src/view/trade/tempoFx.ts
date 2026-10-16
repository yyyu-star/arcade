import Phaser from 'phaser';
import { formatMoney, friendView, monthThemeView, type CalendarView, type GameState, type GoalKind } from '../../core/index.ts';
import { goalShort } from '../tempoText.ts';
export * from '../tempoText.ts';
import { avatarKey, type Glyph } from '../assets.ts';
import type { Animator } from '../fx/anim.ts';
import { addBackdrop, shake } from '../fx/effects.ts';
import { fireworks, sparkles } from '../fx/particles.ts';
import { isTouch } from '../input.ts';
import { sound } from '../sound.ts';
import { COLOR, TYPE } from '../theme.ts';
import { addGlyph, addImage, addPaper, addPill } from '../ui/art.ts';
import { iconChip, moneyShort } from '../ui/dialog.ts';
import { bindTooltip } from '../ui/tooltip.ts';
import { addText } from '../ui/text.ts';
import { phoneLayout, viewOf } from '../viewport.ts';
import { ellipsize } from '../../core/format.ts';

/** 0.5 节奏与反馈的画面小件：本月看点卡、屏幕中部的大字（高光、连击）、盖章。文字小工具在 ../tempoText.ts。 */

// ---------------------------------------------------------------- 本月看点卡

interface MonthCardInfo {
  month: number;
  name: string;
  intro: string;
  rule: string;
  goalText: string;
  rewardText: string;
  boss: boolean;
  roast: { friendId: string; text: string } | null;
}

const BOSS_BG = 0x2e1d3a;
const BOSS_INK = 0xffe7a8;

/** 月度主题的图标（看点卡左上角）。 */
const THEME_GLYPH: Record<string, Glyph> = {
  meme_month: 'bolt',
  qunzhu_month: 'horn',
  payday: 'gift',
  bank_month: 'bank',
  bear_month: 'bear',
  exam_month: 'book',
  inlaw_month: 'house',
  rumor_month: 'horn',
  insider_month: 'hourglass',
  fee_month: 'gift',
  wide_month: 'arrow_up',
  streak_month: 'star',
  spread_month: 'bag',
  fomo_month: 'star',
  beat_month: 'trophy',
  crash_boss: 'arrow_down',
  review_boss: 'trophy',
  banker_boss: 'target',
  beat_boss: 'trophy',
};

/** 目标环中间的大数字 + 环下的短标签（≤6 字）。 */
function goalBadge(kind: GoalKind, target: number): { big: string; label: string } {
  const t = String(Math.round(target * 10) / 10);
  switch (kind) {
    case 'gain':
      return { big: `${t}%`, label: '本月涨' };
    case 'keep':
      return { big: `${t}%`, label: '最多回撤' };
    case 'beat':
      return { big: `+${t}`, label: '跑赢大环境' };
    case 'limitUp':
      return { big: `${t}次`, label: '抓涨停' };
    case 'shortWin':
      return { big: `${t}次`, label: '押跌赚钱' };
    case 'streak':
      return { big: `${t}天`, label: '连着赚' };
    case 'themes':
      return { big: `${t}个`, label: '同拿风口' };
    case 'quickWin':
      return { big: `${t}次`, label: '当天就赚' };
    case 'bigDay':
      return { big: `${t}%`, label: '单日涨' };
    default:
      return { big: t, label: '目标' };
  }
}


/** 附加说明（"名目：正文（+¥x）"）拆成短标题和金额；完整原句放悬停。 */
export function extraChip(text: string): { head: string; money: string | null } {
  const i = text.indexOf('：');
  let head = (i > 0 ? text.slice(0, i) : text).replace(/ · 后来呢$/, '');
  if (head.length > 9) head = `${head.slice(0, 8)}…`;
  const all = text.match(/[+-]?¥[\d,.]+(?:万亿|万|亿)?/g);
  return { head, money: all ? (all[all.length - 1] as string) : null };
}

/**
 * 本月看点卡（0.5 去文字化）：主题图标 + 大字月份 + 主题名；目标进度环（目标数字居中）+ 奖励金额；
 * 规则、本月要还的钱、交易日变成图标胶囊；一句 ≤12 字台词。长句（开场白、规则原文、目标原文、附加说明）都在悬停详情里。
 * 第 4、8 个月的中场 boss 换深色底、金边、"中场挑战"红签，出场时震一下、撒金粉。
 */
export function monthCard(
  scene: Phaser.Scene,
  anim: Animator,
  s: Readonly<GameState>,
  info: MonthCardInfo,
  cal: Pick<CalendarView, 'name' | 'days'>,
  bill: { name: string; amount: number },
  extras: string[],
): { root: Phaser.GameObjects.Container; rect: { x: number; y: number; w: number; h: number } } {
  const root = scene.add.container(0, 0).setDepth(200);
  root.add(addBackdrop(scene, info.boss ? 0.5 : 0.3));
  const mt = monthThemeView(s);
  const V = viewOf(scene);
  const ph = phoneLayout(scene);
  const pad = 30;
  // 手机（0.5.5）高度不够，摆成两栏：左栏月份、开场白、目标和奖励；右栏胶囊、规则、台词、附加说明
  const colW = ph ? 400 : 460;
  const col2 = ph ? pad + colW + 30 : pad;
  const W = ph ? col2 + colW + pad : 520;
  const boss = info.boss;
  const ink = boss ? BOSS_INK : COLOR.ink;
  const muted = boss ? 0xd9c6e6 : COLOR.muted;
  const body: Phaser.GameObjects.GameObject[] = [];
  const x0 = Math.round(V.w / 2 - W / 2);
  // ---- 头：主题图标 + 月份 + 主题名
  const icon = THEME_GLYPH[mt?.id ?? ''] ?? 'calendar';
  const iconBg = scene.add.circle(pad + 34, 50, 34, boss ? 0x46305a : 0xffe7a8).setStrokeStyle(3, boss ? COLOR.gold : COLOR.ink, 1);
  const iconImg = addGlyph(scene, pad + 34, 50, icon, 52, icon === 'arrow_up' ? COLOR.up : icon === 'arrow_down' ? COLOR.down : undefined);
  const month = addText(scene, pad + 84, 22, `${info.month}月`, { size: TYPE.big + 6, bold: true, color: boss ? COLOR.gold : COLOR.accentDark });
  const name = addText(scene, pad + 84, 62, info.name, { size: TYPE.title + 2, bold: true, color: ink });
  body.push(iconBg, iconImg, month, name);
  if (boss) {
    const tagT = addText(scene, 0, 0, '中场挑战', { size: TYPE.label - 1, bold: true, color: COLOR.white, originY: 0.5 });
    const tx = month.x + month.width + 12;
    body.push(addPill(scene, tx, 32, tagT.width + 16, 22, COLOR.danger, false), tagT.setPosition(tx + 8, 43));
  }
  // ---- 开场白（0.5.1 找回）：一条带主题图标的小纸条，讲这个月发生了什么
  let y = 104;
  if (info.intro) {
    const strip = scene.add.rectangle(pad, y, colW, 34, boss ? 0x46305a : 0xfff6dc).setOrigin(0, 0).setRounded(10).setStrokeStyle(1.5, boss ? COLOR.gold : COLOR.edge, 1);
    const q = addGlyph(scene, pad + 18, y + 17, 'horn', 20);
    const introT = addText(scene, pad + 34, y + 17, ellipsize(info.intro, 30), { size: TYPE.label, color: ink, originY: 0.5 });
    body.push(strip, q, introT);
    y += 42;
  }
  // ---- 目标环 + 奖励
  const ringX = pad + 66;
  const ringY = y + 58;
  const R = 50;
  const g = mt?.goal;
  const badge = g ? goalBadge(g.kind, g.target) : { big: '', label: info.goalText };
  const frac = g ? goalShort(g).frac : 0;
  const ring = scene.add.graphics();
  ring.fillStyle(boss ? 0x46305a : COLOR.paperHi, 1).fillCircle(ringX, ringY, R);
  ring.lineStyle(10, boss ? 0x5c4470 : COLOR.paperLo, 1).strokeCircle(ringX, ringY, R - 5);
  if (frac > 0.001) ring.lineStyle(10, COLOR.accent, 1).beginPath().arc(ringX, ringY, R - 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, frac)).strokePath();
  ring.lineStyle(2.5, boss ? COLOR.gold : COLOR.ink, 1).strokeCircle(ringX, ringY, R + 1);
  const goalBig = addText(scene, ringX, ringY - 2, badge.big, { size: TYPE.big, bold: true, num: true, color: boss ? COLOR.gold : COLOR.accentDark, originX: 0.5, originY: 0.5 });
  const goalLabel = addText(scene, ringX, ringY + R + 8, badge.label, { size: TYPE.label, bold: true, color: ink, originX: 0.5 });
  // 目标进度（0.5.1 找回）：放在奖励框下面，一行数字
  const progT = g ? addText(scene, pad + 162, ringY + R + 20, goalShort(g).text, { size: TYPE.label, bold: true, num: true, color: muted, originY: 1 }) : null;
  if (progT) body.push(progT);
  const goalTarget = addGlyph(scene, ringX + R - 6, ringY - R + 8, 'target', 30);
  const ringHit = scene.add.circle(ringX, ringY, R + 4, 0xffffff, 0.001);
  body.push(ring, goalBig, goalLabel, goalTarget, ringHit);
  // 奖励：礼物 + 大金额（碎片 / 道具附在后面）
  const rx = pad + 160;
  const rw = mt?.goal.reward;
  const rewardBox = scene.add.rectangle(rx, y + 14, pad + colW - rx, 88, boss ? 0x46305a : 0xfff1c4).setOrigin(0, 0).setRounded(14).setStrokeStyle(2, boss ? COLOR.gold : COLOR.gold, 1);
  const gift = addGlyph(scene, rx + 40, y + 58, 'gift', 54);
  const cash = rw && rw.cash > 0 ? moneyShort(rw.cash, true) : '';
  const extraBits = [rw && rw.shards > 0 ? `碎片×${rw.shards}` : '', rw?.item ? '道具×1' : ''].filter(Boolean).join(' · ');
  const amount = addText(scene, rx + 78, y + (extraBits ? 46 : 58), cash || extraBits || info.rewardText, { size: TYPE.big, bold: true, num: true, color: boss ? COLOR.gold : COLOR.accentDark, originY: 0.5 });
  body.push(rewardBox, gift, amount);
  if (cash && extraBits) body.push(addText(scene, rx + 80, y + 76, `+ ${extraBits}`, { size: TYPE.label, bold: true, color: muted, originY: 0.5 }));
  const goalTip = { title: info.name, body: `目标：${info.goalText}\n${info.rewardText}\n\n${info.intro}` };
  const tipRect = (): { x: number; y: number; w: number; h: number } => ({ x: card.x + ringX - R, y: card.y + ringY - R, w: colW, h: R * 2 });
  bindTooltip(ringHit, tipRect, () => goalTip);
  rewardBox.setInteractive();
  bindTooltip(rewardBox, tipRect, () => goalTip);
  y = ringY + R + 34;
  const leftBottom = y;
  if (ph) y = 24;
  // ---- 图标胶囊：规则、要还的钱、交易日
  const chips: { node: Phaser.GameObjects.Container; w: number }[] = [
    iconChip(scene, 0, 0, 'book', mt?.ruleShort ?? info.rule, { tip: { title: '本月规则', body: info.rule } }),
    iconChip(scene, 0, 0, 'house', moneyShort(bill.amount), { color: COLOR.danger, tip: { title: '月底要还', body: `${bill.name} ${formatMoney(bill.amount)}，最后一天收盘后扣` } }),
    iconChip(scene, 0, 0, 'calendar', `${cal.days}天`, { tip: { title: '交易日', body: `这个月有 ${cal.days} 个交易日` } }),
  ];
  let cx = col2;
  for (const c of chips) {
    c.node.setPosition(cx, y);
    body.push(c.node);
    cx += c.w + 10;
  }
  y += 44;
  // 规则全文（0.5.1 找回）：胶囊里是短的，这里补一行原句
  if (mt?.ruleShort && info.rule && info.rule !== mt.ruleShort) {
    const rt = addText(scene, col2 + 4, y - 4, info.rule, { size: TYPE.label - 1, color: muted, wrap: colW - 8 });
    body.push(rt);
    y += Math.round(rt.height + 8);
  }
  // ---- 台词
  if (info.roast) {
    const line = mt?.line ?? info.roast.text;
    const av = addImage(scene, col2 + 20, y + 20, avatarKey(info.roast.friendId), 40);
    const t = addText(scene, col2 + 62, y + 20, line, { size: TYPE.label + 2, bold: true, color: COLOR.ink, originY: 0.5 });
    const bub = scene.add.rectangle(col2 + 50, y + 2, t.width + 26, 36, 0xffffff).setOrigin(0, 0).setRounded(14).setStrokeStyle(2, COLOR.ink, 1);
    const known = s.friends.some((f) => f.id === info.roast?.friendId);
    const who = known ? friendView(s, info.roast.friendId).name : '群友';
    const full = info.roast.text;
    bub.setInteractive();
    bindTooltip(bub, () => ({ x: card.x + bub.x, y: card.y + bub.y, w: bub.width, h: 36 }), () => ({ title: who, body: full }));
    body.push(bub, av, t);
    y += 50;
  }
  // ---- 附加说明：每条一行（图标 + 短标题 + 金额），原句在悬停
  for (const e of extras.slice(0, 4)) {
    const { head, money } = extraChip(e);
    const rowBg = scene.add.rectangle(col2, y, colW, 32, boss ? 0x46305a : COLOR.paperLo).setOrigin(0, 0).setRounded(10);
    const gl = addGlyph(scene, col2 + 18, y + 16, 'bolt', 22);
    const ht = addText(scene, col2 + 36, y + 16, head, { size: TYPE.label + 1, bold: true, color: ink, originY: 0.5 });
    body.push(rowBg, gl, ht);
    if (money) {
      const neg = money.startsWith('-') || head.includes('花');
      body.push(addText(scene, col2 + colW - 12, y + 16, money, { size: TYPE.title, bold: true, num: true, color: money.startsWith('+') ? COLOR.up : neg ? COLOR.down : ink, originX: 1, originY: 0.5 }));
    }
    rowBg.setInteractive();
    const ry = y;
    bindTooltip(rowBg, () => ({ x: card.x + col2, y: card.y + ry, w: colW, h: 32 }), () => ({ title: head.replace(/…$/, ''), body: e }));
    y += 38;
  }
  const H = ph ? Math.min(V.h - 8, Math.max(leftBottom, y) + 28) : Math.min(680, y + 28);
  const y0 = Math.round(V.h / 2 - H / 2);
  const panel = boss
    ? scene.add.rectangle(0, 0, W, H, BOSS_BG).setOrigin(0, 0).setRounded(18).setStrokeStyle(5, COLOR.gold, 1)
    : addPaper(scene, 0, 0, W, H);
  // 背景纹样：右下角一个淡淡的大主题图标
  const mark = addGlyph(scene, W - 70, H - 70, icon, 120).setAlpha(boss ? 0.12 : 0.08);
  body.unshift(mark);
  const hint = addText(scene, W - 18, H - 10, isTouch() ? '点一下' : '空格', { size: TYPE.label - 1, color: boss ? 0xd9c6e6 : COLOR.dim, originX: 1, originY: 1 });
  const card = scene.add.container(x0, y0, [panel, ...body, hint]);
  root.add(card);
  sound.cue({ type: 'monthStart' });
  if (!anim.instant) {
    if (!anim.calm) {
      card.setScale(0.9).setAlpha(0);
      card.setPosition(x0 + W * 0.05, y0 + H * 0.05);
      anim.fx({ targets: card, scale: 1, alpha: 1, x: x0, y: y0, duration: 240, ease: 'Back.easeOut' }, () => card.setScale(1).setAlpha(1).setPosition(x0, y0));
      // 目标环从 0 转到当前进度，主题图标弹一下
      const sc = iconImg.scaleX;
      iconImg.setScale(sc * 0.2);
      anim.fx({ targets: iconImg, scaleX: sc, scaleY: sc, duration: 360, delay: 120, ease: 'Back.easeOut' }, () => iconImg.setScale(sc));
    }
    if (boss) {
      sound.cue({ type: 'thunder' });
      shake(scene, anim, 260, 0.006);
      scene.time.delayedCall(200, () => {
        if (!card.active) return;
        sparkles(scene, anim, x0 + 60, y0 + 40, 14);
        sparkles(scene, anim, x0 + W - 60, y0 + 40, 14);
        fireworks(scene, anim, x0 + W - 90, y0 + 30, false);
      });
    } else if (!anim.calm) {
      scene.time.delayedCall(260, () => {
        if (card.active) sparkles(scene, anim, x0 + rx + 40, y0 + ringY, 8);
      });
    }
  }
  return { root, rect: { x: x0, y: y0, w: W, h: H } };
}

// ---------------------------------------------------------------- 屏幕中部大字

/** 喊话标题 → 图标（0.5.1：飘字改成图标 + 数字）。 */
function shoutGlyph(title: string): Glyph {
  if (title.includes('被轧')) return 'cry';
  if (title.includes('连续涨停')) return 'rocket';
  if (title.includes('涨停')) return 'bolt';
  if (title.includes('押对')) return 'bear';
  if (title.includes('大赚')) return 'moneybag';
  if (title.includes('连红') || title.includes('奖励')) return 'star';
  if (title.includes('目标')) return 'trophy';
  if (title.includes('跌停')) return 'cry';
  if (title.includes('大跌')) return 'arrow_down';
  if (title.includes('没封住')) return 'hammer';
  if (title.includes('过山车')) return 'bolt';
  if (title.includes('股灾')) return 'storm';
  return 'star';
}

/** 副句拆成「名字」+ 数字（金额、百分比、次数）。名字取第一个逗号/空格前，最多 8 字。 */
function shoutBits(sub: string): { name: string; nums: string[] } {
  const nums = sub.match(/[+-]?¥[\d,.]+(?:万|亿)?|[+-]?\d+(?:\.\d+)?%|\d+\s?(?:连板|天|次|连红)/g) ?? [];
  const head = sub.split(/[，,。：:！!\s]/)[0] ?? '';
  const name = /\d/.test(head) ? '' : ellipsize(head, 8);
  return { name, nums: nums.slice(0, 3).map((x) => x.replace(/\s/g, '')) };
}

/**
 * 屏幕中部大字（持仓区上方）：图标 + 大字放大弹出、停一下、淡出；下面一行「名字 + 数字胶囊」。
 * good 用涨色 + 金粉，坏事用跌色。副句短（≤18 字）时整句照写。
 */
export function shout(scene: Phaser.Scene, anim: Animator, title: string, sub: string, good: boolean, x = 612, y = 150): void {
  if (anim.instant) return;
  const color = good ? COLOR.up : COLOR.down;
  const t = addText(scene, 0, 0, title, { size: TYPE.big + 12, bold: true, color, originX: 0.5, originY: 0.5, stroke: 0xffffff, strokeWidth: 8 });
  const gl = addGlyph(scene, 0, 0, shoutGlyph(title), 52, shoutGlyph(title).startsWith('arrow') ? color : undefined);
  const gw = gl.visible ? 60 : 0;
  t.setX(gw / 2);
  gl.setX(-(gw + t.width) / 2 + 26);
  const kids: Phaser.GameObjects.GameObject[] = [t, gl];
  // 副行：短句照写；长句拆成名字 + 数字胶囊（0.5 是整句不写，0.5.1 找回）
  if (sub) {
    const short = [...sub].length <= 18;
    const bits = shoutBits(sub);
    const parts: Phaser.GameObjects.GameObject[] = [];
    let w = 0;
    const row = scene.add.container(0, 40);
    if (short || bits.nums.length === 0) {
      const st = addText(scene, 0, 0, short ? sub : `${[...sub].slice(0, 17).join('')}…`, { size: 16, bold: true, color: COLOR.ink, originY: 0.5, stroke: 0xffffff, strokeWidth: 5 });
      parts.push(st);
      w = st.width;
    } else {
      if (bits.name) {
        const nt = addText(scene, 0, 0, bits.name, { size: 16, bold: true, color: COLOR.ink, originY: 0.5, stroke: 0xffffff, strokeWidth: 5 });
        parts.push(nt);
        w = nt.width + 8;
      }
      for (const n of bits.nums) {
        const neg = n.startsWith('-');
        const nt = addText(scene, 0, 0, n, { size: 18, bold: true, num: true, color: COLOR.white, originY: 0.5 });
        const pill = addPill(scene, w, -15, nt.width + 20, 30, neg ? COLOR.down : good ? COLOR.up : COLOR.accentDark);
        nt.setX(w + 10);
        parts.push(pill, nt);
        w += nt.width + 26;
      }
    }
    row.add(parts);
    row.setX(-w / 2);
    kids.push(row);
  }
  const c = scene.add.container(x, y, kids).setDepth(175);
  if (!anim.calm) {
    c.setScale(0.3);
    anim.fx({ targets: c, scale: 1, duration: 220, ease: 'Back.easeOut' });
    anim.fx({ targets: gl, angle: { from: -14, to: 0 }, duration: 320, ease: 'Back.easeOut' });
    if (good) {
      sparkles(scene, anim, x - t.width / 2, y, 10);
      sparkles(scene, anim, x + t.width / 2, y, 10);
    }
  }
  anim.fx({ targets: c, alpha: { from: 1, to: 0 }, y: y - 16, delay: 900, duration: 320, ease: 'Quad.easeIn' }, () => c.destroy());
}

/** 盖章标签 → 小图标。 */
function stampGlyph(label: string, good: boolean): Glyph {
  if (label.includes('涨停')) return 'bolt';
  if (label.includes('押对')) return 'bear';
  if (label.includes('跌停')) return 'cry';
  if (label.includes('被轧')) return 'hammer';
  if (label.includes('达成') && good) return 'trophy';
  return good ? 'star' : 'cloud';
}

/** 盖章（顶栏目标达成 / 没达成）：从大缩到正常，斜着压在 (x, y)。 */
export function stamp(scene: Phaser.Scene, anim: Animator, x: number, y: number, label: string, good: boolean, keep = 1600): void {
  if (anim.instant) return;
  const color = good ? COLOR.up : 0x8d7b84;
  const t = addText(scene, 0, 0, label, { size: 22, bold: true, color, originX: 0.5, originY: 0.5 });
  // 0.5.1：章面左边加一个小图标（涨停闪电、押对小熊、跌停哭脸……）
  const gl = addGlyph(scene, 0, 0, stampGlyph(label, good), 24);
  const gw = gl.visible ? 26 : 0;
  t.setX(gw / 2);
  gl.setX(-t.width / 2);
  const box = scene.add.rectangle(0, 0, t.width + 22 + gw, t.height + 10, 0xffffff, 0.85).setRounded(8).setStrokeStyle(4, color, 1);
  const c = scene.add.container(x, y, [box, gl, t]).setDepth(180).setAngle(-10);
  if (!anim.calm) {
    c.setScale(2.2).setAlpha(0.2);
    anim.fx({ targets: c, scale: 1, alpha: 1, duration: 200, ease: 'Quad.easeIn' });
  }
  if (good) sparkles(scene, anim, x, y, 14);
  anim.fx({ targets: c, alpha: 0, delay: keep, duration: 400 }, () => c.destroy());
}
