/** 准备房间的设置（DESIGN.md 5.5）、danli.prefs 的存取（第 8 节）、单机存档第 2 版（带整局设置，老存档丢掉） */
import { describe, expect, it } from 'vitest';
import { favoriteWeapon, personaById, PERSONAS } from '../src/ai/personas.ts';
import { newGame, setupError } from '../src/core/rules.ts';
import { botSeats, defaultRoom, loadPrefs, parseRoom, PREFS_KEY, roomSetup, savePrefs, setMyLook, setPersona, type RoomConfig } from '../src/room.ts';
import { WEAPONS } from '../src/core/weapons.ts';
import { parseSave, SOLO_VERSION } from '../src/solo.ts';

/** 内存里的 localStorage */
function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

const kitchen = (): 'kitchen' => 'kitchen';

describe('房间设置 → 开局设置', () => {
  it('默认阵容：1v1 我（柴柴、西瓜投石器）对兔兔（冲天烟花筒）；两队各有一把大范围的武器', () => {
    const setup = roomSetup(defaultRoom(), '小明', kitchen);
    expect(setupError(setup)).toBeNull();
    expect(setup.players).toEqual([
      { name: '小明', team: 0, look: 'shiba', weapon: 'melon', ai: false },
      { name: '兔兔', team: 1, look: 'rabbit', weapon: 'rocket', ai: true },
    ]);
    for (const size of [2, 3] as const) {
      const ps = roomSetup({ ...defaultRoom(), size }, '我', kitchen).players;
      for (const t of [0, 1]) expect(ps.filter((p) => p.team === t && WEAPONS[p.weapon].blast === 'big'), `${size}v${size} ${t} 队`).toHaveLength(1);
      // 电脑拿的都是自己性格偏好的第一把
      for (const p of ps.filter((x) => x.ai)) expect(p.weapon).toBe(PERSONAS.find((q) => q.name === p.name)!.weapons[0]);
    }
  });

  it('3v3：座位顺序是 我、队友 2、3 号，再黄队 1–3 号；六只小动物各不相同', () => {
    const r: RoomConfig = { ...defaultRoom(), size: 3, me: { look: 'shiba', weapon: 'rocket' } };
    r.foes[2] = { persona: 'qiqi', weapon: 'frisbee' };
    const setup = roomSetup(r, '我', kitchen);
    expect(setupError(setup)).toBeNull();
    expect(setup.players.map((p) => [p.name, p.team, p.weapon, p.ai])).toEqual([
      ['我', 0, 'rocket', false],
      ['橘子', 0, 'steamer', true],
      ['团团', 0, 'milktea', true],
      ['兔兔', 1, 'rocket', true],
      ['鼠鼠', 1, 'carrot', true],
      ['企企', 1, 'frisbee', true],
    ]);
    expect(new Set(setup.players.map((p) => p.look)).size).toBe(6);
    expect(newGame([1, 1, 1, 1, 1, 1, 1, 1], setup).chars).toHaveLength(6);
  });

  it('"随机"地图由调用方抽，抽到的写进开局设置', () => {
    const asked: string[][] = [];
    const setup = roomSetup({ ...defaultRoom(), map: 'random' }, '我', (ids) => {
      asked.push([...ids]);
      return ids[1]!;
    });
    expect(asked).toEqual([['kitchen', 'icecream', 'dumpling', 'bento', 'nightmarket', 'breakfast', 'cake', 'hotpot', 'pizza', 'sushi', 'teatime']]);
    expect(setup.map).toBe('icecream');
  });

  it('电脑换人物：换成别的电脑座位上的那位就对调；换成我的小动物就和我对调；换上的人物拿他喜欢的武器', () => {
    const r = defaultRoom();
    // 黄队 1 号（兔兔）换成橘子（原来在蓝队 2 号）
    const next = setPersona(r, 2, 'juzi');
    expect(next.foes[0]).toEqual({ persona: 'juzi', weapon: 'steamer' });
    expect(next.mates[0]).toEqual({ persona: 'tutu', weapon: 'rocket' });
    // 黄队 2 号（鼠鼠）换成柴柴：柴柴是我的样子，我就换成鼠鼠的样子
    const n2 = setPersona(next, 3, 'chaichai');
    expect(n2.foes[1]).toEqual({ persona: 'chaichai', weapon: favoriteWeapon(personaById('chaichai')!) });
    expect(n2.me.look).toBe('mouse');
    const looks = [n2.me.look, ...botSeats(n2).map((s) => personaById(s.persona)!.look)];
    expect(new Set(looks).size).toBe(6);
    // 原来的没被改
    expect(r.foes[0]!.persona).toBe('tutu');
    expect(r.me.look).toBe('shiba');
  });

  it('我换小动物：换成在场电脑的那只就和它对调（它换成我原来那只的人物）', () => {
    const r = setMyLook(defaultRoom(), 'rabbit');
    expect(r.me.look).toBe('rabbit');
    expect(r.foes[0]).toEqual({ persona: 'chaichai', weapon: 'melon' });
    const looks = [r.me.look, ...botSeats(r).map((s) => personaById(s.persona)!.look)];
    expect(new Set(looks).size).toBe(6);
  });
});

describe('danli.prefs', () => {
  it('存了再读回来一模一样', () => {
    const store = memory();
    const room: RoomConfig = { size: 2, map: 'random', me: { look: 'mouse', weapon: 'carrot' }, mates: [{ persona: 'tutu', weapon: 'slipper' }, { persona: 'qiqi', weapon: 'paddle' }], foes: [{ persona: 'juzi', weapon: 'melon' }, { persona: 'chaichai', weapon: 'melon' }, { persona: 'tuantuan', weapon: 'carrot' }] };
    savePrefs(store, { v: 1, muted: true, room });
    expect(store.data.has(PREFS_KEY)).toBe(true);
    expect(loadPrefs(store)).toEqual({ v: 1, muted: true, room });
  });

  it('没存过、坏了、拿不到存储：都回默认', () => {
    expect(loadPrefs(memory()).room).toEqual(defaultRoom());
    const bad = memory();
    bad.setItem(PREFS_KEY, '{oops');
    expect(loadPrefs(bad).muted).toBe(false);
    expect(loadPrefs(null).room).toEqual(defaultRoom());
    expect(() => savePrefs(null, loadPrefs(null))).not.toThrow();
  });

  it('读进来逐项检查：坏的那一项换成默认，别的照旧', () => {
    const r = parseRoom({ size: 9, map: 'moon', me: { look: 'dragon', weapon: 'melon' }, mates: [{ persona: 'nobody', weapon: 'sword' }], foes: 'x' });
    const d = defaultRoom();
    expect(r.size).toBe(d.size);
    expect(r.map).toBe(d.map);
    expect(r.me).toEqual({ look: d.me.look, weapon: 'melon' });
    expect(r.mates).toEqual(d.mates);
    expect(r.foes).toEqual(d.foes);
  });

  it('小动物重复的（电脑之间、电脑和我）换成没人用的', () => {
    const r = parseRoom({ ...defaultRoom(), mates: [{ persona: 'juzi', weapon: 'steamer' }, { persona: 'juzi', weapon: 'rocket' }], foes: [{ persona: 'chaichai', weapon: 'melon' }] });
    const looks = [r.me.look, ...botSeats(r).map((s) => personaById(s.persona)!.look)];
    expect(new Set(looks).size).toBe(6);
  });
});

describe('单机存档 danli.solo', () => {
  const setup = roomSetup({ ...defaultRoom(), size: 3 }, '我', kitchen);
  const good = { v: 3, key: [1, 2, 3, 4, 5, 6, 7, 8], setup, log: [{ t: 'move', dir: 1 }, { t: 'fire', angle: 45, power: 40, facing: 1, fork: 1, p1: 1 }] };

  it('第 3 版（0.3.0，道具是每种几个）带整局设置，读得回来', () => {
    expect(SOLO_VERSION).toBe(3);
    expect(parseSave(JSON.stringify(good))).toEqual(good);
  });

  it('老存档（第 1、2 版：0.2.0 的道具格式）和坏了的读不出来，直接丢掉', () => {
    expect(parseSave(JSON.stringify({ ...good, v: 1 }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...good, v: 2, log: [{ t: 'fire', angle: 45, power: 40, facing: 1, mode: 'fork', boost: 20 }] }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...good, setup: { ...setup, players: setup.players.slice(0, 1) } }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...good, key: [1, 2] }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...good, log: 'x' }))).toBeNull();
    expect(parseSave('{')).toBeNull();
    expect(parseSave(null)).toBeNull();
  });
});
