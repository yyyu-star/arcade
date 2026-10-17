/**
 * 一局夜探的状态和每拍的规则（DESIGN.md 2.3）：宝箱读条、撤离门开关、站门圈撤出、天亮迷失、背包、守卫排队出场。
 * 核心每拍调一次 `tick`（接法见 host.ts 末尾的清单）。和核心一样原地修改、不分配热路径对象；同种子同输入逐位相同。
 */
import { BEAST, CHEST, CHEST_OPEN, RAID_EARLY, CHEST_TIERS, DAWN_RED, DAWN_WARN, GATE, GATE_WINDOWS, GATE_WINDOWS_EARLY, GUARD, RAID_DAWN, RAID_LATE, RAID_TEMPLATES, type RaidEnemyKind, type RaidTemplate } from '../content/explore.ts';
import { TIERS, TREASURES } from '../content/treasures.ts';
import type { EnemyKind } from '../content/enemies.ts';
import { dist } from '../core/fmath.ts';
import { Rng } from '../core/rng.ts';
import { RaidEv, type GuardHost, type RaidPlayerView, type RaidSetup } from './host.ts';
import { rollChest } from './loot.ts';
import { generateMap, type GuardRole, type RaidMap } from './mapgen.ts';

export type RaidOutcome = 'none' | 'escaped' | 'dead' | 'lost';

/** 守卫的角色编号（Uint8Array 里存） */
export const Role = { copper: 0, patrol: 1, beast: 2, roamer: 3, goblin: 4 } as const;
const ROLE_OF: Record<GuardRole, number> = { copper: Role.copper, patrol: Role.patrol, beast: Role.beast };

/** 怪槽位的上限（和核心的 MAX_ENEMIES 一样；这里不 import 核心的 state，免得夜探的测试拖进整个 World） */
const SLOTS = 300;

export class Raid {
  readonly setup: RaidSetup;
  readonly tpl: RaidTemplate;
  readonly map: RaidMap;
  /** 教学镇：死了不丢包 */
  readonly teach: boolean;
  /** 三个开门时段，每段开哪几座门（种子定） */
  readonly windows: { from: number; to: number; gates: number[] }[];
  readonly rAi: Rng;
  private readonly rGate: Rng;

  /** 每座门现在开没开；位掩码同上（第 g 位 = 第 g 座门） */
  readonly gateOpen: Uint8Array;
  gateMask = 0;

  readonly chestOpen: Uint8Array;
  /** 正在搜的宝箱和读条拍数（同一时间只搜一个：离得最近的那个） */
  searchChest = -1;
  searchTicks = 0;

  /** 正在站的门圈和拍数 */
  exitGate = -1;
  exitTicks = 0;

  /** 背包：宝物编号，按捡到的先后 */
  readonly bag: number[] = [];
  /** 早搜奖励（content/explore.ts 的 RAID_EARLY）：结算时加到带出价值上的额外价值，取整 */
  earlyBonus = 0;
  outcome: RaidOutcome = 'none';
  /** 结束在第几拍（撤出、死亡、迷失） */
  endTick = 0;
  /** 攒着的升级宝箱（铜箱、金箱另给一次，核心 openChestNow） */
  upgrades = 0;
  /** 天亮提示到了第几段（0 没到、1 倒计时、2 最后 30 秒） */
  dawnStage = 0;

  // 后半段（RAID_LATE）
  /** 后半段用的随机流：补刷换的东西、宝妖出在哪、宝妖掉什么、鬼市摆什么、宝库开出什么 */
  readonly rLate: Rng;
  /** 补刷到第几波了 */
  restockWave = 0;
  /** 宝妖出到第几只了 */
  goblinNext = 0;
  /** 封着的宝库（最深的金箱，没有金箱为 −1）；钥匙（0 没有 1 有）；宝库搜开了没有 */
  readonly vault: number;
  hasKey = 0;
  /** 鬼市的摊子：位置、摆的宝物、价钱、卖掉没有（开市时摆好，收市清空） */
  readonly stallX: number[] = [];
  readonly stallY: number[] = [];
  readonly stallItem: number[] = [];
  readonly stallPrice: number[] = [];
  readonly stallSold: number[] = [];
  marketOpen = 0;
  /** 正在站的摊子和拍数 */
  buyStall = -1;
  buyTicks = 0;
  /** 宝妖到哪一拍钻地跑掉（按守卫下标；不是宝妖为 0） */
  readonly gEnd: Int32Array;

  // 守卫（地图上的 + 游荡的），并列数组
  readonly gCount: number;
  gUsed = 0;
  readonly gRole: Uint8Array;
  readonly gKind: (EnemyKind | RaidEnemyKind)[];
  readonly gHomeX: Float64Array;
  readonly gHomeY: Float64Array;
  /** 0 待着 / 游荡，1 追，2 回家 */
  readonly gState: Uint8Array;
  /** 绑定的怪槽位和那只怪的代数（槽位复用后认得出不是同一只） */
  readonly gSlot: Int32Array;
  readonly gGen: Uint32Array;
  /** 石兽：二段连扑数到第几下；游荡：要去的路口和上一个路口 */
  readonly gChain: Int32Array;
  readonly gNode: Int32Array;
  readonly gPrev: Int32Array;
  /** 怪槽位 → 守卫下标（−1 不是守卫） */
  readonly slotGuard: Int32Array;
  /** 等核心刷出来的守卫 */
  private readonly queue: number[] = [];
  private roamNext = 0;

  constructor(setup: RaidSetup) {
    this.setup = setup;
    this.tpl = RAID_TEMPLATES[setup.template];
    this.teach = setup.template === 'teach';
    if (this.teach && setup.live) throw new Error('教学镇不能开实盘');
    this.map = generateMap(setup.template, setup.seed);
    this.rGate = new Rng(setup.seed, 'raid-gate');
    this.rAi = new Rng(setup.seed, 'raid-ai');
    this.rLate = new Rng(setup.seed, 'raid-late');
    // 宝库：最深的金箱（并列取先出现的）；教学镇没有后半段
    let vault = -1;
    if (!this.teach) for (let c = 0; c < this.map.chests.length; c++) {
      const ch = this.map.chests[c]!;
      if (ch.tier === 'gold' && (vault < 0 || ch.depth > this.map.chests[vault]!.depth)) vault = c;
    }
    this.vault = vault;

    // 开门时段：第一段随机一座，第二段换一座没开过的，第三段全开
    const early = this.teach || setup.danger === 0;
    const n = this.map.gates.length;
    let used = 0;
    this.windows = (early ? GATE_WINDOWS_EARLY : GATE_WINDOWS).map((w) => {
      if (w.all) return { from: w.from, to: w.to, gates: Array.from({ length: n }, (_, i) => i) };
      const left: number[] = [];
      for (let i = 0; i < n; i++) if (!(used & (1 << i))) left.push(i);
      const g = left[this.rGate.int(left.length)]!;
      used |= 1 << g;
      return { from: w.from, to: w.to, gates: [g] };
    });
    this.gateOpen = new Uint8Array(n);
    this.chestOpen = new Uint8Array(this.map.chests.length);

    const cap = this.map.guards.length + this.tpl.roamers.length + RAID_LATE.goblin.at.length;
    this.gCount = cap;
    this.gRole = new Uint8Array(cap);
    this.gKind = [];
    this.gHomeX = new Float64Array(cap);
    this.gHomeY = new Float64Array(cap);
    this.gState = new Uint8Array(cap);
    this.gSlot = new Int32Array(cap).fill(-1);
    this.gGen = new Uint32Array(cap);
    this.gChain = new Int32Array(cap);
    this.gNode = new Int32Array(cap).fill(-1);
    this.gPrev = new Int32Array(cap).fill(-1);
    this.slotGuard = new Int32Array(SLOTS).fill(-1);
    this.gEnd = new Int32Array(cap);
    for (const s of this.map.guards) this.queue.push(this.addGuard(ROLE_OF[s.role], s.kind, s.x, s.y));
  }

  private addGuard(role: number, kind: EnemyKind | RaidEnemyKind, x: number, y: number): number {
    const g = this.gUsed++;
    this.gRole[g] = role;
    this.gKind[g] = kind;
    this.gHomeX[g] = x;
    this.gHomeY[g] = y;
    return g;
  }

  // ───────────── 核心调用的钩子 ─────────────

  /** 一拍（核心在一拍末尾、判结束之前调） */
  tick(h: RaidPlayerView): void {
    const t = h.tick;
    this.updateGates(h);
    if (t >= DAWN_WARN && this.dawnStage < 1) {
      this.dawnStage = 1;
      h.ev.push(RaidEv.Dawn, h.x, h.y, 0);
    }
    if (t >= DAWN_RED && this.dawnStage < 2) {
      this.dawnStage = 2;
      h.ev.push(RaidEv.Dawn, h.x, h.y, 1);
    }
    const roam = this.tpl.roamers;
    while (this.roamNext < roam.length && t >= roam[this.roamNext]!) {
      this.roamNext++;
      this.spawnRoamer(h);
    }
    if (this.outcome !== 'none') return;
    if (!this.teach) this.late(h);
    this.search(h);
    this.exit(h);
    if (this.outcome === 'none' && t >= RAID_DAWN) {
      this.outcome = 'lost';
      this.endTick = t;
      h.ev.push(RaidEv.Lost, h.x, h.y);
    }
  }

  /** 主角死了（核心在 hp ≤ 0 时调） */
  die(tick: number): void {
    if (this.outcome !== 'none') return;
    this.outcome = 'dead';
    this.endTick = tick;
  }

  /** 攒着的升级宝箱拿一个（核心 openChestNow） */
  takeUpgrade(): boolean {
    if (this.upgrades <= 0) return false;
    this.upgrades--;
    return true;
  }

  /** 等着刷出来的守卫（−1 没有了） */
  takeSpawn(): number {
    return this.queue.length > 0 ? this.queue.shift()! : -1;
  }

  guardSpawn(g: number): { kind: EnemyKind | RaidEnemyKind; x: number; y: number } {
    return { kind: this.gKind[g]!, x: this.gHomeX[g]!, y: this.gHomeY[g]! };
  }

  /** 核心刷出了守卫 g，放在槽位 i：记下来，石兽的技能计时从头算 */
  bindGuard(g: number, i: number, h: GuardHost): void {
    this.gSlot[g] = i;
    this.gGen[g] = h.eGen[i]!;
    this.slotGuard[i] = g;
    this.gState[g] = 0;
    if (this.gRole[g] === Role.beast) {
      h.eT[i] = BEAST.every[0]!;
      h.eS[i] = 0;
    }
  }

  /** 槽位 i（代数 gen）上的怪是不是守卫，是就回守卫下标 */
  guardAt(i: number, gen: number): number {
    const g = this.slotGuard[i]!;
    if (g < 0 || this.gGen[g] !== gen) return -1;
    return g;
  }

  /** 指纹用 */
  rGateSnapshot(): [number, number, number, number] {
    return this.rGate.snapshot();
  }

  // ───────────── 画面层读的 ─────────────

  /** 正在搜的宝箱读条（0–1）；没在搜回 0 */
  searchProgress(): number {
    return this.searchChest < 0 ? 0 : this.searchTicks / CHEST_OPEN.hold;
  }

  /** 撤离读条（0–1） */
  exitProgress(): number {
    return this.exitGate < 0 ? 0 : this.exitTicks / GATE.hold;
  }

  // ───────────── 规则 ─────────────

  private updateGates(h: RaidPlayerView): void {
    const t = h.tick;
    let mask = 0;
    for (const w of this.windows) if (t >= w.from && t < w.to) for (const g of w.gates) mask |= 1 << g;
    if (mask === this.gateMask) return;
    for (let g = 0; g < this.gateOpen.length; g++) {
      const now = (mask >> g) & 1;
      if (now === this.gateOpen[g]) continue;
      this.gateOpen[g] = now;
      const gate = this.map.gates[g]!;
      h.ev.push(now ? RaidEv.GateOpen : RaidEv.GateClose, gate.x, gate.y, g);
    }
    this.gateMask = mask;
  }

  /** 搜箱：站在最近的没开的箱子旁边 1.5 秒；换了箱子或走开就从头来 */
  private search(h: RaidPlayerView): void {
    const chests = this.map.chests;
    let best = -1;
    let bd = CHEST_OPEN.range;
    for (let c = 0; c < chests.length; c++) {
      if (this.chestOpen[c] || (c === this.vault && !this.vaultReady(h.tick))) continue;
      const d = dist(chests[c]!.x - h.x, chests[c]!.y - h.y);
      if (d <= bd) {
        bd = d;
        best = c;
      }
    }
    if (best !== this.searchChest) {
      this.searchChest = best;
      this.searchTicks = 0;
    }
    if (best < 0) return;
    if (++this.searchTicks < CHEST_OPEN.hold) return;
    this.chestOpen[best] = 1;
    this.searchChest = -1;
    this.searchTicks = 0;
    const c = chests[best]!;
    h.ev.push(RaidEv.ChestOpen, c.x, c.y, best, CHEST_TIERS.indexOf(c.tier), c.items.length);
    const early = !this.teach && c.tier !== 'gold' && h.tick < RAID_EARLY.until && dist(c.x - this.map.spawn.x, c.y - this.map.spawn.y) <= RAID_EARLY.near;
    for (const it of c.items) {
      this.bag.push(it);
      if (early) this.earlyBonus += Math.floor(TREASURES[it]!.value * (RAID_EARLY.mul - 1));
      h.ev.push(RaidEv.Loot, c.x, c.y, it, TIERS.indexOf(TREASURES[it]!.tier));
    }
    if (CHEST[c.tier].upgrade) this.upgrades++;
  }

  /** 撤离：在开着的门圈里站 3 秒（挨打不打断，出圈从头来） */
  private exit(h: RaidPlayerView): void {
    let g = -1;
    for (let k = 0; k < this.map.gates.length; k++) {
      if (!this.gateOpen[k]) continue;
      const gate = this.map.gates[k]!;
      if (dist(gate.x - h.x, gate.y - h.y) <= GATE.r) {
        g = k;
        break;
      }
    }
    if (g !== this.exitGate) {
      this.exitGate = g;
      this.exitTicks = 0;
    }
    if (g < 0) return;
    if (++this.exitTicks < GATE.hold) return;
    this.outcome = 'escaped';
    this.endTick = h.tick;
    const gate = this.map.gates[g]!;
    h.ev.push(RaidEv.Escape, gate.x, gate.y, g);
  }

  /** 宝库能不能搜：8:00 以后、身上有钥匙 */
  vaultReady(tick: number): boolean {
    return tick >= RAID_LATE.vault.at && this.hasKey === 1;
  }

  /** 核心打倒了槽位 i（代数 gen）上的怪：宝妖掉宝物；钥匙从 keyFrom 以后的第一只精英或守卫掉。返回 true = 是宝妖（核心不再掉升级宝箱） */
  onKill(i: number, gen: number, elite: boolean, x: number, y: number, h: RaidPlayerView): boolean {
    if (this.teach || this.outcome !== 'none') return false;
    const g = this.guardAt(i, gen);
    if (g >= 0) this.slotGuard[i] = -1;
    if (g >= 0 && this.gRole[g] === Role.goblin) {
      for (const it of rollChest(this.rLate, 'gold', 1).slice(0, RAID_LATE.goblin.items)) {
        this.bag.push(it);
        h.ev.push(RaidEv.Loot, x, y, it, TIERS.indexOf(TREASURES[it]!.tier));
      }
      h.ev.push(RaidEv.Goblin, x, y, 2);
      return true;
    }
    if (this.hasKey === 0 && this.vault >= 0 && h.tick >= RAID_LATE.vault.keyFrom && (elite || g >= 0)) {
      this.hasKey = 1;
      h.ev.push(RaidEv.Key, x, y);
    }
    return false;
  }

  /** 宝妖 g 该不该钻地跑掉了 */
  goblinGone(g: number, tick: number): boolean {
    return this.gRole[g] === Role.goblin && tick >= this.gEnd[g]!;
  }

  /** 后半段：补刷、宝妖、鬼市、宝库开封（都按 rLate 抽） */
  private late(h: RaidPlayerView): void {
    const t = h.tick;
    const L = RAID_LATE;
    // 补刷：挑 n 个开过的箱子（不挑宝库、不挑主角身边的）重新封上、换一批更值钱的
    if (t >= L.restock.from + this.restockWave * L.restock.every) {
      this.restockWave++;
      const opened: number[] = [];
      for (let c = 0; c < this.map.chests.length; c++) {
        if (!this.chestOpen[c] || c === this.vault) continue;
        const ch = this.map.chests[c]!;
        if (dist(ch.x - h.x, ch.y - h.y) < 500) continue;
        opened.push(c);
      }
      let n = 0;
      for (let k = 0; k < L.restock.n && opened.length > 0; k++) {
        const pick = this.rLate.int(opened.length);
        const c = opened[pick]!;
        opened[pick] = opened[opened.length - 1]!;
        opened.pop();
        const ch = this.map.chests[c]!;
        const depth = ch.depth + L.restock.deepStep * this.restockWave;
        ch.items = rollChest(this.rLate, ch.tier, depth > 1 ? 1 : depth);
        this.chestOpen[c] = 0;
        h.ev.push(RaidEv.Restock, ch.x, ch.y, c);
        n++;
      }
      if (n > 0) h.ev.push(RaidEv.Restock, h.x, h.y, -1, n);
    }
    // 宝妖：离主角 minD–maxD 的路口（都不在这个范围就挑最远的）
    if (this.goblinNext < L.goblin.at.length && t >= L.goblin.at[this.goblinNext]! && this.gUsed < this.gCount) {
      this.goblinNext++;
      const nodes = this.map.nodes;
      if (nodes.length > 0) {
        const ok: number[] = [];
        let fb = 0;
        let fd = -1;
        for (let k = 0; k < nodes.length; k++) {
          const d = dist(nodes[k]!.x - h.x, nodes[k]!.y - h.y);
          if (d >= L.goblin.minD && d <= L.goblin.maxD) ok.push(k);
          if (d > fd) {
            fd = d;
            fb = k;
          }
        }
        const node = nodes[ok.length > 0 ? ok[this.rLate.int(ok.length)]! : fb]!;
        const g = this.addGuard(Role.goblin, 'goblin', node.x, node.y);
        this.gEnd[g] = t + L.goblin.life;
        this.queue.push(g);
        h.ev.push(RaidEv.Goblin, node.x, node.y, 0);
      }
    }
    // 鬼市
    if (this.marketOpen === 0 && t >= L.market.from && t < L.market.to) this.openMarket(h);
    if (this.marketOpen === 1 && t >= L.market.to) {
      this.marketOpen = 2;
      this.buyStall = -1;
      this.buyTicks = 0;
      h.ev.push(RaidEv.Market, this.stallX[0] ?? h.x, this.stallY[0] ?? h.y, 1);
    }
    if (this.marketOpen === 1) this.buy(h);
    // 宝库开封（有钥匙才算开，没钥匙到时候提示一句"宝库开了，要钥匙"）
    if (this.vault >= 0 && t === L.vault.at) {
      const v = this.map.chests[this.vault]!;
      v.items = rollChest(this.rLate, 'gold', 1);
      while (v.items.length < L.vault.items) v.items.push(...rollChest(this.rLate, 'gold', 1));
      v.items.length = L.vault.items;
      h.ev.push(RaidEv.Vault, v.x, v.y, this.vault, this.hasKey);
    }
  }

  /** 开市：镇中心最近的路口，三个摊子横着排（站不下就挤在路口上） */
  private openMarket(h: RaidPlayerView): void {
    const L = RAID_LATE.market;
    const nodes = this.map.nodes;
    this.marketOpen = 1;
    if (nodes.length === 0) return;
    const cx = this.map.size / 2;
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k < nodes.length; k++) {
      const d = dist(nodes[k]!.x - cx, nodes[k]!.y - cx);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    const node = nodes[best]!;
    for (let k = 0; k < L.stalls; k++) {
      let x = node.x + (k - (L.stalls - 1) / 2) * L.gap;
      let y = node.y;
      if (!this.map.index.free(x, y, 30)) {
        x = node.x;
        y = node.y;
      }
      // 一摊一件：中间那摊是绝品的机会大
      const item = rollChest(this.rLate, k === 1 ? 'gold' : 'copper', L.depth)[0]!;
      this.stallX.push(x);
      this.stallY.push(y);
      this.stallItem.push(item);
      this.stallPrice.push(Math.ceil(TREASURES[item]!.value * L.rate));
      this.stallSold.push(0);
    }
    h.ev.push(RaidEv.Market, node.x, node.y, 0);
  }

  /** 买：站在没卖掉的摊子前 hold 拍、铜钱够就买下（钱不够站着也不读条） */
  private buy(h: RaidPlayerView): void {
    const L = RAID_LATE.market;
    let s = -1;
    for (let k = 0; k < this.stallX.length; k++) {
      if (this.stallSold[k] || h.coins < this.stallPrice[k]!) continue;
      if (dist(this.stallX[k]! - h.x, this.stallY[k]! - h.y) <= L.r) {
        s = k;
        break;
      }
    }
    if (s !== this.buyStall) {
      this.buyStall = s;
      this.buyTicks = 0;
    }
    if (s < 0 || ++this.buyTicks < L.hold) return;
    h.coins -= this.stallPrice[s]!;
    this.stallSold[s] = 1;
    this.bag.push(this.stallItem[s]!);
    this.buyStall = -1;
    this.buyTicks = 0;
    h.ev.push(RaidEv.Loot, this.stallX[s]!, this.stallY[s]!, this.stallItem[s]!, TIERS.indexOf(TREASURES[this.stallItem[s]!]!.tier));
    h.ev.push(RaidEv.Market, this.stallX[s]!, this.stallY[s]!, 2, s);
  }

  /** 鬼市读条（0–1） */
  buyProgress(): number {
    return this.buyStall < 0 ? 0 : this.buyTicks / RAID_LATE.market.hold;
  }

  /** 游荡的巡夜将：从离主角远的路口出来（至少 1,200；都不够远就挑最远的） */
  private spawnRoamer(h: RaidPlayerView): void {
    const nodes = this.map.nodes;
    if (nodes.length === 0 || this.gUsed >= this.gCount) return;
    const far: number[] = [];
    let fb = -1;
    let fd = -1;
    for (let k = 0; k < nodes.length; k++) {
      const d = dist(nodes[k]!.x - h.x, nodes[k]!.y - h.y);
      if (d >= 1200) far.push(k);
      if (d > fd) {
        fd = d;
        fb = k;
      }
    }
    const k = far.length > 0 ? far[this.rAi.int(far.length)]! : fb;
    const node = nodes[k]!;
    const g = this.addGuard(Role.roamer, 'patrol', node.x, node.y);
    this.gNode[g] = k;
    this.queue.push(g);
    h.ev.push(RaidEv.Roamer, node.x, node.y);
  }
}

/** 守卫的追人参数（按角色） */
export function guardCfg(role: number): { aggro: number; leash: number; homeSpeed: number } {
  if (role === Role.copper) return GUARD.copper;
  if (role === Role.patrol) return GUARD.patrol;
  if (role === Role.beast) return GUARD.beast;
  return { aggro: GUARD.roamer.aggro, leash: GUARD.roamer.leash, homeSpeed: 1 };
}

/** 夜探的状态指纹（核心的 fingerprint 在夜探时混进去）：宝箱、背包、门、撤离和搜箱进度、守卫、随机流 */
export function raidFingerprint(r: Raid): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const v of [r.gateMask, r.searchChest, r.searchTicks, r.exitGate, r.exitTicks, r.upgrades, r.dawnStage, r.endTick, r.gUsed, r.earlyBonus, ['none', 'escaped', 'dead', 'lost'].indexOf(r.outcome)]) mix(v);
  for (const v of r.chestOpen) mix(v);
  mix(r.bag.length);
  for (const v of r.bag) mix(v);
  for (let g = 0; g < r.gUsed; g++) for (const v of [r.gState[g]!, r.gSlot[g]!, r.gChain[g]!, r.gNode[g]!, r.gPrev[g]!]) mix(v);
  for (const v of [r.restockWave, r.goblinNext, r.hasKey, r.marketOpen, r.buyStall, r.buyTicks]) mix(v);
  for (const v of r.stallSold) mix(v);
  for (const v of r.rLate.snapshot()) mix(v);
  for (const v of r.rAi.snapshot()) mix(v);
  for (const v of r.rGateSnapshot()) mix(v);
  return h >>> 0;
}
