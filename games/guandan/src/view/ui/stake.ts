/**
 * 开局的几个弹层（docs/stake.md 2.1）：先选"娱乐 / 实盘"，娱乐再选难度、实盘再选档位。
 * 每档一张卡，写三件事（仓库 docs/balance.md 第 5 节，四个游戏一致）：电脑多强（1–4 颗星）、一场约多久、一场最多赢 / 最多输。
 * 按钮都用 body.setData('btn:<名字>', 按钮) 登记，标题页的 controls() 据此给冒烟坐标。
 */
import type Phaser from 'phaser';
import { SOLO_LEVELS, type SoloLevel } from '../../ai/venue.ts';
import { ROOM_DEALS, SOLO_DEALS, TIERS, TIER_IDS, pointValue, type TierId } from '../../stake/index.ts';
import { LENGTH_CARD, LEVEL_CARD, STAKE_TEXT, TIER_CARD, TIER_NAME, fmtChips, stakeError, stars } from '../stake-text.ts';
import { buyinStake, fetchWallet, loadStake, refundStray, strayStake, type StakeSession, type WalletView } from '../stake.ts';
import { COLOR, TYPE, minHit, phoneType } from '../theme.ts';
import { Button, fitWidth, modal, segmented, text, type Modal } from './kit.ts';
import type { GameLength } from '../store.ts';

function reg(m: Modal, key: string, b: Button): Button {
  m.body.add(b);
  m.body.setData(`btn:${key}`, b);
  return b;
}

/**
 * 娱乐选难度：上面一排选局长（短局打到 10 / 完整打过 A，0.25.0），下面新手 / 普通 / 高手每档一行（电脑多强、一局多久、适合谁）；
 * 当前设置的那档描金边，时间那行跟着局长换。给了 onMatch 右下角还有"快速匹配"（0.26.0：和真人打，娱乐好友房的规则，打过 A）
 */
export function openLevelPicker(
  scene: Phaser.Scene,
  current: SoloLevel,
  length: GameLength,
  onPick: (level: SoloLevel, length: GameLength) => void,
  onMatch?: () => void,
): Modal {
  const m = modal(scene, 900, 500);
  const b = m.body;
  const phone = phoneType();
  let len = length;
  b.add(text(scene, 0, -205, '选难度', { size: TYPE.title, bold: true, color: COLOR.redDark }));
  const lens: GameLength[] = ['short', 'full'];
  const times: Phaser.GameObjects.Text[] = [];
  // 手机上字托底到 12 像素，整句会压到右边"适合谁"那段：只留"一局约 N 分钟"
  const timeOf = (lv: SoloLevel): string => {
    const t = len === 'short' ? LEVEL_CARD[lv].short : LEVEL_CARD[lv].time;
    return phone ? t.split('，')[0]! : t;
  };
  const seg = segmented(
    scene,
    -165,
    -150,
    lens.map((l) => ({ label: `${LENGTH_CARD[l].name} · ${LENGTH_CARD[l].goal}`, value: l })),
    len,
    (v) => {
      len = v as GameLength;
      SOLO_LEVELS.forEach((lv, i) => times[i]!.setText(timeOf(lv)));
    },
    330,
    // 手机上 60 只合 27–36 CSS 像素：拉到 minHit()，最多 88（下沿 -106，不压到第一行"开始"的点按区）
    Math.max(60, Math.min(88, minHit())),
  );
  b.add(seg);
  m.body.setData('seg:length', seg);
  SOLO_LEVELS.forEach((lv, i) => {
    const y = -60 + i * 92;
    const c = LEVEL_CARD[lv];
    const g = scene.add.graphics();
    g.fillStyle(i % 2 ? 0xf3e4c4 : 0xf8ecd2, 1).fillRoundedRect(-420, y - 40, 840, 80, 12);
    if (lv === current) g.lineStyle(3, COLOR.gold, 1).strokeRoundedRect(-420, y - 40, 840, 80, 12);
    b.add(g);
    b.add(text(scene, -390, y, c.name, { size: TYPE.title, bold: true, color: COLOR.redDark, ox: 0 }));
    b.add(text(scene, -250, y - 15, `电脑 ${stars(c.stars)}`, { size: TYPE.label, bold: true, color: COLOR.goldDark, ox: 0 }));
    const t = text(scene, -250, y + 17, timeOf(lv), { size: TYPE.small, color: COLOR.muted, ox: 0 });
    times.push(t);
    b.add(t);
    b.add(text(scene, -30, y, c.who, { size: TYPE.label, color: COLOR.ink, ox: 0, wrap: 250, align: 'left' }));
    // 三行间距 92：点按区高最多 90，上下两行不互相压着
    reg(m, `level:${lv}`, new Button(scene, 330, y, 130, 52, '开始', 'red', () => (m.close(), onPick(lv, len)), 'play')).setHit(Math.max(130, minHit()), Math.min(90, minHit()));
  });
  b.add(text(scene, onMatch ? -120 : 0, 210, '随时能在设置里换难度；局长下次开局还是这个', { size: TYPE.small, color: COLOR.muted }));
  if (onMatch) reg(m, 'match', new Button(scene, 300, 210, 220, 52, '快速匹配', 'blue', () => (m.close(), onMatch()), 'invite'));
  return m;
}

/**
 * 选档位：每档一份多少、电脑多强、一场多久、最多赢 / 最多输；钱包不够的灰掉，钱包连不上整个灰掉。进场成功交给 onStarted。
 * 给了 onMatch 右上角多一个"和电脑 / 快速匹配"（0.26.0）：切到匹配时每档的按钮变"匹配"、时间那行换成好友房实盘的副数，点了交给 onMatch（带入由房间开打时办）
 */
export function openTierPicker(scene: Phaser.Scene, onStarted: (ses: StakeSession) => void, onMatch?: (tier: TierId) => void): Modal {
  const m = modal(scene, 940, 600);
  const b = m.body;
  b.add(text(scene, 0, -250, '选档位', { size: TYPE.title, bold: true, color: COLOR.redDark }));
  // 有匹配时钱包靠左、右边放切换
  const balance = text(scene, onMatch ? -400 : 0, -208, '正在看钱包…', { size: TYPE.body, bold: true, color: COLOR.ink, ...(onMatch ? { ox: 0 } : {}) });
  b.add(balance);
  let matching = false;
  const times: Phaser.GameObjects.Text[] = [];
  const timeOf = (): string => (matching ? `${ROOM_DEALS} 副 · ${STAKE_TEXT.matchWho}` : `${SOLO_DEALS} 副 · ${TIER_CARD.time}`);
  if (onMatch) {
    const seg = segmented(
      scene,
      205,
      -208,
      [{ label: '和电脑', value: 'solo' }, { label: '快速匹配', value: 'match' }],
      'solo',
      (v) => {
        matching = v === 'match';
        for (const t of TIER_IDS) buttons[t]!.label.setText(matching ? '匹配' : '进场');
        times.forEach((t) => fitWidth(t.setText(timeOf()), 195));
      },
      150,
    );
    b.add(seg);
    m.body.setData('seg:mode', seg);
  }
  const buttons: Partial<Record<TierId, Button>> = {};
  TIER_IDS.forEach((tier, i) => {
    const y = -140 + i * 78;
    const g = scene.add.graphics();
    g.fillStyle(i % 2 ? 0xf3e4c4 : 0xf8ecd2, 1).fillRoundedRect(-430, y - 35, 860, 70, 12);
    b.add(g);
    b.add(text(scene, -400, y, TIER_NAME[tier], { size: TYPE.title, bold: true, color: COLOR.redDark, ox: 0 }));
    // 实盘一场最多输一份、最多赢一份（结回 0 到两份，docs/stake.md 1.1）
    const share = fmtChips(TIERS[tier]);
    // 实盘的钱数不截断（主线 10-18：截成"最多输 20…"正好把能输多少藏掉了）。赢输都是一份，第二行合成"最多输赢"，
    // 手机托底到 12 像素时豪华档"一份 200,000 · 每分 10,000"也在 -270 到 60 之间放得下（SE 截图核对过；右边一列从 40 挪到 60 留了余量）
    b.add(text(scene, -270, y - 14, `一份 ${share} · 每分 ${fmtChips(pointValue(tier))}`, { size: TYPE.label, color: COLOR.ink, ox: 0 }));
    b.add(text(scene, -270, y + 16, `最多输赢 ${share}`, { size: TYPE.small, color: COLOR.muted, ox: 0 }));
    b.add(text(scene, 60, y - 14, `电脑 ${stars(TIER_CARD[tier].stars)}`, { size: TYPE.label, bold: true, color: COLOR.goldDark, ox: 0 }));
    // 时间那行可以截（手机上放不下时）
    const time = fitWidth(text(scene, 60, y + 16, timeOf(), { size: TYPE.small, color: COLOR.muted, ox: 0 }), 195);
    times.push(time);
    b.add(time);
    const btn = reg(m, `tier:${tier}`, new Button(scene, 340, y, 150, 52, '进场', 'red', () => (matching && onMatch ? (m.close(), onMatch(tier)) : void enter(tier))));
    btn.setEnabled(false);
    buttons[tier] = btn;
  });
  const note = text(scene, 0, 186, '', { size: TYPE.label, bold: true, color: COLOR.redDark, wrap: 820 });
  b.add(note);
  b.add(text(scene, 0, 262, STAKE_TEXT.noCash, { size: TYPE.small, color: COLOR.muted }));
  let stray: Button | null = null;
  let busy = false;

  const show = (w: WalletView | null, msg = ''): void => {
    stray?.destroy();
    stray = null;
    if (!w) {
      balance.setText('钱包：连不上');
      note.setText(msg || STAKE_TEXT.walletDown);
      for (const t of TIER_IDS) buttons[t]!.setEnabled(false);
      return;
    }
    balance.setText(`钱包 ${fmtChips(w.balance)}`);
    // 别的设备上开的单机那一份不挡开新的（平台 0.9.5 起能同时有好几份），给个原样退回的办法；好友房的不归这里管
    const other = strayStake(w, loadStake());
    for (const t of TIER_IDS) buttons[t]!.setEnabled(!busy && w.balance >= TIERS[t]);
    if (other?.solo) {
      note.setText(msg || STAKE_TEXT.elsewhere);
      stray = reg(m, 'stray', new Button(scene, 0, 232, 300, 50, '原样退回那一份', 'wood', () => void giveBack(other.ref)));
    } else if (msg) note.setText(msg);
    else note.setText(w.balance < TIERS.mid ? STAKE_TEXT.lowFunds : '');
  };

  const enter = async (tier: TierId): Promise<void> => {
    if (busy) return;
    busy = true;
    for (const t of TIER_IDS) buttons[t]!.setEnabled(false);
    note.setText('正在进场…');
    const r = await buyinStake(tier);
    busy = false;
    if (!m.root.scene) return;
    if (r.ok) {
      m.close();
      onStarted(r.ses);
      return;
    }
    show(r.wallet ?? (await fetchWallet()), stakeError(r.error));
  };

  const giveBack = async (ref: string): Promise<void> => {
    if (busy) return;
    busy = true;
    stray?.setEnabled(false);
    note.setText('正在退回…');
    const r = await refundStray(ref);
    busy = false;
    if (!m.root.scene) return;
    const msg = r.ok ? '那一份已经原样退回钱包' : r.error === 'no_stake' || r.error === 'expired' ? '那一份已经退回过了' : stakeError(r.error);
    show(r.wallet ?? (await fetchWallet()), msg);
  };

  void fetchWallet().then((w) => {
    if (m.root.scene) show(w);
  });
  return m;
}
