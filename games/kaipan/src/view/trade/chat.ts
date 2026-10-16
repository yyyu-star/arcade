import Phaser from 'phaser';
import {
  buyError,
  chatView,
  formatPoints,
  friendView,
  themeById,
  type ChatView,
  type Comment,
  type GameState,
  type MessageJudge,
  type FriendView,
  type MessageView,
  type NewsItem,
  type RecView,
  canShortNow,
  runMonths,
} from '../../core/index.ts';
import { NEWS_KEY, avatarKey, hasArt, type AvatarFace, type Glyph } from '../assets.ts';
import type { Animator } from '../fx/anim.ts';
import { TURN_LABEL, buyKey, claimSign, recordText } from '../labels.ts';
import { DIR_WORD, ROLE_TERM, ROLE_WORD, term, termTip } from '../glossary.ts';
import type { Rect } from '../rect.ts';
import { sound } from '../sound.ts';
import { COLOR, PHONE as PHONE_MODE, THEME_COLOR, signColor, textOn } from '../theme.ts';
import { addGlyph, addImage, addPaper, addPill, addSlice, addTile } from '../ui/art.ts';
import { Button } from '../ui/button.ts';
import { addSpark, type Spark } from '../ui/spark.ts';
import { StockGuy } from '../ui/stockGuy.ts';
import { addText, fitWidth } from '../ui/text.ts';
import { bindTooltip } from '../ui/tooltip.ts';
import { fluffNote, makeFluff, shortLine, toneOf, type Fluff } from './chatFluff.ts';
import { storyBeat } from './storyArcs.ts';
import { openFriendDetail, openStockDetail } from './detail.ts';
import { preCount, stockMoves, streakOf, sumMoves, vsMarket } from './tape.ts';

/** 战绩短写：「1/2」，新来的写「新」。 */
function recShort(record: string): string {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(record);
  return !m || m[2] === '0' ? '新' : `${m[1]}/${m[2]}`;
}

/** 连涨 / 连跌的短说法。 */
function streakText(n: number): string {
  return n >= 2 ? `连涨${n}天` : n <= -2 ? `连跌${-n}天` : n === 1 ? '昨天涨' : n === -1 ? '昨天跌' : '昨天平';
}

/** 和大环境比（画面层自己的说法，不用行话）：差距 ±1 个点以内算随大流。 */
function vsLabel(d: number | null): { word: string; sign: number } | null {
  if (d === null) return null;
  if (d > 1) return { word: '跑赢大环境', sign: 1 };
  if (d < -1) return { word: '跑输大环境', sign: -1 };
  return { word: '随大环境', sign: 0 };
}
import { PHONE_RECT as PHONE } from './layout.ts';

/**
 * 手机屏幕区域（外框内缩 14）。真手机横屏（0.5.5）上群聊在右边的标签页里：不画手机外框和群名条
 * （标签页上写群名人数），消息和推荐卡分成「群聊」「推荐」两页。
 */
const INSET = PHONE_MODE ? 4 : 14;
const SX = PHONE.x + INSET;
const SW = PHONE.w - INSET * 2;
const HEADER_H = PHONE_MODE ? 0 : 50;
const BODY_Y = PHONE.y + INSET + HEADER_H;
const BODY_H = PHONE.y + PHONE.h - INSET - BODY_Y;
const PAD = 8;
const CX = SX + PAD;
const CW = SW - PAD * 2;
const AVATAR = 32;
const BUBBLE_X = CX + AVATAR + 6;
const BUBBLE_W = CW - AVATAR - 6;
/** 0.5.1 推荐卡：题材顶条 + 名字角色 + 5 天走势与连涨 + 推荐人战绩 + 一句理由 */
const REC_H = 106;
/** 推荐多（FOMO 给 4 条）、消息又多时的扁推荐卡：小人缩小，理由仍保留一行，全文在悬停提示里 */
const REC_H_FLAT = 68;
/** 消息特别多的日子（比如开了 FOMO 和小道消息）：推荐卡再压一档，保证当天消息完整显示 */
const REC_H_MINI = 56;
const GAP = 6;

/** 气泡里的短话：一行放得下多少字就留多少（13 号字约 15 字），整句在悬停提示里。 */
function bubbleLine(text: string, size: number): string {
  return shortLine(text, '', Math.floor((BUBBLE_W - 20) / size));
}

/** 推荐卡上「买入」按钮的状态 */
type RecAction = 'buy' | 'replace' | null;

/** 推荐卡能做什么：直接买入（有空格）、换仓（满仓但能替换）、不能买（给原因）。 */
export function recAction(s: GameState, r: RecView): { action: RecAction; reason: string | null } {
  if (r.taken) return { action: null, reason: '今天已经买了这只' };
  if (!r.error) return { action: 'buy', reason: null };
  const replaceable = s.slots.some((_, i) => buyError(s, r.index, i) === null);
  if (replaceable && s.slots.every((h) => h !== null)) return { action: 'replace', reason: null };
  return { action: null, reason: r.error };
}

interface MsgNode {
  index: number;
  friendId: string;
  /** 名字旁边的战绩（收盘揭晓后跟着规则层更新） */
  rec: Phaser.GameObjects.Text;
  root: Phaser.GameObjects.Container;
  bubble: Rect;
  /** 这条消息（含名字行）的顶边 */
  top: number;
}

/**
 * 右栏手机群聊：消息气泡（头像、名字、战绩、台词、题材方向）、今日推荐卡（小人、理由、买入）、
 * 收盘后在消息上标出说中 / 说错，群友吐槽冒出来。
 */
export class ChatView3 {
  private readonly scene: Phaser.Scene;
  private readonly content: Phaser.GameObjects.Container;
  private readonly title: Phaser.GameObjects.Text;
  private readonly idle: boolean;
  private readonly onBuy: (rec: number) => void;
  private msgs: MsgNode[] = [];
  private recNodes: Phaser.GameObjects.Container[] = [];
  private buttons: (Button | null)[] = [];
  private shortButtons: (Button | null)[] = [];
  /** 0.4 C：点了推荐卡上的"押跌" */
  onShort: ((rec: number) => void) | null = null;
  private recRects: Rect[] = [];
  /** 推荐卡上的 5 天走势（卡片冒出来时从左往右画） */
  private recSparks = new Map<Phaser.GameObjects.Container, Spark>();
  /** 填空白的热闹元素（贴纸、互相回复、撤回、拍一拍） */
  private fluffNodes: { node: Phaser.GameObjects.Container; pop: Phaser.GameObjects.Image | null }[] = [];
  /** 收盘揭晓后的状态（judge 传进来），收盘后的热闹元素按它定调 */
  private closeState: GameState | null = null;
  private cursor = 0;
  private state: GameState;
  /** 盘前之外（结算、月底）显示的系统提示 */
  private extra: string[] = [];
  /** 手机横屏：推荐卡单独一页；底框（纸面、底纹）单独装着，切到「风口」页时整块藏起来 */
  private readonly recLayer: Phaser.GameObjects.Container;
  private readonly frame: Phaser.GameObjects.Container | null;
  private view: 'msgs' | 'recs' | null = 'msgs';

  /** 手机标签页：显示群聊消息、推荐卡，或整块藏起来（null，看「风口」时）。电脑上不用。 */
  setPhoneView(v: 'msgs' | 'recs' | null): void {
    if (!PHONE_MODE) return;
    this.view = v;
    this.frame?.setVisible(v !== null);
    this.content.setVisible(v === 'msgs');
    this.recLayer.setVisible(v === 'recs');
  }

  get phoneView(): 'msgs' | 'recs' | null {
    return this.view;
  }

  /** 今天能买的推荐有几条（手机标签页上的小红点）。 */
  get recCount(): number {
    return this.buttons.filter((b) => !!b && b.active && b.usable).length;
  }

  constructor(scene: Phaser.Scene, s: GameState, idle: boolean, onBuy: (rec: number) => void) {
    this.scene = scene;
    this.state = s;
    this.idle = idle;
    this.onBuy = onBuy;
    const before = scene.children.list.length;
    if (PHONE_MODE) {
      addPaper(scene, PHONE.x, PHONE.y, PHONE.w, PHONE.h);
      scene.add.rectangle(SX, BODY_Y, SW, BODY_H, 0xfdf3e3).setOrigin(0, 0).setRounded(8);
      addTile(scene, SX, BODY_Y, SW, BODY_H, 'chat:chat_bg_tile', 0.7);
    } else {
      addSlice(scene, PHONE.x, PHONE.y, PHONE.w, PHONE.h, 'phone_frame');
      scene.add.rectangle(SX, BODY_Y, SW, BODY_H, 0xfdf3e3).setOrigin(0, 0);
      addTile(scene, SX, BODY_Y, SW, BODY_H, 'chat:chat_bg_tile', 0.7);
      addSlice(scene, SX, PHONE.y + 14, SW, HEADER_H, 'chat_header');
      addImage(scene, PHONE.x + PHONE.w / 2, PHONE.y + 22, 'chat:phone_notch', 96, 22);
    }
    this.title = addText(scene, PHONE.x + PHONE.w / 2, PHONE.y + 14 + HEADER_H / 2 + 6, '', { size: 15, bold: true, originX: 0.5, originY: 0.5 }).setVisible(!PHONE_MODE);
    // 底框先装进容器（排在消息、推荐卡下面）
    this.frame = PHONE_MODE ? scene.add.container(0, 0, scene.children.list.slice(before)) : null;
    this.content = scene.add.container(0, 0);
    this.recLayer = scene.add.container(0, 0);
    this.render(s);
  }

  /** 按状态重建当天的群聊（无动画）。 */
  render(s: GameState, notes: string[] = []): void {
    this.state = s;
    this.extra = notes;
    this.title.setText(`韭菜交流群（${s.friends.length}）`);
    this.content.removeAll(true);
    this.recLayer.removeAll(true);
    this.newsRect = null;
    this.newsOpen = null;
    this.newsOpenRect = null;
    this.newsList = [];
    this.msgs = [];
    this.recNodes = [];
    this.buttons = [];
    this.shortButtons = [];
    this.recRects = [];
    this.recSparks.clear();
    this.fluffNodes = [];
    this.closeState = null;
    const v = chatView(s);
    this.layout(s, v);
  }

  private layout(s: GameState, v: ChatView): void {
    let y = BODY_Y + 8;
    const pill = s.phase === 'premarket' ? `${s.month}月 ${s.dayInMonth + 1}日 · 盘前` : '月底算账';
    for (const note of [pill, ...this.extra]) y = this.addPill(note, y) + 4;
    // 0.5：前几天发的、还没揭晓的多日消息（到揭晓那天收盘时盖章）
    this.watchNodes = [];
    this.watchPills = [];
    const yBeforeWatch = y;
    if (s.phase === 'premarket') y = this.addWatch(s, y);
    if (v.messages.length === 0 && s.phase === 'premarket') y = this.addPill('今天群里没人说话', y) + 4;
    // 先估算总高度，当天消息必须完整显示：放不下时依次 消息改小字号 → 推荐卡压扁 → 两样都用；
    // 还放不下（极少见）才略去最早的几条，并写明略了几条
    const premarket = s.phase === 'premarket';
    // 手机横屏：推荐卡在另一页，这一页只排消息
    const allRecs = premarket ? v.recs : [];
    const recs = PHONE_MODE ? [] : allRecs;
    // 能押跌时推荐卡右边要竖排两颗按钮，最矮一档（56）放不下（押跌按钮会掉出卡外），最矮只压到扁卡（68）
    const minRecH = canShortNow(s) ? REC_H_FLAT : REC_H_MINI;
    const tries: [number, number][] = (
      [
        [13, REC_H],
        [12, REC_H],
        [13, REC_H_FLAT],
        [12, REC_H_FLAT],
        [11, REC_H_FLAT],
        [11, REC_H_MINI],
      ] as [number, number][]
    ).filter(([, rh]) => rh >= minRecH);
    let room = BODY_Y + BODY_H - y;
    // 当天消息优先：等揭晓的多日消息一行一条放不下时，收成一个小签（详情在群友卡和揭晓时的盖章里）
    if (premarket && this.watchNodes.length > 0 && this.estimate(v.messages, recs.length, 11, minRecH) > room) {
      for (const w of this.watchNodes) w.node.destroy();
      for (const n of this.watchPills) n.destroy();
      this.watchNodes = [];
      this.watchPills = [];
      const pending = (s.watch ?? []).filter((w) => w.day < s.today.day).length;
      y = this.addPill(`${pending} 条消息等揭晓`, yBeforeWatch) + 4;
      room = BODY_Y + BODY_H - y;
    }
    // 昨天收盘的新闻放在最上面（解释昨天各风口为什么动）；地方不够时它先让位，今天的消息优先
    const news = premarket ? (s.lastDay?.news ?? []) : [];
    let paper = news.length > 0 ? this.newsFold(news, '昨日新闻') : null;
    const fitIn = (r: number): [number, number] | undefined => tries.find(([size, rh]) => this.estimate(v.messages, recs.length, size, rh) <= r);
    let fit = paper ? fitIn(room - paper.h - GAP) : undefined;
    if (paper && !fit) {
      paper.node.destroy();
      paper = null;
      this.newsRect = null;
    }
    if (paper) {
      paper.node.setY(y).setVisible(true);
      this.content.add(paper.node);
      this.newsRect = { x: CX, y, w: CW, h: paper.h };
      y += paper.h + GAP;
    } else fit = fitIn(room);
    const [size, recH] = fit ?? [11, minRecH];
    let messages = v.messages;
    if (!fit) while (messages.length > 0 && this.estimate(messages, recs.length, size, recH) > BODY_Y + BODY_H - y - 26) messages = messages.slice(1);
    if (messages.length < v.messages.length) y = this.addPill(`+${v.messages.length - messages.length} 条更早`, y) + 4;
    this.recHeight = recH;
    for (const m of messages) y = this.addMessage(m, y, size) + GAP;
    if (premarket) {
      // 0.5.1：消息和推荐卡都排下以后，剩下的空白用群友的贴纸、互相回复、撤回、拍一拍填上（纯装饰）
      const recsH = recs.length > 0 ? 2 + recs.length * (recH + GAP) : 0;
      y = this.addFluff(s, y, BODY_Y + BODY_H - 4 - recsH, 'pre', messages.map((m) => ({ friendId: m.friend.id, text: m.text }))).y;
      if (recs.length > 0) y += 2;
      for (const r of recs) y = this.addRec(s, r, y, recH) + GAP;
      if (PHONE_MODE) this.layoutRecs(s, allRecs, minRecH);
    } else {
      // 月底算账等时候群里也不冷场
      y = this.addFluff(s, y, BODY_Y + BODY_H - 6, 'month', messages.map((m) => ({ friendId: m.friend.id, text: m.text }))).y;
    }
    this.cursor = y;
  }

  /** 手机横屏的「推荐」页：推荐卡从上往下排，放得下用大卡，放不下压扁。 */
  private layoutRecs(s: GameState, recs: readonly RecView[], minRecH: number): void {
    const gap = 4;
    const room = BODY_H - 6;
    const h = [REC_H, REC_H_FLAT, REC_H_MINI].find((rh) => rh >= minRecH && recs.length * (rh + gap) <= room) ?? minRecH;
    let y = BODY_Y + 4;
    for (const r of recs) {
      y = this.addRec(s, r, y, h) + gap;
      const node = this.recNodes[this.recNodes.length - 1];
      if (node) {
        this.content.remove(node);
        this.recLayer.add(node);
      }
    }
    if (recs.length === 0) {
      const t = addText(this.scene, SX + SW / 2, BODY_Y + 40, '今天没有推荐', { size: 13, color: COLOR.muted, originX: 0.5 });
      this.recLayer.add(t);
    }
    this.recHeight = h;
  }

  /** 多日消息区里的"+N 条待揭晓"小签（收起时一起删掉）。 */
  private watchPills: Phaser.GameObjects.GameObject[] = [];
  /** 当前推荐卡高度（自动化检查用）。 */
  recHeight = REC_H;
  /** 当天消息里实际显示了几条。 */
  get shownMessages(): number {
    return this.msgs.length;
  }

  private estimate(messages: readonly MessageView[], recs: number, size: number, recH: number): number {
    let h = 0;
    for (const m of messages) {
      const t = addText(this.scene, 0, 0, bubbleLine(m.text, size), { size, wrap: BUBBLE_W - 20, lineSpacing: 2 });
      // 拐点消息的标签可能放进气泡第一行，按最坏情况多算 18
      h += 18 + t.height + 12 + GAP + (m.turn ? 18 : 0);
      t.destroy();
    }
    return h + recs * (recH + GAP) + (recs > 0 ? 6 : 0);
  }

  private addPill(text: string, y: number): number {
    const t = addText(this.scene, SX + SW / 2, y + 11, text, { size: 11, color: COLOR.muted, originX: 0.5, originY: 0.5 });
    const w = Math.min(CW, t.width + 24);
    const bg = addSlice(this.scene, SX + SW / 2 - w / 2, y, w, 22, 'system_pill');
    this.content.add([bg, t]);
    return y + 22;
  }

  /** 群友头像：悬停看简介，点一下打开群友详情（战绩、最近说对说错）。 */
  private avatar(friendId: string, x: number, y: number, face: AvatarFace = 'normal', size = AVATAR): Phaser.GameObjects.Image {
    const img = addImage(this.scene, x + size / 2, y + size / 2, avatarKey(friendId, face), size);
    img.setInteractive({ useHandCursor: true });
    bindTooltip(img, () => ({ x, y, w: size, h: size }), () => {
      if (!this.state.friends.some((f) => f.id === friendId)) return null;
      const f = friendView(this.state, friendId);
      return { title: `${f.name}（${f.title}）· ${recordText(f.record)}`, body: `${f.desc}\n最懂：${f.topics}\n${term('record').explain}\n点头像看他最近说得准不准。` };
    });
    img.on(Phaser.Input.Events.POINTER_UP, (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      if (!this.state.friends.some((f) => f.id === friendId)) return;
      ev.stopPropagation();
      openFriendDetail(this.scene, this.state, friendId);
    });
    return img;
  }

  /** 名字旁边的战绩：靶子小图标 + 「3/5」（新来的写「新」）。 */
  private recordTag(record: string, x: number, y: number): { icon: Phaser.GameObjects.Image; text: Phaser.GameObjects.Text; w: number } {
    const icon = addGlyph(this.scene, x + 6, y + 7, 'target', 12);
    const text = addText(this.scene, x + 13, y, recShort(record), { size: 11, bold: true, num: true, color: COLOR.muted });
    text.setInteractive();
    bindTooltip(text, () => ({ x: text.x, y: text.y, w: text.width, h: 16 }), () => termTip('record'));
    return { icon, text, w: 13 + text.width };
  }

  private addMessage(m: MessageView, y: number, size: number): number {
    const s = this.scene;
    const root = s.add.container(0, 0);
    const av = this.avatar(m.friend.id, CX, y);
    const name = addText(s, BUBBLE_X, y - 1, m.friend.name, { size: 12, bold: true });
    const badge = this.ownerBadge(m.friend, BUBBLE_X + name.width + 4, y);
    const tag = this.recordTag(m.friend.record, BUBBLE_X + name.width + 4 + (badge ? badge.w + 2 : 0), y);
    const rec = tag.text;
    if (badge) root.add(badge.node);
    root.add(tag.icon);
    // 题材方向标签（右上）
    const sign = claimSign(m.reverse && m.readAs ? m.readAs : m.claim);
    const fill = sign > 0 ? 0xffd9d2 : sign < 0 ? 0xd4f0dd : 0xece3ea;
    const ink = sign > 0 ? COLOR.up : sign < 0 ? COLOR.down : COLOR.muted;
    // 反着信群主：群主的话按反方向读（readAsLabel）
    const raw = this.state.today.messages[m.index];
    const days = raw?.days ?? 1;
    const big = !!raw?.big;
    // 0.5：风口图标 + 箭头 + 天数（「AI 2天内 涨」这类整句在悬停提示里）
    const dirSign = claimSign(m.reverse && m.readAs ? m.readAs : m.claim);
    const arrow = dirSign > 0 ? '↑' : dirSign < 0 ? '↓' : '→';
    // 0.5.1：「反」看不懂，写成「反着听」（箭头已经是反过来之后的方向）
    const chipLabel = `${m.reverse && m.readAs ? '反着听' : ''}${arrow}${days > 1 ? `${days}天` : ''}${m.certain ? '必中' : ''}`;
    const chipText = addText(s, 0, y + 7, chipLabel, { size: 13, bold: true, color: ink, originX: 1, originY: 0.5 });
    const chipW = chipText.width + 34;
    const chip = addPill(s, CX + CW - chipW, y - 3, chipW, 20, fill, false);
    const themeIcon = addImage(s, CX + CW - chipW + 12, y + 7, `theme:${m.theme}`, 18);
    chip.setInteractive();
    bindTooltip(chip, () => ({ x: CX + CW - chipW, y: y - 2, w: chipW, h: 18 }), () => {
      const dir = DIR_WORD[m.reverse && m.readAs ? m.readAs : m.claim];
      const base = m.reverse ? `${m.friend.name}说${m.themeName}今天${DIR_WORD[m.claim]}；你有反着听的道具，按${dir}看。` : `${m.friend.name}说「${m.themeName}」这个风口今天${dir}。`;
      const flatNote = m.claim === 'flat' ? `\n${term('flat').word}：${term('flat').explain}` : '';
      const when = days > 1 ? `\n说的是接下来 ${days} 天（含今天）加起来的方向，第 ${days} 天收盘才见分晓。` : '';
      return { title: `${m.themeName} · ${dir}`, body: `${base}准不准，看他名字旁边的「说对 几/几」。${when}${flatNote}` };
    });
    chipText.setX(CX + CW - 6);
    // 拐点消息（「他觉得：要凉了」）：名字那行放得下就放名字后面，放不下就放进气泡第一行
    const turnText = m.turn ? addText(s, 0, 0, TURN_LABEL[m.turn].replace(/^.*：/, ''), { size: 10, bold: true, color: COLOR.ink, originY: 0.5 }) : null;
    let tx = rec.x + rec.width + 6;
    if (!turnText && m.friend.title !== '群主') {
      const title = addText(s, tx, y, m.friend.title, { size: 10, color: COLOR.dim });
      if (title.width <= CX + CW - chipW - 6 - tx) {
        root.add(title);
        tx += title.width + 6;
      } else title.destroy();
    }
    const inRow = turnText !== null && turnText.width + 10 <= CX + CW - chipW - 6 - tx;
    const inBubble = turnText !== null && !inRow;
    // 气泡里只放 ≤10 字的短话，整句点开（悬停 / 长按）看
    const text = addText(s, BUBBLE_X + 12, y + 24 + (inBubble ? 18 : 0), bubbleLine(m.text, big ? size + 1 : size), { size: big ? size + 1 : size, bold: big, wrap: BUBBLE_W - 20, lineSpacing: 2 });
    const bh = text.height + 12 + (inBubble ? 18 : 0);
    const bubble = addSlice(s, BUBBLE_X, y + 18, BUBBLE_W, bh, 'bubble_left');
    const full = m.text;
    if (text.text !== full) {
      const hit = s.add.rectangle(BUBBLE_X, y + 18, BUBBLE_W, bh, 0xffffff, 0.001).setOrigin(0, 0).setInteractive();
      bindTooltip(hit, () => ({ x: BUBBLE_X, y: y + 18, w: BUBBLE_W, h: bh }), () => ({ title: m.friend.name, body: full }));
      root.add(hit);
    }
    root.add([av, name, rec, chip, themeIcon, chipText, bubble, text]);
    if (big) {
      // 重磅情报：金色粗框 + 「重磅」签压在气泡左上角
      const ring = s.add.rectangle(BUBBLE_X + 2, y + 18, BUBBLE_W - 2, bh).setOrigin(0, 0).setRounded(10).setStrokeStyle(3.5, COLOR.accent, 1);
      const bt = addText(s, 0, 0, '重磅', { size: 10, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
      const bp = addPill(s, BUBBLE_X + BUBBLE_W - bt.width - 18, y + 18 + bh - 9, bt.width + 12, 16, COLOR.danger, false);
      bt.setPosition(bp.x + (bt.width + 12) / 2, bp.y + 8);
      bp.setInteractive();
      bindTooltip(bp, () => ({ x: bp.x, y: bp.y, w: bt.width + 12, h: 16 }), () => ({ title: '重磅情报', body: '这个月的大事：群里最靠谱的人说的，多半是真的。' }));
      root.add([ring, bp, bt]);
    }
    if (turnText) {
      const ring = s.add.rectangle(BUBBLE_X + 3, y + 19, BUBBLE_W - 4, bh - 3).setOrigin(0, 0).setRounded(10).setStrokeStyle(2.5, COLOR.gold, 1);
      const px = inRow ? tx : BUBBLE_X + 12;
      const py = inRow ? y - 2 : y + 24;
      const pill = addPill(s, px, py, turnText.width + 10, 16, COLOR.gold, false);
      pill.setInteractive();
      bindTooltip(pill, () => ({ x: px, y: py, w: turnText.width + 10, h: 16 }), () => termTip('turn'));
      turnText.setPosition(px + 5, py + 8);
      root.add([ring, pill, turnText]);
    }
    this.content.add(root);
    this.msgs.push({ index: m.index, friendId: m.friend.id, rec, root, bubble: { x: BUBBLE_X, y: y + 18, w: BUBBLE_W, h: bh }, top: y });
    return y + 18 + bh;
  }

  /**
   * 在 y 到 limit 之间放热闹元素（确定性随机：同一天重绘一样），放不下的跳过。
   * 返回新的 y 和放进去的节点（已加进群聊容器）。
   */
  private addFluff(s: GameState, y: number, limit: number, salt: string, said: { friendId: string; text: string }[]): { y: number; nodes: { node: Phaser.GameObjects.Container; pop: Phaser.GameObjects.Image | null }[] } {
    const nodes: { node: Phaser.GameObjects.Container; pop: Phaser.GameObjects.Image | null }[] = [];
    if (limit - y < 22 || s.friends.length === 0) return { y, nodes };
    const friends = s.friends.map((f) => ({ id: f.id, name: friendView(s, f.id).name }));
    const tone = toneOf(s.lastDay ? s.lastDay.market.ret : null);
    const list = makeFluff({ seed: s.seed, day: s.today.day, salt, tone, friends, said, max: 4 });
    // 0.6.3 群友连载：每个讲故事的月份，月底算账时先发一段（引用上一段）；盘前推荐卡多，放不下
    const beat = salt === 'month' ? storyBeat({ seed: s.seed, month: s.month, months: runMonths(s), friendIds: s.friends.map((x) => x.id) }) : null;
    if (beat) list.unshift({ kind: 'reply', friendId: beat.friendId, toId: beat.friendId, quote: beat.quote, text: beat.text });
    for (const f of list) {
      if (limit - y < 22) break;
      const n = this.fluffNode(s, f, y);
      if (y + n.h > limit) {
        n.node.destroy();
        continue;
      }
      this.content.add(n.node);
      const item = { node: n.node, pop: n.pop };
      nodes.push(item);
      this.fluffNodes.push(item);
      y += n.h + GAP;
    }
    return { y, nodes };
  }

  /** 一条热闹元素：贴纸（大图标 + 贴纸字）、带引用条的回复、撤回 / 拍一拍的系统提示。 */
  private fluffNode(s: GameState, f: Fluff, y: number): { node: Phaser.GameObjects.Container; h: number; pop: Phaser.GameObjects.Image | null } {
    const sc = this.scene;
    const node = sc.add.container(0, 0);
    const nameOf = (id: string): string => (s.friends.some((x) => x.id === id) ? friendView(s, id).name : '群友');
    if (f.kind === 'recall' || f.kind === 'poke' || f.kind === 'note') {
      const t = addText(sc, SX + SW / 2, y + 11, fluffNote(f, nameOf), { size: 11, color: COLOR.muted, originX: 0.5, originY: 0.5 });
      const w = Math.min(CW, t.width + 24);
      node.add([addSlice(sc, SX + SW / 2 - w / 2, y, w, 22, 'system_pill'), t]);
      return { node, h: 22, pop: null };
    }
    const av = this.avatar(f.friendId, CX, y);
    const name = addText(sc, BUBBLE_X, y - 1, nameOf(f.friendId), { size: 12, bold: true });
    node.add([av, name]);
    if (f.kind === 'sticker') {
      // 表情包：淡色圆角底 + 大图标 + 压在底边的描边字
      const w = 88;
      const h = 82;
      const bg = sc.add.rectangle(BUBBLE_X, y + 18, w, h, 0xffffff, 0.8).setOrigin(0, 0).setRounded(14).setStrokeStyle(2, COLOR.edge, 1);
      const img = addGlyph(sc, BUBBLE_X + w / 2, y + 18 + 33, f.glyph as Glyph, 58);
      const cap = addText(sc, BUBBLE_X + w / 2, y + 18 + h - 11, f.caption, { size: 12, bold: true, color: COLOR.white, stroke: COLOR.ink, strokeWidth: 3, originX: 0.5, originY: 0.5 });
      node.add([bg, img, cap]);
      return { node, h: 18 + h, pop: img };
    }
    // 互相回复：气泡里先是一条灰色引用（「老王：大消费，不急」），下面是回复
    const quote = addText(sc, BUBBLE_X + 20, y + 23, f.quote, { size: 10, color: COLOR.muted });
    fitWidth(quote, BUBBLE_W - 36, 2);
    const qbg = sc.add.rectangle(BUBBLE_X + 10, y + 22, quote.width + 16, 16, 0xf1e7da, 1).setOrigin(0, 0).setRounded(4);
    const bar = sc.add.rectangle(BUBBLE_X + 12, y + 24, 3, 12, COLOR.edge, 1).setOrigin(0, 0);
    const text = addText(sc, BUBBLE_X + 12, y + 42, f.text, { size: 13, wrap: BUBBLE_W - 20, lineSpacing: 2 });
    const bh = 24 + text.height + 8;
    const bubble = addSlice(sc, BUBBLE_X, y + 18, BUBBLE_W, bh, 'bubble_left');
    node.add([bubble, qbg, bar, quote, text]);
    return { node, h: 18 + bh, pop: null };
  }

  private addRec(s: GameState, r: RecView, y: number, h = REC_H): number {
    const sc = this.scene;
    const root = sc.add.container(0, 0);
    const flat = h < REC_H;
    const card = addSlice(sc, CX, y, CW, h, 'bubble_card');
    // 顶条跟随风口颜色（素材自带的是橙色）：盖一层风口色，再补回分隔线
    const tc = THEME_COLOR[r.stock.theme];
    const on = textOn(tc);
    const bandH = flat ? 15 : 16;
    const band = sc.add.graphics();
    band.fillStyle(tc, 1).fillRoundedRect(CX + 4, y + 4, CW - 8, bandH, { tl: 13, tr: 13, bl: 0, br: 0 });
    band.fillStyle(COLOR.ink, 1).fillRect(CX + 3, y + 3 + bandH, CW - 6, 2.4);
    const who = r.friend ? `${r.friend.name}推荐` : '行情软件推荐';
    // 顶条：左「风口名 热度 NN」，右「★ 今日推荐」（0.5.1 找回）
    const by = y + 4 + bandH / 2;
    const heat = Math.round(s.themes[r.stock.theme]?.heat ?? 0);
    const head = addText(sc, CX + 14, by, r.stock.themeName, { size: 11, bold: true, color: on, originY: 0.5 });
    const heatT = addText(sc, head.x + head.width + 6, by, `热度${heat}`, { size: 11, bold: true, num: true, color: on, originY: 0.5 });
    const today = addText(sc, CX + CW - 12, by, '今日推荐', { size: 10, bold: true, color: on, originX: 1, originY: 0.5 });
    const star = addGlyph(sc, today.x - today.width - 8, by, 'star', 11);
    root.add([card, band, head, heatT, today, star]);

    // 小人（带表情；动画开着时隔几秒蹦一下，像在招手）+ 放大镜：点卡身看详情
    const gx = flat ? 22 : 30;
    const tx = flat ? 44 : 60;
    const guyY = flat ? y + h - 5 : y + 78;
    const guy = new StockGuy(sc, CX + gx, guyY, r.stock.id, r.stock.face, flat ? 32 : 48, { idle: this.idle });
    if (this.idle) {
      const tw = sc.tweens.add({ targets: guy, y: guyY - (flat ? 3 : 5), duration: 170, yoyo: true, repeat: -1, repeatDelay: 2600 + r.index * 900, delay: 1200 + r.index * 500, ease: 'Quad.easeOut' });
      guy.once(Phaser.GameObjects.Events.DESTROY, () => tw.remove());
    }
    const glass = addGlyph(sc, CX + gx + (flat ? 14 : 20), y + bandH + (flat ? 12 : 14), 'magnifier', flat ? 13 : 16);
    root.add([guy, glass]);

    // 第一行：名字 + 角色图标 + 角色名（危险股红字）
    const right = CX + CW - (flat ? 66 : 70);
    const row1 = y + bandH + (flat ? 6 : 8);
    const name = addText(sc, CX + tx, row1, r.stock.name, { size: flat ? 13 : 14, bold: true });
    const roleIcon = addImage(sc, name.x + name.width + 10, row1 + 9, `role:${r.stock.role}`, flat ? 15 : 17);
    const roleT = addText(sc, roleIcon.x + 10, row1 + 9, ROLE_WORD[r.stock.role], { size: 10, bold: true, color: r.stock.role === 'st' ? COLOR.danger : COLOR.muted, originY: 0.5 });
    if (roleT.x + roleT.width > right) roleT.setVisible(false);
    for (const o of [roleIcon, roleT]) {
      o.setInteractive();
      bindTooltip(o, () => ({ x: roleIcon.x - 9, y: row1, w: 20 + (roleT.visible ? roleT.width : 0), h: 20 }), () => termTip(ROLE_TERM[r.stock.role]));
    }
    root.add([name, roleIcon, roleT]);

    // 5 天涨跌柱（出现时从左往右画出来）+ 连涨连跌 + 比大环境强弱
    const moves = stockMoves(s, r.stock.id, 5);
    const streak = streakOf(moves);
    const vs = vsLabel(vsMarket(s, r.stock.id, 5));
    const row2 = flat ? row1 : row1 + 19;
    let x2 = flat ? Math.max(roleIcon.x + 12, roleT.visible ? roleT.x + roleT.width + 6 : 0) : CX + tx;
    const sparkW = flat ? 28 : 36;
    let spark: Spark | null = null;
    let streakT: Phaser.GameObjects.Text | null = null;
    if (moves.length > 0 && x2 + sparkW <= right) {
      spark = addSpark(sc, x2, row2 + 2, sparkW, flat ? 14 : 16, moves, { kind: 'bars', capMin: 3, bg: COLOR.paperHi, bgAlpha: 0.9, pre: preCount(s, moves.length) });
      root.add(spark.g);
      x2 += sparkW + 7;
      streakT = addText(sc, x2, row2 + 10, flat ? streakText(streak).replace('天', '') : streakText(streak), { size: 11, bold: true, color: streak === 0 ? COLOR.muted : signColor(streak), originY: 0.5 });
      if (streakT.x + streakT.width > right) {
        streakT.destroy();
        streakT = null;
      } else {
        root.add(streakT);
        x2 += streakT.width + 6;
      }
    }
    // 强弱签：第二行放不下就放到推荐人那一行（扁卡放不下就只在悬停里）
    const vsTag = (x: number, yy: number): number => {
      if (!vs) return 0;
      const t = addText(sc, 0, yy + 9, vs.word, { size: 10, bold: true, color: vs.sign === 0 ? COLOR.muted : signColor(vs.sign), originY: 0.5 });
      const w = t.width + 10;
      if (x + w > right) {
        t.destroy();
        return 0;
      }
      const bg = addPill(sc, x, yy + 1, w, 16, vs.sign > 0 ? 0xffe3dc : vs.sign < 0 ? 0xdcf2e3 : 0xece3ea, false);
      t.setX(x + 5);
      root.add([bg, t]);
      return w;
    };
    let vsShown = vsTag(x2, row2) > 0;

    // 推荐人：小头像 + 名字 + 战绩（扁卡省掉，只在理由前放小头像）
    const row3 = row2 + 19;
    if (!flat) {
      let x3 = CX + tx;
      if (r.friend) {
        const av = this.avatar(r.friend.id, x3, row3, 'normal', 18);
        const fn = addText(sc, x3 + 22, row3 + 1, r.friend.name, { size: 11, bold: true, color: COLOR.ink });
        const tag = this.recordTag(r.friend.record, fn.x + fn.width + 3, row3 + 1);
        root.add([av, fn, tag.icon, tag.text]);
        x3 = tag.text.x + tag.text.width + 6;
      } else {
        const fn = addText(sc, x3, row3 + 1, '行情软件', { size: 11, bold: true, color: COLOR.muted });
        root.add(fn);
        x3 += fn.width + 6;
      }
      if (!vsShown) vsShown = vsTag(x3, row3) > 0;
    }

    // 理由：一句不超过 12 个字的短话（不是硬截断），全文在悬停提示里
    const ry = flat ? y + h - 22 : y + h - 24;
    const rx = flat ? CX + tx : CX + 10;
    // 押跌按钮在时右边那列一直到卡底，理由条让开
    const rw = flat || (!r.taken && canShortNow(s)) ? right - rx : CW - 20;
    let reasonX = rx;
    if (flat && r.friend) {
      root.add(this.avatar(r.friend.id, rx, ry, 'normal', 16));
      reasonX += 20;
    } else if (!flat) {
      // 理由条：淡黄底 + 左边一道风口色竖条（像引用）
      const strip = sc.add.rectangle(rx, ry - 2, rw, 21, 0xffefc9, 1).setOrigin(0, 0).setRounded(8).setStrokeStyle(1.5, COLOR.edge, 1);
      const q = sc.add.rectangle(rx + 6, ry + 2, 4, 13, tc, 1).setOrigin(0, 0).setRounded(2);
      root.add([strip, q]);
      reasonX += 16;
    }
    const reason = addText(sc, reasonX, ry + (flat ? 1 : 0), shortLine(r.text, r.stock.name, 12), { size: flat ? 11 : 12, color: COLOR.ink });
    fitWidth(reason, rx + rw - reasonX - 4, 1);
    root.add(reason);

    // 卡身（按钮以外）：悬停看全文和数据，点一下打开股票详情
    const hit = sc.add.rectangle(CX, y, CW - 72, h, 0xffffff, 0.001).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    const sum = moves.length > 0 ? sumMoves(moves) : null;
    bindTooltip(hit, () => ({ x: CX, y, w: CW - 72, h }), () => ({
      title: `${r.stock.name}（${r.stock.themeName} · ${ROLE_WORD[r.stock.role]}）`,
      body: `${who}：${r.text}\n${sum === null ? '' : `最近 ${moves.length} 天合计 ${sum >= 0 ? '+' : ''}${sum.toFixed(1)}%，${streakText(streak)}`}${vs ? `，${vs.word}` : ''}\n点卡片看详情。`,
    }));
    hit.on(Phaser.Input.Events.POINTER_UP, (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      openStockDetail(sc, this.state, r.stock.id);
    });
    root.addAt(hit, 1);
    if (spark) this.recSparks.set(root, spark);
    const act = recAction(s, r);
    // 0.4 C：押跌解锁后，买入按钮下面多一个"押跌"（唱空群友推荐的这只，押跌按钮更醒目）
    const canShort = !r.taken && canShortNow(s);
    const hintShort = canShort && !!r.short;
    // 按钮列：扁卡顶条下面放得下两颗小按钮
    const bx = CX + CW - (flat ? 62 : 66);
    const bw = flat ? 56 : 60;
    const buyY = canShort ? y + (flat ? 20 : 24) : y + (flat ? 25 : 32);
    const buyH = canShort ? (flat ? 22 : 26) : flat ? 30 : 36;
    const shortY = y + (flat ? 44 : 54);
    const shortH = flat ? 21 : 26;
    const btn = new Button(sc, bx, buyY, {
      width: bw,
      height: buyH,
      // 押跌拿下的写"已押跌"，不写"已买"
      label: r.taken ? (s.slots.some((h) => h?.stockId === r.stock.id && h.short) ? '已押' : '已买') : act.action === 'replace' ? '换掉' : '买入',
      variant: hintShort ? 'default' : 'buy',
      fontSize: canShort ? 13 : 14,
      hotkey: canShort ? undefined : buyKey(r.index),
      sound: null,
      onClick: () => this.onBuy(r.index),
    });
    btn.setEnabled(act.action !== null);
    btn.onDenied(() => act.reason);
    btn.tooltip(() =>
      act.action === 'replace'
        ? { title: '格子满了', body: '点一下，再选要换掉哪一格（那只会被卖掉）。今天买的那只不能换。' }
        : act.reason
          ? { title: '现在不能买', body: act.reason }
          : null,
    );
    root.add(btn);
    if (canShort) {
      const sb = new Button(sc, bx, shortY, {
        width: bw,
        height: shortH,
        label: '押跌',
        variant: 'danger',
        fontSize: 13,
        sound: null,
        onClick: () => this.onShort?.(r.index),
      });
      sb.setEnabled(act.action !== null);
      sb.onDenied(() => act.reason);
      sb.tooltip(() => ({ title: hintShort ? `${r.friend?.name ?? '群友'}建议押跌` : '押跌', body: '押它跌：它跌你赚，它涨你亏；它涨停那天会被轧，亏得最狠。' }));
      if (hintShort) {
        // 唱空的群友推荐的：押跌按钮套一圈金边，更醒目
        root.add(sc.add.rectangle(bx - 3, shortY - 3, bw + 6, shortH + 6, COLOR.gold, 1).setOrigin(0, 0).setRounded(9));
      }
      root.add(sb);
      this.shortButtons[r.index] = sb;
    }
    this.content.add(root);
    this.recNodes.push(root);
    this.buttons[r.index] = btn;
    this.recRects[r.index] = { x: CX, y, w: CW, h };
    return y + h;
  }

  /** 先把当天的消息藏起来（月份开场时），随后由 intro 依次冒出。 */
  hideAll(): void {
    for (const n of [...this.msgs.map((m) => m.root), ...this.fluffNodes.map((f) => f.node), ...this.recNodes]) n.setAlpha(0);
  }

  /** 盘前：消息与推荐依次冒出来（每条一声「叮」）。 */
  async intro(anim: Animator, gap = 160): Promise<void> {
    const fluff = new Map(this.fluffNodes.map((f) => [f.node, f.pop]));
    const nodes: Phaser.GameObjects.Container[] = [...this.msgs.map((m) => m.root), ...this.fluffNodes.map((f) => f.node), ...this.recNodes];
    if (anim.instant) {
      for (const n of nodes) n.setAlpha(1).setY(0);
      return;
    }
    // 总时长不变：原来按「消息 + 推荐卡」条数算的时间，均摊给多出来的热闹元素
    const base = nodes.length - fluff.size;
    const step = base > 0 && fluff.size > 0 ? (gap * base) / nodes.length : gap;
    for (const n of nodes) n.setAlpha(0);
    let i = 0;
    for (const n of nodes) {
      if (!n.active) continue;
      if (!fluff.has(n)) sound.cue({ type: 'chat', index: i });
      n.setAlpha(1);
      if (!anim.calm) {
        n.y = 10;
        anim.fx({ targets: n, y: 0, duration: 180, ease: 'Back.easeOut' }, () => n.setY(0));
        // 贴纸弹一下
        const pop = fluff.get(n);
        if (pop) {
          const sx = pop.scaleX;
          const sy = pop.scaleY;
          pop.setScale(sx * 0.3, sy * 0.3);
          anim.fx({ targets: pop, scaleX: sx, scaleY: sy, duration: 320, ease: 'Back.easeOut' }, () => pop.setScale(sx, sy));
        }
      }
      this.recSparks.get(n)?.play(420, anim.calm);
      i += 1;
      await anim.wait(step);
    }
    for (const n of nodes) if (n.active) n.setAlpha(1).setY(0);
  }

  /** 收盘后：消息逐条标出说中 / 说错。 */
  async judge(anim: Animator, judges: MessageJudge[], gap = 90, next: GameState | null = null): Promise<void> {
    if (next) {
      this.refreshRecords(next);
      this.closeState = next;
    }
    for (const j of judges) {
      const m = this.msgs.find((x) => x.index === j.index);
      if (!m) continue;
      const label = j.hit ? '说对了' : '说错了';
      const t = addText(this.scene, 0, 0, label, { size: 10, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
      const w = t.width + 10;
      const pill = addPill(this.scene, -w / 2, -8, w, 16, j.hit ? COLOR.accent : 0x8d7b84);
      // 盖在头像下半截（不压消息文字）
      const stamp = this.scene.add.container(CX + AVATAR / 2, m.top + AVATAR - 4, [pill, t]).setAngle(-8);
      m.root.add(stamp);
      sound.cue({ type: 'judge', hit: j.hit });
      if (!anim.calm) {
        stamp.setScale(1.8);
        anim.fx({ targets: stamp, scale: 1, duration: 160, ease: 'Quad.easeIn' }, () => stamp.setScale(1));
      }
      await anim.wait(gap);
    }
  }

  /** 名字旁边的战绩换成规则层最新的（收盘揭晓之后）。 */
  refreshRecords(next: GameState): void {
    for (const m of this.msgs) {
      if (!m.rec.active || !next.friends.some((f) => f.id === m.friendId)) continue;
      m.rec.setText(recShort(friendView(next, m.friendId).record));
    }
  }

  /** 0.5：等揭晓的多日消息（按发出那天 + 下标认） */
  private watchNodes: { day: number; index: number; node: Phaser.GameObjects.Container; w: number }[] = [];

  /** 前几天发的多日消息：一行一条「老王 2 天前说：AI 3天内涨 · 还剩 1 天」，最多 3 条。 */
  private addWatch(s: GameState, y: number): number {
    const list = (s.watch ?? []).filter((w) => w.day < s.today.day).sort((a, b) => a.day + a.days - (b.day + b.days));
    const shown = list.slice(0, 3);
    for (const w of shown) {
      const ago = s.today.day - w.day;
      const left = w.day + w.days - s.today.day;
      const name = s.friends.some((f) => f.id === w.friendId) ? friendView(s, w.friendId).name : '群友';
      const sign = claimSign(w.claim);
      const ink = sign > 0 ? COLOR.up : sign < 0 ? COLOR.down : COLOR.muted;
      const r = addText(this.scene, CW - 8, 11, left <= 1 ? '今天揭晓' : `剩${left}天`, { size: 10, bold: left <= 1, color: left <= 1 ? COLOR.accentDark : COLOR.muted, originX: 1, originY: 0.5 });
      const room = CW - 8 - r.width - 16;
      // 0.5.1：找回「N天前」——左边灰字写哪天说的，后面是谁说哪个风口几天内往哪走
      const when = addText(this.scene, 8, 11, `${ago}天前`, { size: 10, color: COLOR.muted, originY: 0.5 });
      const t = addText(this.scene, 8 + when.width + 5, 11, `${name}：${themeById(w.theme).name} ${sign > 0 ? '↑' : sign < 0 ? '↓' : '→'}${w.days}天`, { size: 11, bold: true, color: ink, originY: 0.5 });
      const tRoom = room - when.width - 5;
      fitWidth(t, tRoom, 3);
      const bg = this.scene.add.rectangle(0, 0, CW, 22, 0xfff3d6).setOrigin(0, 0).setRounded(8).setStrokeStyle(1.5, COLOR.gold, 1);
      const node = this.scene.add.container(CX, y, [bg, when, t, r]);
      bg.setInteractive();
      bindTooltip(bg, () => ({ x: CX, y: node.y, w: CW, h: 22 }), () => ({ title: '等揭晓的消息', body: `${name} ${ago} 天前说「${themeById(w.theme).name}」接下来 ${w.days} 天加起来${DIR_WORD[w.claim]}，第 ${w.days} 天收盘时揭晓说没说对。` }));
      this.content.add(node);
      this.watchNodes.push({ day: w.day, index: w.index, node, w: CW });
      y += 22 + 4;
    }
    if (list.length > shown.length) {
      y = this.addPill(`+${list.length - shown.length} 条待揭晓`, y) + 4;
      // addPill 加了底和字两个对象
      this.watchPills.push(...(this.content.list.slice(-2) as Phaser.GameObjects.GameObject[]));
    }
    return y;
  }

  /** 0.5：多日消息到期揭晓——在那一行盖「说对了 / 翻车了」。 */
  async judgeIntel(anim: Animator, judges: MessageJudge[], gap = 90): Promise<void> {
    for (const j of judges) {
      const w = this.watchNodes.find((x) => x.day === j.day && x.index === j.index);
      if (!w || !w.node.active) continue;
      const t = addText(this.scene, 0, 0, j.hit ? '说对了' : '翻车了', { size: 10, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
      const pw = t.width + 10;
      const pill = addPill(this.scene, -pw / 2, -8, pw, 16, j.hit ? COLOR.accent : 0x8d7b84);
      const st = this.scene.add.container(w.w - 36, 11, [pill, t]).setAngle(-6);
      // 盖住「今天收盘揭晓」那几个字
      const cover = this.scene.add.rectangle(w.w - 74, 2, 72, 18, 0xfff3d6).setOrigin(0, 0);
      w.node.add([cover, st]);
      sound.cue({ type: 'judge', hit: j.hit });
      if (!anim.calm) {
        st.setScale(1.8);
        anim.fx({ targets: st, scale: 1, duration: 160, ease: 'Quad.easeIn' }, () => st.setScale(1));
      }
      await anim.wait(gap);
    }
  }

  /** 收盘后：推荐卡收起，群友吐槽冒出来。 */
  /**
   * 收盘后：群友吐槽，然后是「今日新闻」（F2，只解释今天已经发生的热度变化）。
   * 推荐卡收起；位置不够时把最早的几条消息收起来（写明收起了几条），保证吐槽和新闻完整显示。
   */
  async afterClose(anim: Animator, list: Comment[], news: NewsItem[], gap = 260, ticker: string[] = []): Promise<void> {
    for (const n of this.recNodes) n.destroy();
    this.recNodes = [];
    this.recSparks.clear();
    // 盘前的热闹元素夹在消息和推荐卡之间，收盘后让位给吐槽和新闻（最后有空再按今天的行情补几条）
    for (const f of this.fluffNodes) f.node.destroy();
    this.fluffNodes = [];
    this.buttons = [];
    this.shortButtons = [];
    // 先量高度：吐槽按文字量，新闻卡先画好（没有跟位置相关的提示，挪过去就行）
    const commentH = list.map((c) => {
      const t = addText(this.scene, 0, 0, bubbleLine(c.text, 13), { size: 13, wrap: BUBBLE_W - 20, lineSpacing: 2 });
      const h = 18 + t.height + 12;
      t.destroy();
      return h;
    });
    const paper = news.length > 0 ? this.newsFold(news, '今日新闻') : null;
    // 0.5：盘中播报（识别出的连续涨停、没封住、过山车异动），最多 2 条
    const tick = ticker.slice(0, 2).map((text) => this.tickerNode(text));
    const need = commentH.reduce((n, h) => n + h + GAP, 0) + (paper ? paper.h + GAP : 0) + tick.reduce((n, t) => n + t.h + GAP, 0);
    this.makeRoom(need);
    let y = this.msgs.length > 0 ? this.cursorAfterMessages() : this.cursor;
    const items: { node: Phaser.GameObjects.Container; h: number; cue: number }[] = [];
    for (const t of tick) {
      t.node.setY(y);
      items.push({ ...t, cue: 2 });
      y += t.h + GAP;
    }
    list.forEach((c, i) => {
      const n = this.commentNode(c, y);
      y += n.h + GAP;
      items.push({ ...n, cue: i + 3 });
    });
    this.newsRect = null;
    if (paper) {
      paper.node.setY(y);
      this.newsRect = { x: CX, y, w: CW, h: paper.h };
      items.push({ ...paper, cue: 6 });
      y += paper.h + GAP;
    }
    const base = items.length;
    const pops = new Map<Phaser.GameObjects.Container, Phaser.GameObjects.Image | null>();
    if (this.closeState) {
      const said = list.map((c) => ({ friendId: c.friendId, text: c.text }));
      const got = this.addFluff(this.closeState, y, BODY_Y + BODY_H - 6, 'close', said);
      for (const f of got.nodes) {
        f.node.setVisible(false);
        pops.set(f.node, f.pop);
        items.push({ node: f.node, h: 0, cue: -1 });
      }
      y = got.y;
    }
    // 总时长不变：多出来的热闹元素均摊原来的间隔
    const step = pops.size === 0 ? gap : base > 0 ? (gap * base) / items.length : 0;
    for (const { node, cue } of items) {
      node.setVisible(true);
      this.content.add(node);
      if (cue >= 0) sound.cue({ type: 'chat', index: cue });
      const pop = pops.get(node);
      if (pop && !anim.calm && !anim.instant) {
        const sx = pop.scaleX;
        const sy = pop.scaleY;
        pop.setScale(sx * 0.3, sy * 0.3);
        anim.fx({ targets: pop, scaleX: sx, scaleY: sy, duration: 320, ease: 'Back.easeOut' }, () => pop.setScale(sx, sy));
      }
      if (!anim.calm && !anim.instant) {
        const to = node.y;
        node.setAlpha(0).setY(to + 10);
        anim.fx({ targets: node, alpha: 1, y: to, duration: 200, ease: 'Back.easeOut' }, () => node.setAlpha(1).setY(to));
      }
      if (step > 0) await anim.wait(step);
    }
    this.cursor = y;
  }

  /** 盘中播报一行（红底白字的小条，不可点）。 */
  private tickerNode(text: string): { node: Phaser.GameObjects.Container; h: number } {
    const label = addText(this.scene, 0, 0, '播报', { size: 10, bold: true, color: COLOR.white, originY: 0.5 });
    const t = addText(this.scene, 0, 0, text, { size: 12, bold: true, color: COLOR.ink, wrap: CW - label.width - 30, lineSpacing: 2 });
    const h = Math.max(24, t.height + 8);
    const bg = this.scene.add.rectangle(0, 0, CW, h, 0xffe1d6).setOrigin(0, 0).setRounded(8).setStrokeStyle(1.5, COLOR.danger, 1);
    const pill = addPill(this.scene, 6, h / 2 - 8, label.width + 10, 16, COLOR.danger, false);
    label.setPosition(11, h / 2);
    t.setPosition(label.width + 22, 4);
    const node = this.scene.add.container(CX, 0, [bg, pill, label, t]).setVisible(false);
    return { node, h };
  }

  /** 群主的名字旁边带一个「群主」小签（文案里说"群主"，群里显示的是网名）。 */
  private ownerBadge(f: Pick<FriendView, 'title'>, x: number, y: number): { node: Phaser.GameObjects.Container; w: number } | null {
    if (f.title !== '群主') return null;
    const t = addText(this.scene, 0, 0, f.title, { size: 10, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
    const w = t.width + 8;
    const pill = addPill(this.scene, 0, 0, w, 15, COLOR.accentDark, false);
    t.setPosition(w / 2, 7.5);
    return { node: this.scene.add.container(x, y, [pill, t]), w };
  }

  /** 一条吐槽，画在 y 处。 */
  private commentNode(c: Comment, y: number): { node: Phaser.GameObjects.Container; h: number } {
    const node = this.scene.add.container(0, 0).setVisible(false);
    const face: AvatarFace = c.mood === 'smug' ? 'smug' : c.mood === 'awkward' ? 'awkward' : 'normal';
    const av = this.avatar(c.friendId, CX, y, face);
    const f = this.state.friends.some((x) => x.id === c.friendId) ? friendView(this.state, c.friendId) : null;
    const name = addText(this.scene, BUBBLE_X, y - 1, f ? f.name : '', { size: 12, bold: true });
    const badge = f ? this.ownerBadge(f, BUBBLE_X + name.width + 4, y) : null;
    const rec = addText(this.scene, BUBBLE_X + name.width + 6 + (badge ? badge.w + 2 : 0), y, f ? recShort(f.record) : '', { size: 11, bold: true, num: true, color: COLOR.muted });
    const text = addText(this.scene, BUBBLE_X + 12, y + 24, bubbleLine(c.text, 13), { size: 13, wrap: BUBBLE_W - 20, lineSpacing: 2 });
    const bh = text.height + 12;
    const bubble = addSlice(this.scene, BUBBLE_X, y + 18, BUBBLE_W, bh, 'bubble_left');
    const hit = this.scene.add.rectangle(BUBBLE_X, y + 18, BUBBLE_W, bh, 0xffffff, 0.001).setOrigin(0, 0).setInteractive();
    bindTooltip(hit, () => ({ x: BUBBLE_X, y: y + 18, w: BUBBLE_W, h: bh }), () => ({ title: f ? f.name : '群友', body: c.text }));
    node.add([av, name, rec, bubble, hit, text]);
    if (badge) node.add(badge.node);
    return { node, h: 18 + bh };
  }

  /**
   * 折叠的新闻条（画面重点：新闻收进群聊里，不跟小结卡、猫抢眼）：一行「今日新闻（3 条）· 点开看」，
   * 点一下在群聊里展开完整新闻卡（盖在消息上面），再点一下或点卡片收起。
   */
  private newsFold(list: NewsItem[], heading: string): { node: Phaser.GameObjects.Container; h: number } {
    const s = this.scene;
    const node = s.add.container(0, 0).setVisible(false);
    const h = 30;
    const card = addSlice(s, CX, 0, CW, h, 'bubble_card');
    const icon = hasArt(s.textures, NEWS_KEY) ? [addImage(s, CX + 20, h / 2, NEWS_KEY, 20)] : [];
    const title = addText(s, CX + (icon.length > 0 ? 36 : 12), h / 2, `${heading} ${Math.min(3, list.length)}`, { size: 12, bold: true, color: COLOR.white, originY: 0.5, stroke: COLOR.ink, strokeWidth: 3 });
    const more = addText(s, CX + CW - 12, h / 2, '展开 ▾', { size: 11, bold: true, color: COLOR.info, originX: 1, originY: 0.5 });
    const hit = s.add.rectangle(CX, 0, CW, h, 0xffffff, 0.001).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    hit.on(Phaser.Input.Events.POINTER_UP, (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.toggleNews();
    });
    node.add([card, ...icon, title, more, hit]);
    this.newsList = list;
    this.newsHeading = heading;
    this.newsMore = more;
    this.newsOpen?.destroy();
    this.newsOpen = null;
    this.newsShown = Math.min(3, list.length);
    return { node, h };
  }

  private newsList: NewsItem[] = [];
  private newsHeading = '';
  private newsMore: Phaser.GameObjects.Text | null = null;
  private newsOpen: Phaser.GameObjects.Container | null = null;

  /** 展开 / 收起新闻（自动化也用）；没有新闻时什么都不做。 */
  toggleNews(): void {
    if (this.newsOpen) {
      this.newsOpen.destroy();
      this.newsOpen = null;
      this.newsMore?.setText('展开 ▾');
      return;
    }
    const at = this.newsRect;
    if (!at || this.newsList.length === 0) return;
    const full = this.newsNode(this.newsList, this.newsHeading);
    // 优先在折叠条下面展开，放不下就往上
    const bottom = BODY_Y + BODY_H - 4;
    const y = at.y + full.h <= bottom ? at.y : Math.max(BODY_Y, bottom - full.h);
    full.node.setY(y).setVisible(true).setDepth(5);
    const hit = this.scene.add.rectangle(CX, 0, CW, full.h, 0xffffff, 0.001).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    hit.on(Phaser.Input.Events.POINTER_UP, (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.toggleNews();
    });
    full.node.add(addText(this.scene, CX + CW - 12, 13, '收起 ▴', { size: 11, bold: true, color: COLOR.white, originX: 1, originY: 0.5, stroke: COLOR.ink, strokeWidth: 3 }));
    full.node.add(hit);
    this.content.add(full.node);
    this.content.bringToTop(full.node);
    this.newsOpen = full.node;
    this.newsMore?.setText('收起 ▴');
    this.newsOpenRect = { x: CX, y, w: CW, h: full.h };
  }

  get newsExpanded(): boolean {
    return this.newsOpen !== null && this.newsOpen.active;
  }

  newsOpenRect: Rect | null = null;

  /** 折叠条的中心（自动化点击用）。 */
  newsCenter(): { x: number; y: number } | null {
    // 手机上群聊页没打开时点不到它
    const r = this.view === 'msgs' ? this.newsRect : null;
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
  }

  /** 「今日新闻」卡：报纸图标 + 每条一行标题，右边写这条对应的热度变化。 */
  private newsNode(list: NewsItem[], heading = '今日新闻'): { node: Phaser.GameObjects.Container; h: number } {
    const s = this.scene;
    const node = s.add.container(0, 0).setVisible(false);
    const parts: Phaser.GameObjects.GameObject[] = [];
    let y = 30;
    for (const n of list.slice(0, 3)) {
      const tag = n.theme ? `${themeById(n.theme).name}热度 ${n.value > 0 ? '+' : ''}${Math.round(n.value)}` : `大环境 ${formatPoints(n.value)}`;
      const tt = addText(s, CX + CW - 10, y, tag, { size: 11, bold: true, color: signColor(n.dir === 'up' ? 1 : -1), originX: 1 });
      const t = addText(s, CX + 12, y, n.text, { size: 12, color: COLOR.ink, wrap: CW - 24 - tt.width - 8, lineSpacing: 2 });
      parts.push(t, tt);
      y += t.height + 8;
    }
    const h = y + 2;
    const card = addSlice(s, CX, 0, CW, h, 'bubble_card');
    const icon = hasArt(s.textures, NEWS_KEY) ? [addImage(s, CX + 22, 15, NEWS_KEY, 22)] : [];
    const title = addText(s, CX + (icon.length > 0 ? 38 : 12), 13, heading, { size: 12, bold: true, color: COLOR.white, originY: 0.5, stroke: COLOR.ink, strokeWidth: 3 });
    node.add([card, ...icon, title, ...parts]);
    this.newsShown = list.length;
    return { node, h };
  }

  /** 最近一次收盘显示了几条新闻、新闻卡的位置（自动化检查用；重画群聊后清空）。 */
  newsShown = 0;
  newsRect: Rect | null = null;

  /** 位置不够放 need 高度时，收起最早的消息（其余往上挪），并在顶上写明收起了几条。 */
  private makeRoom(need: number): void {
    const bottom = BODY_Y + BODY_H - 6;
    let folded = 0;
    while (this.msgs.length > 1 && this.cursorAfterMessages() + need > bottom) {
      const first = this.msgs.shift()!;
      const next = this.msgs[0]!;
      const dy = next.top - first.top;
      first.root.destroy();
      folded += 1;
      for (const m of this.msgs) {
        m.root.setY(m.root.y - dy);
        m.top -= dy;
        m.bubble = { ...m.bubble, y: m.bubble.y - dy };
      }
    }
    if (folded > 0) {
      const at = this.msgs[0]?.top ?? this.cursor;
      const t = addText(this.scene, SX + SW / 2, at - 13, `（前面 ${folded} 条消息收起来了）`, { size: 10, color: COLOR.dim, originX: 0.5, originY: 0.5 });
      this.content.add(t);
    }
  }

  private cursorAfterMessages(): number {
    const last = this.msgs[this.msgs.length - 1];
    return last ? last.bubble.y + last.bubble.h + GAP + 4 : BODY_Y + 40;
  }

  /** 追加一条系统提示（新群友入群等）。 */
  note(text: string): void {
    this.cursor = this.addPill(text, this.cursor) + 4;
  }

  setLocked(locked: boolean): void {
    for (const b of [...this.buttons, ...this.shortButtons]) b?.setLocked(locked);
  }

  pressBuy(i: number): boolean {
    return this.buttons[i]?.press() ?? false;
  }

  controls(): Record<string, { x: number; y: number }> {
    const out: Record<string, { x: number; y: number }> = {};
    this.buttons.forEach((b, i) => {
      if (b && b.isEnabled()) out[`buy:${i}`] = b.center();
    });
    this.shortButtons.forEach((b, i) => {
      if (b && b.isEnabled() && b.active) out[`short:${i}`] = b.center();
    });
    return out;
  }

  recRect(i: number): Rect | null {
    return this.recRects[i] ?? null;
  }

  /** 当天消息所在的区域（教程用）；没有消息时为 null。 */
  /** 每条显示出来的消息气泡（自动化检查消息没被挤掉）：键为消息序号。 */
  messageRects(): Record<number, Rect> {
    const out: Record<number, Rect> = {};
    for (const m of this.msgs) out[m.index] = { ...m.bubble };
    return out;
  }

  messagesRect(): Rect | null {
    const first = this.msgs[0];
    const last = this.msgs[this.msgs.length - 1];
    if (!first || !last) return null;
    const top = first.bubble.y - 20;
    return { x: CX, y: top, w: CW, h: last.bubble.y + last.bubble.h - top };
  }

  /** 推荐卡所在的区域（教程用）。 */
  recsRect(): Rect | null {
    const rs = this.recRects.filter(Boolean);
    const first = rs[0];
    const last = rs[rs.length - 1];
    if (!first || !last) return null;
    return { x: first.x, y: first.y, w: first.w, h: last.y + last.h - first.y };
  }

  /** 此刻能点的按钮区域。 */
  buttonRects(): Rect[] {
    return [...this.buttons, ...this.shortButtons].filter((b): b is Button => !!b && b.active && b.isEnabled()).map((b) => b.rect());
  }

  rect(): Rect {
    return { ...PHONE };
  }
}
