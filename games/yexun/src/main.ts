/**
 * 入口：开始菜单 → 守夜一局 → 结算（再来一局 / 换难度 / 大厅）。第一次打开只有一个大按钮，第一局带最多 3 条引导。
 * 画布按 CSS 尺寸 × 渲染倍数开，再用 CSS 缩回去：手机上不糊，省内存设备倍数封顶 2（viewport.ts）。
 * 调试参数：?seed=123 固定种子，?diff=easy|normal|hard，?play 跳过菜单直接开局，?auto 让机器人代打、?warp=9000 先快进到第 9000 拍、&choose 停在选卡、?give=mirror:8,gourd:8 开局换法器（这几个只在开发服务器里有，冒烟截图用），?sheet 看图集。
 */
import Phaser from 'phaser';
import { DANGERS, DAWN_TICK, type Danger } from './content/waves.ts';
import { CHARACTER_IDS, CURSE_IDS, MAX_CURSES, type CharacterId } from './content/meta.ts';
import { ELEMENT_SET, PASSIVE_IDS, PASSIVES, TYPE_SETS, WEAPONS, type WeaponId } from './content/weapons.ts';
import { createWorld, grantWeapon, openChestNow, step, type OwnedWeapon, type Setup, type World } from './core/index.ts';
import { buyChar, buyPerk, CHAR_PRICE, charOpen, coins, dangerOpen, finishRun, grantCoins, loadSave, refundPerks, saveHooks, settings, writeSave, yizhuangOpen } from './platform/save.ts';
import { hasLoginHint, startCloud } from './platform/cloud.ts';
import { createLive, liveSetup, type LiveRecord, type Outcome } from './platform/live.ts';
import { LIVE_OPEN, LIVE_TIERS, type LiveTier } from './content/live.ts';
import { applyRun, loadRecords, RunTally, saveRecords, summarize } from './meta/records.ts';
import { rewardCoins } from './content/achievements.ts';
import { AchievementToast, Codex } from './view/ui/codex.ts';
import { Recorder } from './replay/recorder.ts';
import { loadReplays, storeReplay } from './replay/store.ts';
import { ReplayPlayer } from './replay/player.ts';
import { ReplayList } from './replay/view/list.ts';
import { ReplayBar } from './replay/view/bar.ts';
import type { ReplayRecord } from './replay/format.ts';
import { BoardsPanel } from './online/view/boards.ts';
import { buildShareCard } from './online/share.ts';
import { createSocial } from './online/social.ts';
import { prepareShare } from 'arcade-kit/share';
import { mountSocial } from 'arcade-kit/social';
import { createSubmitter, outcomeText } from './online/submit.ts';
import { scoresOfRun } from './online/score.ts';
import { beijingDate, dailyPlan } from './online/daily.ts';
import type { RunSummary } from './online/types.ts';
import { Prep, type PrepState } from './view/ui/prep.ts';
import type { MapId } from './content/maps.ts';
import { buildAtlas, buildGround, buildRaidAtlas, type Atlas } from './view/art/atlas.ts';
import { treasureIconKey } from './view/art/sprites8.ts';
import { Vault } from './view/ui/vault.ts';
import { settleRaid } from './explore/settle.ts';
import { recordRaid, vaultProgress } from './explore/vault.ts';
import { TREASURES } from './content/treasures.ts';
import { RAID_TEMPLATES, type RaidTemplateId } from './content/explore.ts';
import { music } from './view/audio/music.ts';
import { sfx } from './view/audio/sfx.ts';
import { GameScene } from './view/game/GameScene.ts';
import { weaponLook } from './view/game/look.ts';
import { Input } from './view/game/input.ts';
import { Banners } from './view/ui/banner.ts';
import { Cards } from './view/ui/cards.ts';
import { Hud } from './view/ui/hud.ts';
import { type BuildRow, Confirm, Menu, Pause, Result, Tips, type Toggle } from './view/ui/screens.ts';
import { LOW_MEMORY, TOUCH, fitViewport, renderScale, worldZoom } from './view/viewport.ts';

const q = new URLSearchParams(location.search);

/** 图集里一帧画成 data URL（HUD 的头像、法器图标用）；同一张只画一次 */
function iconMaker(atlas: Atlas): (key: string, px?: number) => string {
  const cache = new Map<string, string>();
  return (key, px = 64) => {
    const id = `${key}@${px}`;
    let url = cache.get(id);
    if (url) return url;
    const f = atlas.frames.get(key) ?? atlas.frames.get('soul')!;
    const c = document.createElement('canvas');
    c.width = px;
    c.height = Math.round((px * f.h) / f.w);
    c.getContext('2d')!.drawImage(atlas.canvas, f.x, f.y, f.w, f.h, 0, 0, c.width, c.height);
    url = c.toDataURL();
    cache.set(id, url);
    return url;
  };
}

async function boot(): Promise<void> {
  const stage = document.getElementById('stage')!;
  const app = document.getElementById('app')!;
  const r = renderScale();
  const css = (): { w: number; h: number } => ({ w: app.clientWidth || window.innerWidth, h: app.clientHeight || window.innerHeight });
  const size = css();
  const zoom = worldZoom(size.w, size.h);
  // 图集的清晰度跟着屏幕：每世界单位的像素数 = 世界缩放 × 渲染倍数，取整到 2 或 3
  const res = Math.max(2, Math.min(3, Math.ceil(zoom * r)));
  // 毛笔字体先载好再出横幅（font-display: block 也挡不住第一帧用后备字体量尺寸）
  await document.fonts?.load('40px YxBrush').catch(() => undefined);
  const atlas = buildAtlas(res);
  const ground = buildGround(512);
  if (q.has('sheet')) {
    atlas.canvas.style.cssText = 'position:absolute;left:0;top:0;background:#9aa3b5';
    document.body.style.overflow = 'auto';
    document.body.appendChild(atlas.canvas);
    return;
  }
  const icon = iconMaker(atlas);

  // 层次（下 → 上）：画布、暗角、摇杆层、HUD、横幅、卡片、结算、暂停、菜单、确认框
  const vignette = document.createElement('div');
  vignette.className = 'yx-vignette';
  stage.appendChild(vignette);
  const stickLayer = document.createElement('div');
  stickLayer.className = 'yx-touch';
  stage.appendChild(stickLayer);
  const input = new Input(stickLayer);
  const hud = new Hud(stage, (k) => icon(k), icon('face', 120));
  const banners = new Banners(stage);
  const cards = new Cards(stage, (k) => icon(k));

  // 声音要在用户手势里解锁（iOS）
  const unlock = (): void => sfx.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  const save = loadSave();
  // 云存档（DESIGN.md 5.5）：没登录、单独部署时它自己不调接口；云端的进度并进本机后，内存里这份按新存档重读，菜单开着就重画
  const cloud = startCloud({
    onApplied: () => {
      Object.assign(save, loadSave());
      if (menu.root.style.display !== 'none') menu.show(menuState());
    },
  });
  saveHooks.onWrite = () => cloud.touch('profile');
  // 实盘（DESIGN.md 第 4 节）：进行中那一份记在 yexun.live；上次没结完的（中途关页面）开页时按输结回
  const live = createLive();
  void live.resume();
  addEventListener('online', () => void live.resume());
  /** 这一局是实盘时记下种子（每 10 秒报一次撑到哪，结束时结回） */
  let liveRun: { seed: number } | null = null;
  // 录像（本机，DESIGN.md 5.4）和交分（5.7）：每局一个录像机；每日挑战那天的日期跟着这一局走
  let rec: Recorder | null = null;
  let dailyDate: string | null = null;
  /** 菜单上开了"无尽"（再来一局沿用上一局的） */
  let wantEndless = false;
  const submitter = createSubmitter({ fetch: (u, i) => fetch(u, i) });
  // 好友在线和邀请横条（kit 的 arcade-kit/social）：没平台、没登录就不挂。打到一半点"去"先确认
  const social = createSocial({
    mount: mountSocial,
    confirmLeave: (go) => confirm.ask('这一局不会保存，确定离开吗？', '离开', '接着打', (ok) => ok && go()),
  });
  /** 撑到了天亮：无尽局过了天亮再倒下也算（解锁、战绩按这个） */
  const dawned = (w: World): boolean => w.won || (!!w.setup.endless && w.tick >= DAWN_TICK);
  /** 一局的小结：交分、录像、分享卡都从它来 */
  const runSummary = (w: World, quit: boolean): RunSummary => ({
    runId: `${w.setup.seed.toString(36)}-${rec?.at.toString(36) ?? '0'}`,
    setup: w.setup,
    won: w.raid ? w.raid.outcome === 'escaped' : dawned(w),
    quit,
    bossKilled: w.bossKilled,
    seconds: Math.floor((w.setup.endless ? w.tick : Math.min(w.tick, DAWN_TICK)) / 30),
    kills: w.kills,
    level: w.level,
    coins: w.coins,
    // 夜探：撤出带出的宝物价值（夜探榜按它排）；没撤出是 0
    loot: w.raid && w.raid.outcome === 'escaped' ? settleRaid(w.raid, w.coins).value : 0,
    live: liveRun !== null,
    reducedDamage: !!w.setup.assist,
    daily: dailyDate,
    build: w.weapons.map((o) => WEAPONS[o.id].name),
  });
  /** 结束时：存录像、交分（实盘、降低伤害、认输的不交总榜，规则在 online/score.ts） */
  const archive = (w: World, quit: boolean): RunSummary => {
    const run = runSummary(w, quit);
    if (rec) {
      const today = beijingDate(Date.now());
      storeReplay(rec.finish(w, { won: run.won, quit, seconds: run.seconds, kills: run.kills, level: run.level, bossKilled: run.bossKilled, loot: run.loot, daily: run.daily }, scoresOfRun(run, today)));
      rec = null;
    }
    void submitter.submit(run).then((outs) => {
      if (outs.length) result.setNote(outs.map(outcomeText).join('；'));
    });
    return run;
  };
  /**
   * 分享卡（kit 的 arcade-kit/share）：结算页一出来就先画好，点"分享"时在点击里直接调系统分享（iOS 只认点击那一下）。
   * 实盘局不给分享（onShare 置空）。卡上只有战绩和咒印，不放自由文字
   */
  const offerShare = (run: RunSummary | null): void => {
    if (!run) {
      result.onShare = null;
      return;
    }
    const prepared = prepareShare(buildShareCard(run), { url: './', zIndex: 11000 });
    result.onShare = () => void prepared.share();
  };
  /** 上一局是不是实盘、哪一档（"再来一局"照样来） */
  let lastLive: LiveTier | null = null;
  let liveTier: LiveTier = 'small';
  /** 结回以后的那一份记录 → 结算页那一行 */
  const recordText = (rec: Readonly<LiveRecord> | null): string => {
    if (!rec) return '结回完成';
    if (rec.step === 'done') return liveText({ kind: 'ok', credited: rec.credited ?? 0, capped: rec.capped ?? 0 });
    if (rec.wait) return liveText({ kind: 'retry', why: rec.wait });
    return liveText({ kind: 'bug', error: rec.error ?? rec.step });
  };
  const liveText = (o: Outcome): string =>
    o.kind === 'ok'
      ? `结回 ${o.credited.toLocaleString('zh-CN')} 筹码${o.capped > 0 ? `（今天的上限扣下 ${o.capped.toLocaleString('zh-CN')}）` : ''}`
      : o.kind === 'retry'
        ? o.why === 'login'
          ? '登录以后自动结回'
          : '连不上平台，联网以后自动结回'
        : o.kind === 'unavailable'
          ? '这里没有钱包，实盘不可用'
          : `结回出了问题（${o.kind === 'reject' ? o.error : o.error}），筹码不会丢，过一会儿再打开看看`;
  const toggles: Toggle[] = [
    { key: 'sfx', label: '音效', get: () => sfx.enabled, set: (on) => sfx.setEnabled(on) },
    { key: 'music', label: '音乐', get: () => music.enabled, set: (on) => music.setEnabled(on) },
    { key: 'shake', label: '震屏', get: () => settings.shake, set: (on) => (settings.shake = on) },
  ];
  // 连死以后开的"降低伤害"（13.2）：设置里随时能关，开着时成绩不进总榜
  toggles.push({ key: 'assist', label: '降低伤害', get: () => save.assist, set: (on) => { save.assist = on; writeSave(save); } });
  if (TOUCH) toggles.push({ key: 'stick', label: '固定摇杆', get: () => settings.fixedStick, set: (on) => { settings.fixedStick = on; input.setFixed(on); } });
  input.setFixed(TOUCH && settings.fixedStick);
  const menu = new Menu(stage, toggles);
  const pause = new Pause(stage, toggles, (k) => icon(k));
  const result = new Result(stage, (k) => icon(k));
  const confirm = new Confirm(stage);
  const tips = new Tips(stage);
  const prep = new Prep(stage, (k) => icon(k));
  // 成就和图鉴（5c）：累计统计存 yexun.records；每局按事件计数，结算时一起算解锁
  let records = loadRecords();
  let tally = new RunTally();
  const codex = new Codex(stage, (k) => icon(k), () => records);
  const toast = new AchievementToast(stage);
  codex.onClose = () => {
    codex.hide();
    menu.show(menuState());
  };
  /** 流水 id 的随机后缀：两台设备同时买同一样东西也不会撞成一条（画面层，不进规则核心） */
  const nonce = (): string => Math.random().toString(36).slice(2, 10);
  const prepState = (): PrepState => ({
    coins: coins(save),
    character: save.character,
    chars: Object.fromEntries(CHARACTER_IDS.map((c) => [c, { open: charOpen(save, c), price: CHAR_PRICE[c] }])) as PrepState['chars'],
    curses: save.curses,
    cursesOpen: save.cleared >= 0,
    perks: save.perks,
  });
  const menuState = (firstTime = false) => ({
    firstTime,
    raidFirst: !save.raidDone,
    vault: { got: vaultProgress(save.vault).got, total: TREASURES.length },
    danger: save.danger,
    dangerOpen: dangerOpen(save),
    best: save.bestD,
    map: save.map,
    yizhuang: yizhuangOpen(save),
    coins: coins(save),
    character: charOpen(save, save.character) ? save.character : ('xiaodao' as CharacterId),
    curses: save.cleared >= 0 ? save.curses : [],
    cursesOpen: save.cleared >= 0,
    // 有平台登录、收到过 501（单独部署）就藏起来
    live: { available: LIVE_OPEN && hasLoginHint() && !live.unavailable, on: save.liveOn, tier: save.liveTier },
  });
  const refreshPrep = (): void => {
    writeSave(save);
    prep.update(prepState());
  };
  prep.onPickChar = (c) => {
    save.character = c;
    refreshPrep();
  };
  prep.onBuyChar = (c) => {
    if (buyChar(save, c, nonce())) sfx.play('click');
    refreshPrep();
  };
  prep.onToggleCurse = (c) => {
    save.curses = save.curses.includes(c) ? save.curses.filter((x) => x !== c) : CURSE_IDS.filter((x) => x === c || save.curses.includes(x)).slice(0, MAX_CURSES);
    refreshPrep();
  };
  prep.onBuyPerk = (id) => {
    if (buyPerk(save, id, nonce())) sfx.play('click');
    refreshPrep();
  };
  prep.onRefund = () => {
    refundPerks(save, nonce());
    refreshPrep();
  };
  prep.onClose = () => {
    prep.hide();
    menu.show(menuState());
  };
  menu.onPrep = (tab) => prep.show(tab, prepState());
  menu.onCodex = () => {
    menu.hide();
    codex.show();
  };
  menu.onClick = () => sfx.play('click');

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: app,
    width: size.w * r,
    height: size.h * r,
    backgroundColor: '#e4e8f0',
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / r },
    render: { antialias: true, pixelArt: false, powerPreference: 'high-performance' },
    banner: false,
    audio: { noAudio: true },
    fps: { smoothStep: false },
  });

  let scene: GameScene | null = null;
  let world: World | null = null;
  let autopilot: ((w: World) => { dir: number; choice: number }) | undefined;
  let ended = false;
  /** 对局界面（HUD、摇杆）只在打的时候显示 */
  const showPlay = (on: boolean): void => {
    hud.root.style.display = on ? '' : 'none';
    stickLayer.style.display = on ? '' : 'none';
    vignette.style.display = on ? '' : 'none';
  };
  showPlay(false);

  const tipDone = (id: string): boolean => save.tipsOff || save.tips.includes(id);
  const markTip = (id: string): void => {
    if (!save.tips.includes(id)) save.tips.push(id);
    writeSave(save);
  };
  tips.onOff = () => {
    save.tipsOff = true;
    writeSave(save);
  };

  const buildRows = (w: World): BuildRow[] => [
    ...w.weapons.map((o) => ({ ...weaponLook(w, o), level: o.evolved ? 9 : o.level, dmg: o.dmg, kills: o.kills, hint: evolveHint(w, o) })),
    ...PASSIVE_IDS.filter((id) => w.passives[id] !== undefined).map((id) => ({ icon: PASSIVES[id].icon, name: PASSIVES[id].name, level: w.passives[id]!, dmg: -1, kills: 0 })),
  ];

  const setPaused = (on: boolean): void => {
    scene?.setPaused(on);
    input.enabled = !on;
    // 暂停时整个声音停下（音乐也停），继续时接着放
    const ctx = sfx.ctx;
    if (ctx) void (on ? ctx.suspend() : ctx.resume()).catch(() => undefined);
  };
  const openPause = (): void => {
    if (!world || ended || pause.open || confirm.open) return;
    setPaused(true);
    tips.hide();
    pause.show(buildRows(world), Math.max(0, (DAWN_TICK - world.tick) / 30), setLines(world));
  };
  pause.onResume = () => {
    pause.hide();
    setPaused(false);
  };
  const askHome = (): void => {
    if (!pause.open) setPaused(true);
    confirm.ask('这一局不会保存，确定回大厅吗？', '回大厅', '接着打', (ok) => {
      if (ok) location.href = '/';
      else if (!pause.open) setPaused(false);
    });
  };
  pause.onHome = askHome;
  pause.onQuit = () =>
    confirm.ask('认输就算这一局结束，确定吗？', '认输', '接着打', (ok) => {
      if (ok && world) {
        pause.hide();
        finish(world, true);
      }
    });
  hud.pauseBtn.addEventListener('click', openPause);
  hud.homeBtn.addEventListener('click', askHome);
  // 切到后台自动暂停（手机来电、切应用）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !autopilot) openPause();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p') {
      if (confirm.open) confirm.close(false);
      else if (pause.open) pause.onResume();
      else openPause();
    } else if (banners.skipReveal()) e.preventDefault();
  });
  stage.addEventListener('pointerdown', () => banners.skipReveal());

  /** 夜探结算：撤出全带走、换铜钱；倒下 / 迷失丢包，铜钱剩一半（教学镇不丢）；宝物记进藏宝阁 */
  const finishRaid = (w: World, quit: boolean, seconds: number): void => {
    const raid = w.raid!;
    const st = settleRaid(raid, w.coins);
    const rr = recordRaid(save.vault, st);
    save.vault = rr.vault;
    if (raid.teach) save.raidDone = true;
    if (st.coins > 0) grantCoins(save, `raid:${w.setup.seed.toString(36)}-${nonce()}`, st.coins);
    writeSave(save);
    showPlay(false);
    const view = (code: number) => {
      const t = TREASURES[code]!;
      return { icon: treasureIconKey(t.icon), name: t.name, tier: t.tier, value: t.value, fresh: rr.fresh.includes(t.id) };
    };
    const tpl = raid.setup.template as RaidTemplateId;
    result.show({
      won: st.outcome === 'escaped',
      quit,
      bossKilled: false,
      seconds,
      kills: w.kills,
      level: w.level,
      coins: st.coins,
      coinsTotal: coins(save),
      label: `夜探 · ${RAID_TEMPLATES[tpl].name}${raid.teach ? '' : ` · ${DANGERS[w.setup.danger].name}`}`,
      record: false,
      build: buildRows(w),
      raid: { outcome: st.outcome === 'escaped' || st.outcome === 'lost' ? st.outcome : 'dead', teach: raid.teach, kept: st.kept.map(view), lost: st.lost.map(view), value: st.value },
    });
  };
  const finish = (w: World, quit: boolean): void => {
    if (ended) return;
    ended = true;
    setPaused(true);
    music.stop();
    tips.hide();
    banners.clear();
    const seconds = (w.setup.endless ? w.tick : Math.min(w.tick, DAWN_TICK)) / 30;
    const run = archive(w, quit);
    social.setWhere('menu');
    offerShare(liveRun ? null : run);
    if (liveRun) {
      // 实盘：不发铜钱、不记纪录（固定配置，和娱乐分开），按撑到的时间结回；认输按当时撑到的算
      const seed = liveRun.seed;
      liveRun = null;
      showPlay(false);
      result.show({ won: w.won, quit, bossKilled: w.bossKilled, seconds, kills: w.kills, level: w.level, coins: 0, label: `实盘 · ${LIVE_TIERS[liveTier].name}档`, live: '正在结回…', record: false, build: buildRows(w) });
      void live.finish(seed, { ticks: w.won ? DAWN_TICK : w.tick, won: w.won, bossKilled: w.bossKilled }).then(() => {
        const rec = live.record;
        result.setLive(recordText(rec));
        if (rec?.step === 'done') {
          live.markTold();
          live.clearFinished();
        }
      });
      return;
    }
    if (w.raid) return finishRaid(w, quit, seconds);
    // 认输的局算一局、铜钱照拿，但不算纪录
    const got = finishRun(save, { id: `${w.setup.seed.toString(36)}-${nonce()}`, danger: w.setup.danger, won: dawned(w), quit, ticks: Math.min(w.tick, DAWN_TICK), kills: w.kills, coins: w.coins, curses: w.setup.curses?.length ?? 0 });
    // 成就：解锁的奖励铜钱另记一条流水（id 带成就 id，两台设备各解锁一次也只记一次）
    const ach = applyRun(records, summarize(w, tally, quit));
    records = ach.records;
    saveRecords(records);
    for (const id of ach.unlocked) grantCoins(save, `ach:${id}`, rewardCoins([id]));
    toast.show(ach.unlocked);
    showPlay(false);
    const label = `${dailyDate ? '每日挑战 · ' : ''}${w.setup.endless ? '无尽 · ' : ''}${DANGERS[w.setup.danger].name}${w.setup.curses?.length ? ` · 咒印 ${w.setup.curses.length}` : ''}${w.setup.assist ? ' · 降低伤害' : ''}`;
    result.show({ won: w.won, quit, bossKilled: w.bossKilled, seconds, kills: w.kills, level: w.level, coins: got.coins, coinsTotal: coins(save), label, record: got.record, build: buildRows(w) });
    if (got.askAssist)
      confirm.ask('连着倒下好几局了。要不要把挨打的伤害降低 30%？开着时成绩不进总榜，设置里随时能关。', '降低伤害', '不用', (ok) => {
        save.assist = ok;
        writeSave(save);
      });
  };

  /** fixed：实盘、每日挑战用固定配置（kind 说是哪一种）；别的按菜单选的来 */
  const startRun = async (picked: Danger, map: MapId = save.map, debug = false, fixed?: Setup, kind: 'live' | 'daily' | null = null): Promise<void> => {
    liveRun = kind === 'live' && fixed ? { seed: fixed.seed } : null;
    if (kind !== 'live') lastLive = null;
    dailyDate = kind === 'daily' ? beijingDate(Date.now()) : null;
    // 第一局锁危险 0；没解锁的档、角色不让选（存档被改过、链接参数）。调试参数直接开局的不卡
    const danger = (debug ? picked : Math.min(picked, dangerOpen(save))) as Danger;
    if (!fixed) {
      save.danger = danger;
      save.map = map;
      writeSave(save);
    }
    menu.hide();
    result.hide();
    ended = false;
    tally = new RunTally();
    if (scene) game.scene.remove('game');
    banners.clear();
    input.reset();
    const seed = fixed?.seed ?? (q.has('seed') ? Number(q.get('seed')) >>> 0 : (Math.random() * 0x100000000) >>> 0);
    // 这台设备上的第一局：3 分钟前不会死（DESIGN.md 13.2）；实盘用固定配置
    const ms = menuState();
    const w = createWorld(fixed ?? { seed, mode: 'vigil', danger, map, firstRun: save.runs === 0, character: ms.character, curses: ms.curses, perks: save.perks, assist: save.assist, ...(wantEndless ? { endless: true } : {}) });
    world = w;
    autopilot = undefined;
    social.setWhere(w.raid ? 'raid' : 'vigil');
    // 调试参数改过开局、快进过的局不录（录像要从第 0 拍逐拍记）
    rec = q.has('give') || q.has('warp') ? null : new Recorder(w.setup, Date.now());
    if (import.meta.env.DEV && q.has('give')) {
      // ?give=mirror:8,gourd:8e：开局换成这几件法器（等级后面带 e 是直接进化），再加 &merge 当场开宝箱合成
      w.weapons.length = 0;
      w.wstats.length = 0;
      for (const part of q.get('give')!.split(',')) {
        const [id, lv = '1'] = part.split(':');
        if (id && id in WEAPONS) grantWeapon(w, id as WeaponId, parseInt(lv, 10), lv.endsWith('e'));
      }
      if (q.has('merge')) for (let k = 0; k < 3; k++) openChestNow(w);
    }
    if (import.meta.env.DEV && (q.has('auto') || q.has('warp'))) {
      const { Bot } = await import('../tools/bots.ts');
      const bot = new Bot('normal', 'sword', seed);
      if (q.has('auto')) autopilot = (x) => bot.act(x);
      // ?warp=拍数：开局前让机器人在后台先打到这一拍（截中后期的画面）；不带 auto 就从那里交给玩家，
      // 再加 &choose 停在之后第一次升级的选卡上（截卡片）
      const warp = Number(q.get('warp') ?? 0);
      const stopAtCards = q.has('choose');
      while (w.phase !== 'over') {
        if (w.tick >= warp && (!stopAtCards || w.phase === 'choose')) break;
        const a = bot.act(w);
        step(w, a.dir, w.phase === 'choose' ? a.choice : -1);
        tally.feed(w);
      }
    }
    const firstRun = save.runs === 0;
    showPlay(true);
    setPaused(false);
    game.scene.add('game', GameScene, true, {
      world: w,
      atlas,
      ...(w.raid ? { raidAtlas: buildRaidAtlas(res) } : {}),
      hud,
      cards,
      banners,
      input,
      zoom: worldZoom(css().w, css().h) * r,
      icon: (k: string) => icon(k, 128),
      firstRun: firstRun && !tipDone('cards'),
      autopilot,
      shake: () => settings.shake,
      onChest: () => {
        // 引导第 3 条：第一次开宝箱讲进化
        if (tipDone('chest')) return;
        markTip('chest');
        tips.show('法器<b>满级</b> + 对应的<b>被动</b>，宝箱里会开出<b>进化</b>', 6000);
      },
      onEnd: (x: World) => finish(x, false),
      beforeStep: (x: World, dir: number, choice: number) => rec?.before(x, dir, choice),
      afterStep: (x: World) => {
        tally.feed(x);
        if (liveRun && x.tick % 300 === 0) live.progress(liveRun.seed, x.tick);
      },
    });
    scene = game.scene.getScene('game') as unknown as GameScene;
    // 引导第 1 条：开局"拖动走位"，一动就收起（0–10 秒）
    if (!tipDone('moved') && !autopilot) {
      input.moved = false;
      tips.show(TOUCH ? '<b>按住屏幕拖动</b>走位，法器会自己出手' : '<b>WASD</b> 或<b>方向键</b>走位，法器会自己出手', 10000);
      const watch = window.setInterval(() => {
        if (input.moved || ended) {
          window.clearInterval(watch);
          tips.hide();
          if (input.moved) markTip('moved');
        }
      }, 200);
    }
    (window as unknown as { __yx: unknown }).__yx = { game, world: w, lowmem: LOW_MEMORY, res, zoom, r, music, save };
  };
  cards.onShow = (first) => {
    // 引导第 2 条记在卡片自己的说明里，第一次升级以后就不再带
    if (first) markTip('cards');
  };

  menu.onStart = (d, m, endless) => {
    wantEndless = endless;
    void startRun(d, m);
  };
  // 每日挑战（DESIGN.md 5.7）：今天的守夜挑战，配置全服一样；夜探的每日等夜探接进来再开
  const startDaily = (): Promise<void> => {
    const plan = dailyPlan(beijingDate(Date.now()), 'vigil');
    return startRun(plan.setup.danger, plan.setup.map ?? 'snow', true, plan.setup, 'daily');
  };
  menu.onDaily = () => void startDaily();
  const boards = new BoardsPanel(stage, { deps: { fetch: (u, i) => fetch(u, i) }, today: () => beijingDate(Date.now()), onClose: () => menu.show(menuState()) });
  menu.onBoards = () => {
    menu.hide();
    boards.show();
  };
  const replays = new ReplayList(stage, { onPlay: (r0) => startReplay(r0), onClose: () => menu.show(menuState()) });
  menu.onReplays = () => {
    menu.hide();
    replays.show(loadReplays());
  };
  /** 回放：同一个对局场景，输入换成录像（不录、不交分、不发铜钱；ended 先置上，暂停面板和结算都不出） */
  const startReplay = (record: ReplayRecord): void => {
    const player = ReplayPlayer.from(record);
    if (!player) {
      confirm.ask('这段录像坏了，放不了', '知道了', '回菜单', () => menu.show(menuState()));
      return;
    }
    menu.hide();
    ended = true;
    liveRun = null;
    lastLive = null;
    rec = null;
    if (scene) game.scene.remove('game');
    banners.clear();
    input.reset();
    world = player.world;
    showPlay(true);
    setPaused(false);
    const bar = new ReplayBar(stage, player, {
      onExit: () => {
        bar.destroy();
        game.scene.remove('game');
        scene = null;
        world = null;
        showPlay(false);
        music.stop();
        menu.show(menuState());
      },
    });
    game.scene.add('game', GameScene, true, {
      world: player.world,
      atlas,
      hud,
      cards,
      banners,
      input,
      zoom: worldZoom(css().w, css().h) * r,
      icon: (k: string) => icon(k, 128),
      firstRun: false,
      shake: () => settings.shake,
      onEnd: () => undefined,
      drive: (dt: number, each: () => void) => {
        player.onStep = each;
        player.advance(dt);
        bar.update();
      },
    });
    scene = game.scene.getScene('game') as unknown as GameScene;
  };
  menu.onLiveMode = (on, tier) => {
    save.liveOn = on;
    save.liveTier = tier;
    writeSave(save);
  };
  const startLive = async (tier: LiveTier): Promise<void> => {
    const seed = (Math.random() * 0x100000000) >>> 0;
    const r = await live.buyin(tier, seed);
    if (r.ok) {
      lastLive = liveTier = tier;
      return startRun(LIVE_TIERS[tier].danger, 'snow', true, liveSetup(tier, seed), 'live');
    }
    const o = r.outcome;
    const why =
      o.kind === 'reject'
        ? o.error === 'no_funds'
          ? '筹码不够带一份'
          : o.error === 'at_table'
            ? '上一份还没结完，等它结完再开'
            : o.error === 'limit'
              ? '今天的实盘次数用完了，明天再来'
              : `带不进去（${o.error}）`
        : o.kind === 'retry'
          ? o.why === 'login'
            ? '先登录再玩实盘'
            : '连不上平台，过一会儿再试'
          : o.kind === 'unavailable'
            ? '这里没有钱包，实盘不可用'
            : '带入出了问题，过一会儿再试';
    confirm.ask(why, '知道了', '回菜单', () => menu.show(menuState()));
  };
  menu.onLive = (tier) => void startLive(tier);
  // 夜探（第 6 步）：第一次固定教学镇、危险 0；之后选模板和危险档。带角色和加成，不带咒印
  menu.onRaid = (template: RaidTemplateId, picked: Danger) => {
    const ms = menuState();
    const teach = template === 'teach';
    const danger = (teach ? 0 : Math.min(picked, dangerOpen(save))) as Danger;
    const seed = (Math.random() * 0x100000000) >>> 0;
    void startRun(danger, save.map, false, { seed, mode: 'raid', danger, raid: { template }, character: ms.character, perks: save.perks, assist: save.assist });
  };
  const vault = new Vault(stage, (k) => icon(k), () => save.vault);
  vault.onClose = () => {
    vault.hide();
    menu.show(menuState());
  };
  menu.onVault = () => {
    menu.hide();
    vault.show();
  };
  result.onAgain = () => {
    if (lastLive) return void startLive(lastLive);
    if (world?.setup.mode === 'raid') return menu.onRaid(world.setup.raid?.template ?? 'guzhen', world.setup.danger);
    if (dailyDate) return void startDaily();
    wantEndless = !!world?.setup.endless;
    void startRun(world?.setup.danger ?? save.danger, world?.setup.map ?? save.map);
  };
  result.onMenu = () => {
    result.hide();
    menu.show(menuState());
  };

  game.events.once(Phaser.Core.Events.READY, () => {
    game.textures.addCanvas('ground', ground);
    document.getElementById('boot')?.remove();
    // 冒烟、机器人代打不挂 social（它会去问平台）
    if (hasLoginHint() && !q.has('auto')) void social.start();
    (window as unknown as { __yx: unknown }).__yx = { game, world: null, lowmem: LOW_MEMORY, res, zoom, r, music, save };
    // 调试参数直接开局（冒烟截图、机器人代打）；?diff 指定难度
    // ?danger=0–5（老的 ?diff=easy|normal|hard 照认：危险 0 / 2 / 4）
    const legacy: Record<string, Danger> = { easy: 0, normal: 2, hard: 4 };
    const dq = q.get('danger');
    const qd: Danger | null = dq && /^[0-5]$/.test(dq) ? (Number(dq) as Danger) : (legacy[q.get('diff') ?? ''] ?? null);
    // ?map=yizhuang 指定地图（冒烟截图用）
    const qm = q.get('map') === 'yizhuang' ? 'yizhuang' : q.has('map') ? 'snow' : null;
    // ?raid=guzhen|dukou|shansi|teach 直接开一局夜探（冒烟截图用；可带 &auto 机器人代打）
    const qr = q.get('raid');
    if (qr && qr in RAID_TEMPLATES) menu.onRaid(qr as RaidTemplateId, qd ?? 2);
    else if (q.has('auto') || q.has('warp') || q.has('play') || q.has('give')) void startRun(qd ?? 2, qm ?? 'snow', true);
    else {
      if (qd !== null) save.danger = qd;
      if (qm) save.map = qm;
      menu.show(menuState(save.runs === 0));
    }
  });
  fitViewport(() => {
    const s = css();
    game.scale.resize(s.w * r, s.h * r);
    game.scale.setZoom(1 / r);
    scene?.cameras.main.setZoom(worldZoom(s.w, s.h) * r);
  });
}

/** 进化还差什么（13.4：卡片和暂停页写清"还差哪个被动"） */
function evolveHint(w: World, o: OwnedWeapon): string | undefined {
  const evo = WEAPONS[o.id].evolve;
  if (!evo || o.evolved) return undefined;
  const has = (w.passives[evo.with] ?? 0) > 0;
  const p = PASSIVES[evo.with].name;
  if (o.level >= 8) return has ? `下个宝箱进化成${evo.name}` : `还差${p}就能进化`;
  return `满级 + ${p}${has ? '（已有）' : ''} → ${evo.name}`;
}

/** 凑成的套装，写成"剑 2 件 · 暴击 +8%" */
function setLines(w: World): string[] {
  return w.sets.map((s) => {
    const k = s.slice(0, -1);
    const n = Number(s.slice(-1));
    const desc = k in TYPE_SETS ? TYPE_SETS[k as keyof typeof TYPE_SETS][n - 2] : ELEMENT_SET[n - 2];
    return `${k} ${n} 件 · ${desc}`;
  });
}

void boot();
