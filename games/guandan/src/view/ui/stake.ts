/**
 * 实盘的两个弹层（docs/stake.md 2.1）：先选"娱乐 / 实盘"，实盘再选档位。
 * 按钮都用 body.setData('btn:<名字>', 按钮) 登记，标题页的 controls() 据此给冒烟坐标。
 */
import type Phaser from 'phaser';
import { SOLO_BOTS } from '../../ai/venue.ts';
import { SOLO_DEALS, TIERS, TIER_IDS, pointValue, type TierId } from '../../stake/index.ts';
import { DIFF_NAME, STAKE_TEXT, TIER_NAME, fmtChips, stakeError } from '../stake-text.ts';
import { buyinStake, fetchWallet, loadStake, refundStray, strayStake, type StakeSession, type WalletView } from '../stake.ts';
import { COLOR, TYPE } from '../theme.ts';
import { Button, modal, text, type Modal } from './kit.ts';

function reg(m: Modal, key: string, b: Button): Button {
  m.body.add(b);
  m.body.setData(`btn:${key}`, b);
  return b;
}

/** 娱乐 / 实盘。娱乐那边有存档时给"继续"和"开新局"；实盘那边点了去选档位 */
export function openModePicker(
  scene: Phaser.Scene,
  o: { saved: string | null; onContinue: () => void; onNew: () => void; onStake: () => void },
): Modal {
  const m = modal(scene, 760, 420);
  const card = (x: number, title: string, desc: string, color: number): void => {
    const g = scene.add.graphics();
    g.fillStyle(color, 0.12).fillRoundedRect(x - 165, -170, 330, 330, 16);
    g.lineStyle(2, color, 0.6).strokeRoundedRect(x - 165, -170, 330, 330, 16);
    m.body.add(g);
    m.body.add(text(scene, x, -128, title, { size: TYPE.big, bold: true, color }));
    m.body.add(text(scene, x, -66, desc, { size: TYPE.label, color: COLOR.ink, wrap: 290 }));
  };
  card(-180, '娱乐', '随便玩，不算筹码', COLOR.green);
  card(180, '实盘', `带一份筹码进场，打 ${SOLO_DEALS} 副结算；输赢最多一份`, COLOR.red);
  if (o.saved) {
    reg(m, 'continue', new Button(scene, -180, 30, 260, 60, '继续', 'red', () => (m.close(), o.onContinue()), 'play'));
    m.body.add(text(scene, -180, 74, o.saved, { size: TYPE.small, color: COLOR.muted }));
    reg(m, 'fun', new Button(scene, -180, 122, 260, 56, '开新局', 'wood', () => (m.close(), o.onNew()), 'restart'));
  } else {
    reg(m, 'fun', new Button(scene, -180, 70, 260, 64, '开始', 'red', () => (m.close(), o.onNew()), 'play'));
  }
  reg(m, 'stake', new Button(scene, 180, 70, 260, 64, '选档位', 'gold', () => (m.close(), o.onStake()), 'cards'));
  return m;
}

/** 选档位：每档一份多少、每分多少、电脑多强；钱包不够的灰掉，钱包连不上整个灰掉。进场成功交给 onStarted */
export function openTierPicker(scene: Phaser.Scene, onStarted: (ses: StakeSession) => void): Modal {
  const m = modal(scene, 940, 600);
  const b = m.body;
  b.add(text(scene, 0, -250, '选档位', { size: TYPE.title, bold: true, color: COLOR.redDark }));
  const balance = text(scene, 0, -208, '正在看钱包…', { size: TYPE.body, bold: true, color: COLOR.ink });
  b.add(balance);
  const buttons: Partial<Record<TierId, Button>> = {};
  TIER_IDS.forEach((tier, i) => {
    const y = -140 + i * 78;
    const g = scene.add.graphics();
    g.fillStyle(i % 2 ? 0xf3e4c4 : 0xf8ecd2, 1).fillRoundedRect(-430, y - 33, 860, 66, 12);
    b.add(g);
    b.add(text(scene, -400, y, TIER_NAME[tier], { size: TYPE.title, bold: true, color: COLOR.redDark, ox: 0 }));
    b.add(text(scene, -270, y, `一份 ${fmtChips(TIERS[tier])} · 每分 ${fmtChips(pointValue(tier))}`, { size: TYPE.label, color: COLOR.ink, ox: 0 }));
    const bots = SOLO_BOTS[tier];
    b.add(text(scene, 40, y, `搭档${DIFF_NAME[bots.mate]} · 对手${DIFF_NAME[bots.opp]}`, { size: TYPE.label, color: COLOR.muted, ox: 0 }));
    const btn = reg(m, `tier:${tier}`, new Button(scene, 340, y, 150, 52, '进场', 'red', () => void enter(tier)));
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
